import { db } from "./db";
import { getGithubHeaders } from "./github-token";
import {
  fetchPages,
  type FetchFunction,
  GithubWorkResourceError,
} from "./github-work-resource-client";
import {
  classifyReference,
  detectReferenceIntent,
} from "./relationship-semantics";

type ResourceType = "issue" | "pull_request" | "branch" | "commit" | "deployment";

type ProjectRef = {
  id: string;
  githubId: number;
  ownerLogin: string;
  name: string;
  htmlUrl: string;
};

type GitHubFlatCommit = {
  message?: string;
  author?: { date?: string | null };
  committer?: { date?: string | null };
  html_url?: string;
};

type GitHubNestedCommit = {
  sha?: string;
  commit?: GitHubFlatCommit;
};

type GitHubObject = {
  id?: number;
  number?: number;
  node_id?: string;
  name?: string;
  sha?: string;
  title?: string;
  body?: string | null;
  state?: string;
  merged_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  html_url?: string;
  url?: string;
  environment?: string;
  ref?: string;
  commit?: string | GitHubFlatCommit | GitHubNestedCommit;
  pull_request?: { html_url?: string };
  head?: { ref?: string | null; sha?: string | null } | null;
  latest_status?: { state?: string; created_at?: string | null };
};

type ResourceInput = {
  sourceType: ResourceType;
  externalId: string;
  title: string | null;
  sourceUrl: string;
  sourceState: string;
  refName: string | null;
  createdAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceClosedAt: Date | null;
  issueNumber: number | null;
};

type WorkReferenceInput = {
  targetNumber: number;
  targetSourceType: "issue" | "pull_request" | null;
  targetUrl: string | null;
  relationshipType: "explicit" | "inferred";
  evidence: string;
  intent: string;
};

export { GithubWorkResourceError };

function projectPath(project: ProjectRef) {
  return `/repos/${encodeURIComponent(project.ownerLogin)}/${encodeURIComponent(project.name)}`;
}

async function fetchLatestDeploymentStatus(
  path: string,
  fetchImpl: FetchFunction,
) {
  if (!process.env.GITHUB_READ_TOKEN_GITATLAS) {
    throw new GithubWorkResourceError(401, "missing_token");
  }
  let response: Response;
  try {
    response = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        ...getGithubHeaders(),
        Authorization: `Bearer ${process.env.GITHUB_READ_TOKEN_GITATLAS}`,
      },
    });
  } catch {
    throw new GithubWorkResourceError(503, "provider_failure");
  }
  if (response.status === 404) return null;
  if (response.status === 429 || response.status === 403) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = Number(retryAfter);
    throw new GithubWorkResourceError(
      429,
      "rate_limited",
      0,
      Number.isFinite(seconds)
        ? new Date(Date.now() + seconds * 1000).toISOString()
        : null,
    );
  }
  if (!response.ok) {
    throw new GithubWorkResourceError(503, "provider_failure");
  }
  const statuses = (await response.json()) as unknown;
  if (!Array.isArray(statuses)) return null;
  return (statuses[0] as GitHubObject | undefined) ?? null;
}

function flatCommit(
  value: string | GitHubFlatCommit | GitHubNestedCommit | undefined,
): GitHubFlatCommit | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if ("commit" in value && typeof value.commit === "object") {
    return value.commit;
  }
  return value as GitHubFlatCommit;
}

function nestedCommit(
  value: string | GitHubFlatCommit | GitHubNestedCommit | undefined,
): GitHubNestedCommit | undefined {
  return typeof value === "object" && value !== null && "commit" in value
    ? (value as GitHubNestedCommit)
    : undefined;
}

function date(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toResource(type: ResourceType, obj: GitHubObject, project: ProjectRef): ResourceInput | null {
  let externalId: string | undefined;
  let sourceUrl = obj.html_url;
  let title = obj.title ?? obj.environment ?? null;
  let refName: string | null = obj.ref ?? null;
  let sourceState = obj.state ?? "unknown";
  let sourceUpdatedAt = date(obj.updated_at);

  if (type === "branch") {
    externalId = obj.name;
    refName = obj.name ?? null;
    title = obj.name ?? null;
    sourceUrl = obj.name
      ? `${project.htmlUrl}/tree/${obj.name.split("/").map(encodeURIComponent).join("/")}`
      : undefined;
    sourceState = "present";
    sourceUpdatedAt = date(nestedCommit(obj.commit)?.commit?.committer?.date ?? nestedCommit(obj.commit)?.commit?.author?.date);
  } else if (type === "commit") {
    externalId = obj.sha;
    // The commits-list payload carries message/author/committer flat under
    // `commit` (see fixtures); the branches payload nests them one deeper.
    const flat = flatCommit(obj.commit);
    title = flat?.message?.split("\n", 1)[0] ?? null;
    sourceUrl = obj.html_url ?? flat?.html_url;
    sourceState = "present";
    sourceUpdatedAt = date(flat?.committer?.date ?? flat?.author?.date);
  } else {
    externalId = typeof obj.id === "number" ? String(obj.id) : undefined;
    if (type === "pull_request") {
      sourceUrl = obj.pull_request?.html_url ?? obj.html_url;
      sourceState = obj.merged_at ? "merged" : (obj.state ?? "unknown");
      // The pull payload's head.ref is the real branch a deployment would
      // target; without it a PR cannot match ref-scoped deployment evidence.
      refName = obj.head?.ref ?? null;
    } else if (type === "deployment") {
      sourceState = obj.latest_status?.state ?? "unknown";
      sourceUpdatedAt = date(obj.latest_status?.created_at ?? obj.updated_at);
      refName = obj.ref ?? null;
      sourceUrl =
        obj.html_url ??
        obj.url ??
        `${project.htmlUrl}/deployments/${externalId}`;
    }
  }
  if (!externalId || !sourceUrl) return null;
  return {
    sourceType: type,
    externalId,
    title,
    sourceUrl,
    sourceState,
    refName,
    createdAt: date(obj.created_at),
    sourceUpdatedAt,
    sourceClosedAt: date(obj.closed_at ?? obj.merged_at),
    issueNumber: typeof obj.number === "number" ? obj.number : null,
  };
}

/**
 * Extract references without interpreting them as changes to the referenced
 * issue/PR. Only explicit same-repository URLs and #number text are retained.
 * Intent verbs (closing/blocking) are recorded as evidence metadata; a
 * mention or closing phrase never changes the referenced object's state.
 *
 * Finding AC: contributor text is untrusted and unbounded. Cap the scanned
 * input (length) and the emitted reference count so a large body cannot
 * generate excessive scans or database writes during work sync.
 */
export const MAX_REFERENCE_TEXT_CHARS = 20_000;
export const MAX_REFERENCES_PER_ITEM = 50;

export function extractWorkReferences(
  text: string | null | undefined,
  owner: string,
  repo: string,
): WorkReferenceInput[] {
  if (!text) return [];
  const bounded = text.slice(0, MAX_REFERENCE_TEXT_CHARS);
  const output = new Map<string, WorkReferenceInput>();
  const prefix = `https://github.com/${owner}/${repo}/`;
  const explicit = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)/gi;
  for (const match of bounded.matchAll(explicit)) {
    if (output.size >= MAX_REFERENCES_PER_ITEM) break;
    if (match[1].toLowerCase() !== owner.toLowerCase() || match[2].toLowerCase() !== repo.toLowerCase()) continue;
    const number = Number(match[4]);
    output.set(`explicit:${number}`, {
      targetNumber: number,
      targetSourceType: match[3] === "pull" ? "pull_request" : "issue",
      targetUrl: `${prefix}${match[3]}/${number}`,
      relationshipType: "explicit",
      evidence: "source_url",
      intent: detectReferenceIntent(bounded, match.index ?? 0),
    });
  }
  const mentions = /(?:^|[^\w])#(\d+)\b/g;
  for (const match of bounded.matchAll(mentions)) {
    if (output.size >= MAX_REFERENCES_PER_ITEM) break;
    const number = Number(match[1]);
    if (!output.has(`explicit:${number}`)) {
      const hashOffset = (match.index ?? 0) + match[0].indexOf("#");
      output.set(`inferred:${number}`, {
        targetNumber: number,
        targetSourceType: null,
        targetUrl: null,
        relationshipType: "inferred",
        evidence: "text_mention",
        intent: detectReferenceIntent(bounded, hashOffset),
      });
    }
  }
  return [...output.values()];
}

function resourceScope(project: Pick<ProjectRef, "githubId">, type: ResourceType | "services" | "agents") {
  return `github:work-resources:${project.githubId}:${type}`;
}

/**
 * Persist fetched items and their references. Extracted so partial page results
 * can be stored before a later page fails.
 *
 * `completeSnapshot` must be true only when `items` is the full successful
 * collection result; tombstoning (finding N) then reconciles vanished rows.
 * Partial/deferred callers leave it false so old rows are retained.
 *
 * Removed references that disappeared from source text are deleted per
 * source item (finding N, second half): the transaction upserts currently
 * found references and deletes that source's references absent from this
 * snapshot. Complete-snapshot-only, like resource tombstoning.
 */
async function persistFetchedItems(
  project: ProjectRef,
  type: ResourceType,
  items: GitHubObject[],
  fetchedAt: Date,
  completeSnapshot = false,
) {
  const selectedItems = items.filter(
    (item) => type !== "issue" || !item.pull_request,
  );
  const resources = selectedItems
    .map((item) => toResource(type, item, project))
    .filter((item): item is ResourceInput => item !== null);
  const references = new Map<string, WorkReferenceInput[]>();
  for (const item of selectedItems) {
    const resource = toResource(type, item, project);
    if (!resource) continue;
    const refs = extractWorkReferences(
      `${item.title ?? ""}\n${item.body ?? ""}`,
      project.ownerLogin,
      project.name,
    );
    if (refs.length) references.set(resource.externalId, refs);
  }

  // Finding N (tombstone, complete-snapshot only): callers pass
  // `completeSnapshot` true only after a fully successful collection fetch.
  // Vanished rows from a complete snapshot are marked stale (sourceState
  // `tombstoned`) so queues stop presenting them; partial/deferred fetches
  // never tombstone.
  await db.$transaction(async (tx) => {
    const seenExternalIds = new Set(
      resources.map((resource) => resource.externalId),
    );
    if (completeSnapshot && typeof tx.workResource.updateMany === "function") {
      await tx.workResource.updateMany({
        where: {
          projectId: project.id,
          sourceType: type,
          externalId: { notIn: [...seenExternalIds] },
          sourceState: { not: "tombstoned" },
        },
        data: { sourceState: "tombstoned", lastSeenAt: fetchedAt },
      });
    }
    for (const resource of resources) {
      await tx.workResource.upsert({
        where: {
          projectId_sourceType_externalId: {
            projectId: project.id,
            sourceType: type,
            externalId: resource.externalId,
          },
        },
        create: {
          projectId: project.id,
          sourceType: type,
          externalId: resource.externalId,
          issueNumber: resource.issueNumber,
          title: resource.title,
          sourceUrl: resource.sourceUrl,
          sourceState: resource.sourceState,
          refName: resource.refName,
          createdAt: resource.createdAt,
          sourceUpdatedAt: resource.sourceUpdatedAt,
          sourceClosedAt: resource.sourceClosedAt,
          lastSeenAt: fetchedAt,
        },
        update: {
          issueNumber: resource.issueNumber,
          title: resource.title,
          sourceUrl: resource.sourceUrl,
          sourceState: resource.sourceState,
          refName: resource.refName,
          createdAt: resource.createdAt,
          sourceUpdatedAt: resource.sourceUpdatedAt,
          sourceClosedAt: resource.sourceClosedAt,
          lastSeenAt: fetchedAt,
        },
      });
    }
    const issueRows = await tx.workResource.findMany({
      where: {
        projectId: project.id,
        sourceType: { in: ["issue", "pull_request"] },
      },
      select: {
        id: true,
        externalId: true,
        issueNumber: true,
        sourceUrl: true,
        sourceType: true,
      },
    });
    const byNumber = new Map<number, (typeof issueRows)[number][]>();
    for (const row of issueRows) {
      if (row.issueNumber != null) {
        const matching = byNumber.get(row.issueNumber) ?? [];
        matching.push(row);
        byNumber.set(row.issueNumber, matching);
      }
    }
    // Track each source's currently-found reference keys so snapshots that
    // removed a link can delete the stale WorkReference rows (finding N).
    const foundKeysBySource = new Map<string, Set<string>>();
    for (const [sourceExternalId, sourceReferences] of references) {
      const source = await tx.workResource.findUnique({
        where: {
          projectId_sourceType_externalId: {
            projectId: project.id,
            sourceType: type,
            externalId: sourceExternalId,
          },
        },
        select: { id: true },
      });
      if (!source) continue;
      const foundKeys = new Set<string>();
      foundKeysBySource.set(sourceExternalId, foundKeys);
      for (const reference of sourceReferences) {
        const candidates = byNumber.get(reference.targetNumber) ?? [];
        const referenceKey = reference.targetSourceType
          ? `${reference.targetSourceType}:${reference.targetNumber}`
          : `number:${reference.targetNumber}`;
        const target =
          reference.targetSourceType !== null
            ? candidates.find(
                (candidate) =>
                  candidate.sourceType === reference.targetSourceType,
              )
            : candidates.length === 1
              ? candidates[0]
              : undefined;
        const classification = classifyReference(reference);
        foundKeys.add(`${reference.relationshipType}:${referenceKey}`);
        await tx.workReference.upsert({
          where: {
            sourceResourceId_targetExternalId_relationshipType: {
              sourceResourceId: source.id,
              targetExternalId: referenceKey,
              relationshipType: reference.relationshipType,
            },
          },
          create: {
            sourceResourceId: source.id,
            targetResourceId: target?.id ?? null,
            targetSourceType: target?.sourceType ?? reference.targetSourceType,
            targetExternalId: referenceKey,
            targetUrl: target?.sourceUrl ?? reference.targetUrl,
            relationshipType: reference.relationshipType,
            evidence: reference.evidence,
            category: classification.category,
            confidence: classification.confidence,
            intent: reference.intent,
          },
          update: {
            targetResourceId: target?.id ?? null,
            targetSourceType: target?.sourceType ?? reference.targetSourceType,
            targetExternalId: referenceKey,
            targetUrl: target?.sourceUrl ?? reference.targetUrl,
            evidence: reference.evidence,
            category: classification.category,
            confidence: classification.confidence,
            intent: reference.intent,
          },
        });
      }
      // Finding N: when the caller certifies a complete snapshot, delete
      // this source's references that disappeared from its text. Sources
      // absent from `references` had zero refs; their stale rows are handled
      // by the resource-level reconciliation when the whole item vanished,
      // and per-source zero-ref cleanup below. Guarded for minimal tx
      // doubles (tests) that only implement upsert/findUnique.
      if (
        completeSnapshot &&
        typeof tx.workReference.findMany === "function" &&
        typeof tx.workReference.delete === "function"
      ) {
        const source = await tx.workResource.findUnique({
          where: {
            projectId_sourceType_externalId: {
              projectId: project.id,
              sourceType: type,
              externalId: sourceExternalId,
            },
          },
          select: { id: true },
        });
        if (source) {
          const found = foundKeysBySource.get(sourceExternalId) ?? new Set();
          const existing = await tx.workReference.findMany({
            where: { sourceResourceId: source.id },
            select: { id: true, targetExternalId: true, relationshipType: true },
          });
          for (const row of existing) {
            if (!found.has(`${row.relationshipType}:${row.targetExternalId}`)) {
              await tx.workReference.delete({ where: { id: row.id } });
            }
          }
        }
      }
    }
    // Sources with zero refs in this complete snapshot: their prior
    // references (if any) are stale.
    if (
      completeSnapshot &&
      typeof tx.workReference.deleteMany === "function"
    ) {
      const withRefs = new Set(references.keys());
      for (const resource of resources) {
        if (withRefs.has(resource.externalId)) continue;
        const source = await tx.workResource.findUnique({
          where: {
            projectId_sourceType_externalId: {
              projectId: project.id,
              sourceType: type,
              externalId: resource.externalId,
            },
          },
          select: { id: true },
        });
        if (!source) continue;
        await tx.workReference.deleteMany({
          where: { sourceResourceId: source.id },
        });
      }
    }
  });
  return resources.length;
}

async function writeScope(
  scope: string,
  details: { status: string; fetchedAt: Date; lastSuccessAt?: Date; itemCount: number; unsupportedCount?: number; pagesFetched: number; errorCode?: string | null; retryAt?: Date | null },
) {
  await db.syncState.upsert({
    where: { scope },
    create: {
      scope,
      status: details.status,
      fetchedAt: details.fetchedAt,
      lastSuccessAt: details.lastSuccessAt ?? null,
      itemCount: details.itemCount,
      unsupportedCount: details.unsupportedCount ?? 0,
      pagesFetched: details.pagesFetched,
      errorCode: details.errorCode ?? null,
      retryAt: details.retryAt ?? null,
    },
    update: {
      status: details.status,
      fetchedAt: details.fetchedAt,
      ...(details.lastSuccessAt ? { lastSuccessAt: details.lastSuccessAt } : {}),
      itemCount: details.itemCount,
      unsupportedCount: details.unsupportedCount ?? 0,
      pagesFetched: details.pagesFetched,
      errorCode: details.errorCode ?? null,
      retryAt: details.retryAt ?? null,
    },
  });
}

async function syncCollection(
  project: ProjectRef,
  type: ResourceType,
  path: string,
  fetchedAt: Date,
  fetchImpl: FetchFunction,
) {
  const prior = await db.syncState.findUnique({
    where: { scope: resourceScope(project, type) },
    select: { retryAt: true, lastSuccessAt: true, itemCount: true },
  });
  if (prior?.retryAt && prior.retryAt.getTime() > fetchedAt.getTime()) {
    await writeScope(resourceScope(project, type), {
      status: "deferred",
      fetchedAt,
      lastSuccessAt: prior.lastSuccessAt ?? undefined,
      itemCount: prior.itemCount,
      pagesFetched: 0,
      errorCode: "rate_limited",
      retryAt: prior.retryAt,
    });
    throw new GithubWorkResourceError(
      429,
      "rate_limited",
      0,
      prior.retryAt.toISOString(),
    );
  }
  let unsupported = false;
  let result: Awaited<ReturnType<typeof fetchPages>>;
  try {
    result = await fetchPages(
      path,
      fetchImpl,
      () => {
        unsupported = true;
      },
      project.githubId,
    );
  } catch (error) {
    const failure =
      error instanceof GithubWorkResourceError
        ? error
        : error instanceof Error && "code" in error
          ? (error as GithubWorkResourceError)
          : new GithubWorkResourceError(503, "sync_failure");
    const prior = await db.syncState.findUnique({
      where: { scope: resourceScope(project, type) },
      select: { lastSuccessAt: true, itemCount: true },
    });
    const partialCount =
      failure.pagesFetched > 0 && failure.fetchedItems.length
        ? await persistFetchedItems(
            project,
            type,
            failure.fetchedItems,
            fetchedAt,
          )
        : 0;
    await writeScope(resourceScope(project, type), {
      status: failure.code === "rate_limited" ? "deferred" : failure.pagesFetched ? "partial" : "failed",
      fetchedAt,
      lastSuccessAt: prior?.lastSuccessAt ?? undefined,
      itemCount: prior?.itemCount ?? partialCount,
      pagesFetched: failure.pagesFetched,
      errorCode: failure.code,
      retryAt: failure.retryAt ? new Date(failure.retryAt) : null,
    });
    throw failure;
  }
  if (unsupported) {
    await writeScope(resourceScope(project, type), {
      status: "unsupported",
      fetchedAt,
      itemCount: 0,
      unsupportedCount: 1,
      pagesFetched: 0,
      errorCode: "scope_unsupported",
    });
    return { count: 0, pages: 0, unsupported: true };
  }

  // Finding O: a failed deployment-status read must not clear the last
  // known success. Track failures; on any non-rate-limit failure preserve
  // prior deployment state (pass the previous status through) and mark the
  // scope partial instead of current.
  let deploymentStatusIncomplete = false;
  if (type === "deployment") {
    // Snapshot prior deployment states so a failed status read can restore
    // them instead of overwriting with unknown.
    const priorDeployments =
      await db.workResource.findMany({
        where: { projectId: project.id, sourceType: "deployment" },
        select: { externalId: true, sourceState: true },
      });
    const priorStateByExternalId = new Map(
      priorDeployments.map((row) => [row.externalId, row.sourceState]),
    );
    for (const deployment of result.items) {
      if (typeof deployment.id !== "number") continue;
      try {
        const latest = await fetchLatestDeploymentStatus(
          `${projectPath(project)}/deployments/${deployment.id}/statuses?per_page=1`,
          fetchImpl,
        );
        deployment.latest_status = latest
          ? { state: latest.state, created_at: latest.created_at }
          : undefined;
      } catch (error) {
        if (error instanceof GithubWorkResourceError && error.code === "rate_limited") {
          const failure = new GithubWorkResourceError(
            error.status,
            error.code,
            result.pagesFetched + error.pagesFetched,
            error.retryAt,
          );
          const priorScope = await db.syncState.findUnique({
            where: { scope: resourceScope(project, type) },
            select: { lastSuccessAt: true, itemCount: true },
          });
          await writeScope(resourceScope(project, type), {
            status: "deferred",
            fetchedAt,
            lastSuccessAt: priorScope?.lastSuccessAt ?? undefined,
            itemCount: priorScope?.itemCount ?? 0,
            pagesFetched: failure.pagesFetched,
            errorCode: failure.code,
            retryAt: failure.retryAt ? new Date(failure.retryAt) : null,
          });
          throw failure;
        }
        // Preserve the last known state; only fall back to unknown when the
        // provider actually reported unavailable (null) or no prior exists.
        deploymentStatusIncomplete = true;
        const externalId = String(deployment.id);
        const prior = priorStateByExternalId.get(externalId);
        deployment.latest_status = prior
          ? { state: prior, created_at: deployment.updated_at ?? null }
          : undefined;
      }
    }
  }

  // Finding N: this is the complete-snapshot path — the whole collection
  // fetched successfully — so tombstone vanished rows.
  const resourceCount = await persistFetchedItems(
    project,
    type,
    result.items,
    fetchedAt,
    true,
  );
  if (deploymentStatusIncomplete) {
    const priorScope = await db.syncState.findUnique({
      where: { scope: resourceScope(project, type) },
      select: { lastSuccessAt: true, itemCount: true },
    });
    await writeScope(resourceScope(project, type), {
      status: "partial",
      fetchedAt,
      lastSuccessAt: priorScope?.lastSuccessAt ?? fetchedAt,
      itemCount: resourceCount,
      pagesFetched: result.pagesFetched,
      errorCode: "deployment_status_incomplete",
    });
    return { count: resourceCount, pages: result.pagesFetched, unsupported: false };
  }
  await writeScope(resourceScope(project, type), {
    status: "current",
    fetchedAt,
    lastSuccessAt: fetchedAt,
    itemCount: resourceCount,
    pagesFetched: result.pagesFetched,
  });
  return { count: resourceCount, pages: result.pagesFetched, unsupported: false };
}

export async function syncProjectWorkResources(
  project: ProjectRef,
  options: { fetchImpl?: FetchFunction; fetchedAt?: Date } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.fetchedAt ?? new Date();
  const base = projectPath(project);
  const results: Record<string, { count: number; pages: number; unsupported: boolean }> = {};
  // Agents/services have no GitHub collection behind them: they are a
  // standing declared-unsupported pair, recorded on every run (success or
  // failure) so coverage reads stay honest.
  for (const type of ["services", "agents"] as const) {
    await writeScope(resourceScope(project, type), {
      status: "unsupported",
      fetchedAt,
      itemCount: 0,
      unsupportedCount: 1,
      pagesFetched: 0,
      errorCode: "source_unavailable",
    });
  }
  // Collections run in order; the first failure aborts the run (later
  // collections stay `unattempted`, never `unsupported`) while already
  // persisted pages are retained and the failed scope is marked
  // partial/failed/deferred.
  const collections = [
    ["issues", "issue", `${base}/issues?state=all`],
    ["pullRequests", "pull_request", `${base}/pulls?state=all`],
    ["branches", "branch", `${base}/branches`],
    ["commits", "commit", `${base}/commits`],
    ["deployments", "deployment", `${base}/deployments`],
  ] as const;
  let failed = false;
  for (const [key, type, collectionPath] of collections) {
    if (failed) {
      await writeScope(resourceScope(project, type), {
        status: "unattempted",
        fetchedAt,
        itemCount: 0,
        pagesFetched: 0,
        errorCode: "not_attempted",
      });
      results[key] = { count: 0, pages: 0, unsupported: false };
      continue;
    }
    try {
      results[key] = await syncCollection(
        project,
        type,
        collectionPath,
        fetchedAt,
        fetchImpl,
      );
    } catch (error) {
      // Mark every remaining collection unattempted (never unsupported: we
      // simply did not reach them) before surfacing the failure.
      const remaining = collections.slice(
        collections.findIndex(([k]) => k === key) + 1,
      );
      for (const [, remainingType] of remaining) {
        await writeScope(resourceScope(project, remainingType), {
          status: "unattempted",
          fetchedAt,
          itemCount: 0,
          pagesFetched: 0,
          errorCode: "not_attempted",
        });
        const remainingKey = collections.find(
          ([, t]) => t === remainingType,
        )?.[0];
        if (remainingKey) {
          results[remainingKey] = { count: 0, pages: 0, unsupported: false };
        }
      }
      failed = true;
      throw error;
    }
  }
  return results;
}

export function getWorkResourceScope(
  project: Pick<ProjectRef, "githubId">,
  type: ResourceType | "services" | "agents",
) {
  return resourceScope(project, type);
}
