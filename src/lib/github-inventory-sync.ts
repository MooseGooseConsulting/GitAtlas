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
  // Finding H (disclosed skip): this replacement import path never fetches
  // or writes `readmeContent` — a per-repo README fetch was dropped for
  // quota/API-cost reasons, so newly imported projects reach analysis with
  // readmeContent NULL. Downstream `fetchRepositorySourceSamples` already
  // treats a missing README as one absent sample (falls back to metadata +
  // issues/commits, or `source_sample_unavailable`), so this is a coverage
  // gap, not a crash. Restoring a bounded README writer is a follow-up;
  // until then the skip is intentional and disclosed here.
  // A repository without an observed head SHA (failed or unsupported head
  // lookup) must never read as a verified current row: clear any stale SHA
  // via an explicit null and mark the row unverified instead of current.
  const headVerified = repo.default_branch_head_sha != null;
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
    inventoryStatus: headVerified ? "current" : "unverified",
    inventoryFetchedAt: inventoryAt,
    inventoryLastSuccessAt: inventoryAt,
    visibility: repo.visibility ?? (repo.private ? "private" : "public"),
    // Clear stale SHAs when the head lookup failed or was unsupported;
    // omitting the field here would retain the previous row's SHA.
    defaultBranchHeadSha: repo.default_branch_head_sha ?? null,
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
    // Bounded page cap hit with more provider pages advertised: the listing
    // is incomplete (persisted rows are honest but partial), so the scopes
    // below report deferred/partial instead of current.
    const inventoryTruncated = inventory.truncated === true;
    // Hoisted for the success return below: the transaction callback also
    // persists this scope status, but the return lives outside that closure
    // (a shadowed inner const here previously left the return unbound,
    // throwing ReferenceError -> sync_failure on every success path).
    const inventoryStatus = inventoryTruncated ? "partial" : "current";
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
    // Prisma returns BigInt for githubId on PostgreSQL while the provider
    // listing uses numbers; normalize both sides to Number so the lookup
    // works against real rows and number-keyed test mocks alike.
    const priorById = new Map(priorProjects.map((project) => [Number(project.githubId), project]));
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
            if (result.unsupported) {
              // Unsupported (empty repo, missing ref): clear any stale SHA
              // carried on a caller-supplied inventory row and count it.
              repo.default_branch_head_sha = undefined;
              unsupportedHeads++;
            } else if (result.sha) {
              repo.default_branch_head_sha = result.sha;
              observedHeads++;
            } else {
              throw new GithubInventoryError({
                status: 502,
                code: "invalid_head_response",
              });
            }
          } catch (error) {
            // Failed head lookup: never retain a stale SHA from a supplied
            // inventory row; projectData marks the row unverified instead.
            repo.default_branch_head_sha = undefined;
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
      // A truncated listing is persisted honestly but incompletely: the
      // inventory scope reports partial (never current) and does not advance
      // lastSuccessAt, so freshness readers never mistake it for complete.
      await tx.syncState.update({
        where: { scope: INVENTORY_SCOPE },
        data: {
          status: inventoryStatus,
          fetchedAt: successAt,
          ...(inventoryTruncated ? {} : { lastSuccessAt: successAt }),
          itemCount: inventory.repositories.length,
          pagesFetched: inventory.pagesFetched,
          retryAt: null,
          errorCode: inventoryTruncated ? "truncated_listing" : null,
        },
      });
      const headError = headFailures[0];
      const headStatus = headError?.code === "rate_limited"
        ? "deferred"
        : headFailures.length || inventoryTruncated
          ? "partial"
          : "current";
      const headComplete = headStatus === "current";
      const headErrorCode = headError?.code
        ?? (inventoryTruncated ? "truncated_listing" : null)
        ?? (unsupportedHeads ? "unsupported_resources" : null);
      await tx.syncState.upsert({
        where: { scope: HEAD_SCOPE },
        create: {
          scope: HEAD_SCOPE,
          status: headStatus,
          fetchedAt: successAt,
          lastSuccessAt: headComplete ? successAt : null,
          itemCount: observedHeads,
          unsupportedCount: unsupportedHeads,
          pagesFetched: headRequests,
          retryAt: headError?.retryAt ? new Date(headError.retryAt) : null,
          errorCode: headErrorCode,
        },
        update: {
          status: headStatus,
          fetchedAt: successAt,
          ...(headComplete ? { lastSuccessAt: successAt } : {}),
          itemCount: observedHeads,
          unsupportedCount: unsupportedHeads,
          pagesFetched: headRequests,
          retryAt: headError?.retryAt ? new Date(headError.retryAt) : null,
          errorCode: headErrorCode,
        },
      });
    });

    return {
      status: inventoryStatus,
      fetchedAt: successAt,
      lastSuccessAt: successAt,
      itemCount: inventory.repositories.length,
      pagesFetched: inventory.pagesFetched,
      truncated: inventoryTruncated,
      headStatus: headFailures.length
        ? headFailures.some((failure) => failure.code === "rate_limited")
          ? "deferred"
          : "partial"
        : inventoryTruncated
          ? "partial"
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
