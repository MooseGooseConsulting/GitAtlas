import { db } from "./db";
import {
  fetchAccessibleRepositories,
  fetchDefaultBranchHeadSha,
  GithubInventoryError,
  type GithubRepository,
} from "./github-inventory";

const INVENTORY_SCOPE = "github:accessible-repositories";
const HEAD_SCOPE = "github:default-branch-heads";
const HEAD_CONCURRENCY = 4;

function projectData(repo: GithubRepository, inventoryAt: Date) {
  return {
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description ?? null,
    htmlUrl: repo.html_url,
    homepage: repo.homepage ?? null,
    language: repo.language ?? null,
    stargazersCount: repo.stargazers_count ?? 0,
    forksCount: repo.forks_count ?? 0,
    openIssuesCount: repo.open_issues_count ?? 0,
    githubCreatedAt: new Date(repo.created_at),
    githubUpdatedAt: new Date(repo.updated_at),
    pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
    topics: (repo.topics ?? []).join(","),
    isFork: repo.fork ?? false,
    isArchived: repo.archived ?? false,
    ownerLogin: repo.owner?.login ?? repo.full_name.split("/")[0],
    ownerType: repo.owner?.type ?? "User",
    ownerAvatarUrl: repo.owner?.avatar_url ?? null,
    defaultBranch: repo.default_branch ?? "unknown",
    inventoryStatus: "current",
    inventoryFetchedAt: inventoryAt,
    inventoryLastSuccessAt: inventoryAt,
    visibility: repo.visibility ?? (repo.private ? "private" : "public"),
    ...(repo.default_branch_head_sha
      ? { defaultBranchHeadSha: repo.default_branch_head_sha }
      : {}),
  };
}

export async function refreshAccessibleInventory(
  suppliedInventory?: Awaited<ReturnType<typeof fetchAccessibleRepositories>>,
) {
  const attemptedAt = new Date();
  const priorState = await db.syncState.findUnique({
    where: { scope: INVENTORY_SCOPE },
    select: { retryAt: true },
  });
  if (
    priorState?.retryAt &&
    priorState.retryAt.getTime() > attemptedAt.getTime()
  ) {
    throw new GithubInventoryError({
      status: 429,
      code: "rate_limited",
      retryAt: priorState.retryAt.toISOString(),
    });
  }
  await db.syncState.upsert({
    where: { scope: INVENTORY_SCOPE },
    create: {
      scope: INVENTORY_SCOPE,
      status: "syncing",
      fetchedAt: attemptedAt,
    },
    update: {
      status: "syncing",
      fetchedAt: attemptedAt,
      retryAt: null,
      errorCode: null,
    },
  });

  try {
    const inventory = suppliedInventory ?? (await fetchAccessibleRepositories());
    const successAt = inventory.fetchedAt;
    const priorProjects = await db.project.findMany({
      where: {
        githubId: { in: inventory.repositories.map((repo) => repo.id) },
      },
      select: {
        githubId: true,
        defaultBranch: true,
        defaultBranchHeadSha: true,
        githubUpdatedAt: true,
        pushedAt: true,
      },
    });
    const priorById = new Map(priorProjects.map((project) => [project.githubId, project]));
    const headFailures: GithubInventoryError[] = [];
    const priorHeadState = await db.syncState.findUnique({
      where: { scope: HEAD_SCOPE },
      select: { retryAt: true },
    });
    let unsupportedHeads = 0;
    let observedHeads = 0;
    let headRequests = 0;
    let nextIndex = 0;
    let stopAfterRateLimit = Boolean(
      priorHeadState?.retryAt &&
        priorHeadState.retryAt.getTime() > attemptedAt.getTime(),
    );
    if (stopAfterRateLimit && priorHeadState?.retryAt) {
      headFailures.push(
        new GithubInventoryError({
          status: 429,
          code: "rate_limited",
          retryAt: priorHeadState.retryAt.toISOString(),
        }),
      );
    }
    const headWorkers = Array.from(
      { length: Math.min(HEAD_CONCURRENCY, inventory.repositories.length) },
      async () => {
        while (nextIndex < inventory.repositories.length && !stopAfterRateLimit) {
          const index = nextIndex++;
          const repo = inventory.repositories[index];
          const previous = priorById.get(repo.id);
          const branch = repo.default_branch;
          if (!branch) {
            unsupportedHeads++;
            continue;
          }
          const pushedAt = repo.pushed_at ? new Date(repo.pushed_at) : null;
          const needsHead =
            !previous?.defaultBranchHeadSha ||
            previous.defaultBranch !== branch ||
            previous.pushedAt?.getTime() !== pushedAt?.getTime();
          if (!needsHead) {
            repo.default_branch_head_sha = previous.defaultBranchHeadSha;
            observedHeads++;
            continue;
          }
          try {
            headRequests++;
            const result = await fetchDefaultBranchHeadSha(repo.full_name, branch);
            repo.default_branch_head_sha = result.sha ?? undefined;
            if (result.unsupported) {
              unsupportedHeads++;
            } else if (result.sha) {
              observedHeads++;
            } else {
              throw new GithubInventoryError({
                status: 502,
                code: "invalid_head_response",
              });
            }
          } catch (error) {
            const failure =
              error instanceof GithubInventoryError
                ? error
                : new GithubInventoryError({ status: 503, code: "head_sync_failure" });
            headFailures.push(failure);
            if (failure.code === "rate_limited") stopAfterRateLimit = true;
          }
        }
      },
    );
    await Promise.all(headWorkers);

    await db.$transaction(async (tx) => {
      for (const repo of inventory.repositories) {
        const data = projectData(repo, successAt);
        const previous = priorById.get(repo.id);
        const shouldInvalidateAnalysis =
          previous != null &&
          (previous.githubUpdatedAt.getTime() < data.githubUpdatedAt.getTime() ||
            previous.defaultBranch !== data.defaultBranch ||
            (repo.default_branch_head_sha != null &&
              previous.defaultBranchHeadSha !== repo.default_branch_head_sha));
        await tx.project.upsert({
          where: { githubId: repo.id },
          create: {
            githubId: repo.id,
            ...data,
          },
          update: {
            ...data,
            ...(shouldInvalidateAnalysis
              ? { analyzedAt: null, deepAnalyzedAt: null }
              : {}),
          },
        });
      }
      await tx.project.updateMany({
        where: {
          githubId: { notIn: inventory.repositories.map((repo) => repo.id) },
          inventoryStatus: { not: "unverified" },
        },
        data: {
          inventoryStatus: "stale",
          inventoryFetchedAt: successAt,
        },
      });
      await tx.syncState.update({
        where: { scope: INVENTORY_SCOPE },
        data: {
          status: "current",
          fetchedAt: successAt,
          lastSuccessAt: successAt,
          itemCount: inventory.repositories.length,
          pagesFetched: inventory.pagesFetched,
          retryAt: null,
          errorCode: null,
        },
      });
      const headError = headFailures[0];
      await tx.syncState.upsert({
        where: { scope: HEAD_SCOPE },
        create: {
          scope: HEAD_SCOPE,
          status: headError?.code === "rate_limited"
            ? "deferred"
            : headFailures.length
              ? "partial"
              : "current",
          fetchedAt: successAt,
          lastSuccessAt: headFailures.length ? null : successAt,
          itemCount: observedHeads,
          unsupportedCount: unsupportedHeads,
          pagesFetched: headRequests,
          retryAt: headError?.retryAt ? new Date(headError.retryAt) : null,
          errorCode: headError?.code ?? (unsupportedHeads ? "unsupported_resources" : null),
        },
        update: {
          status: headError?.code === "rate_limited"
            ? "deferred"
            : headFailures.length
              ? "partial"
              : "current",
          fetchedAt: successAt,
          ...(headFailures.length ? {} : { lastSuccessAt: successAt }),
          itemCount: observedHeads,
          unsupportedCount: unsupportedHeads,
          pagesFetched: headRequests,
          retryAt: headError?.retryAt ? new Date(headError.retryAt) : null,
          errorCode: headError?.code ?? (unsupportedHeads ? "unsupported_resources" : null),
        },
      });
    });

    return {
      status: "current" as const,
      fetchedAt: successAt,
      lastSuccessAt: successAt,
      itemCount: inventory.repositories.length,
      pagesFetched: inventory.pagesFetched,
      headStatus: headFailures.length
        ? headFailures.some((failure) => failure.code === "rate_limited")
          ? "deferred"
          : "partial"
        : "current",
      observedHeads,
      unsupportedHeads,
      reconciledCount: inventory.repositories.length,
    };
  } catch (error) {
    const providerError =
      error instanceof GithubInventoryError
        ? error
        : new GithubInventoryError({ status: 503, code: "sync_failure" });
    const prior = await db.syncState.findUnique({
      where: { scope: INVENTORY_SCOPE },
      select: { lastSuccessAt: true, itemCount: true },
    });
    const failedAt = new Date();
    const status =
      providerError.code === "rate_limited"
        ? "deferred"
        : providerError.pagesFetched > 0
          ? "partial"
          : "failed";
    await db.syncState.upsert({
      where: { scope: INVENTORY_SCOPE },
      create: {
        scope: INVENTORY_SCOPE,
        status,
        fetchedAt: failedAt,
        lastSuccessAt: prior?.lastSuccessAt ?? null,
        itemCount: prior?.itemCount ?? 0,
        pagesFetched: providerError.pagesFetched,
        retryAt: providerError.retryAt ? new Date(providerError.retryAt) : null,
        errorCode: providerError.code,
      },
      update: {
        status,
        fetchedAt: failedAt,
        pagesFetched: providerError.pagesFetched,
        retryAt: providerError.retryAt ? new Date(providerError.retryAt) : null,
        errorCode: providerError.code,
      },
    });
    throw providerError;
  }
}

export function getInventoryScope() {
  return INVENTORY_SCOPE;
}
