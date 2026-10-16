import { db } from "@/lib/db";
import type {
  CoverageEntry,
  CoverageEvidence,
  QueueEntry,
  QueueName,
  UncertainEntry,
  WorkQueues,
} from "@/lib/work-queues";
import { WORK_SCOPE_STALE_MS } from "@/lib/work-queues";

export { WORK_SCOPE_STALE_MS };
const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_UNCHANGED_MS = 90 * 24 * 60 * 60 * 1000;

const QUEUE_NAMES: QueueName[] = [
  "attention",
  "active",
  "recent",
  "blocked",
  "ready",
  "stale",
];

export type ProjectFilter = { githubId?: number };

type ResourceRow = {
  id: string;
  projectId: string;
  sourceType: string;
  externalId: string;
  issueNumber: number | null;
  title: string | null;
  sourceUrl: string;
  sourceState: string;
  refName: string | null;
  createdAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceClosedAt: Date | null;
  project: { id: string; githubId: number; fullName: string };
  references: Array<{
    targetExternalId: string;
    targetSourceType: string | null;
    targetUrl: string | null;
    relationshipType: string;
    evidence: string;
    category: string;
    confidence: string;
    intent: string;
    targetResourceId: string | null;
    targetResource: {
      id: string;
      sourceState: string;
      sourceClosedAt: Date | null;
    } | null;
  }>;
};

// OWNER FLAG (finding X): `isOpenState` counts branch/commit `present`
// and deployment `success`/`unknown` as open work, which inflates
// active/recent/stale/ready windows. Whether successful deployments or
// present branches count as actionable work is a product definition —
// NOT redefined here by design; owner to rule.
function isOpenState(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized !== "closed" && normalized !== "merged" && normalized !== "completed";
}

function toQueueEntry(row: ResourceRow): QueueEntry {
  return {
    resourceId: row.id,
    projectId: row.projectId,
    projectFullName: row.project.fullName,
    sourceType: row.sourceType,
    externalId: row.externalId,
    issueNumber: row.issueNumber,
    title: row.title,
    sourceUrl: row.sourceUrl,
    sourceState: row.sourceState,
    sourceUpdatedAt: row.sourceUpdatedAt
      ? row.sourceUpdatedAt.toISOString()
      : null,
  };
}

// Finding X (queue-correctness, small parts only): scan every explicit
// target and prefer blocking/closing intent over a plain reference, so a
// neutral open link earlier in unspecified ordering cannot hide a later
// explicit blocker. `isOpenState` itself is an OWNER product call — flagged,
// NOT redefined here.
function explicitOpenTarget(row: ResourceRow): ResourceRow["references"][number] | null {
  let fallback: ResourceRow["references"][number] | null = null;
  for (const reference of row.references) {
    if (reference.relationshipType !== "explicit") continue;
    if (reference.evidence !== "source_url") continue;
    const target = reference.targetResource;
    if (!target) continue;
    if (isOpenState(target.sourceState) && !target.sourceClosedAt) {
      if (
        reference.intent === "blocking" ||
        reference.intent === "closing" ||
        reference.intent === "blocks"
      ) {
        return reference;
      }
      fallback ??= reference;
    }
  }
  return fallback;
}

function hasMentionOnlyBlockerIntent(row: ResourceRow): boolean {
  return row.references.some(
    (reference) =>
      reference.relationshipType === "inferred" &&
      (reference.intent === "blocking" || reference.intent === "closing"),
  );
}

/**
 * Derive evidence-backed work queues from persisted rows. Read-only.
 *
 * Classification rules:
 * - Only explicit same-repository source_url references to still-open
 *   targets count as confirmed relationships. Inferred (#number) mentions
 *   never confirm a queue — they are recorded in `uncertain`.
 * - blocked: explicit blocking intent toward an open target.
 * - attention: explicit blocking link to an open target, or a failed
 *   deployment state.
 * - ready: open PR with a same-ref successful deployment (head.ref must be
 *   present; missing head.ref never qualifies).
 * - active: open items updated in the last 14 days; recent: updated in the
 *   last 7 days; stale: open and unchanged for over 90 days.
 * - Items without timestamps are uncertain (missing_timestamp), never
 *   silently dropped.
 */
export async function loadWorkQueues(
  projectFilter: ProjectFilter = {},
): Promise<WorkQueues | null> {
  const now = Date.now();
  let projectIds: string[] | null = null;
  if (projectFilter.githubId !== undefined) {
    const project = await db.project.findUnique({
      where: { githubId: projectFilter.githubId },
      select: {
        id: true,
        githubId: true,
        fullName: true,
        inventoryStatus: true,
      },
    });
    if (!project) return null;
    projectIds = [project.id];
  }

  const projects = projectIds
    ? await db.project.findMany({
        where: { id: { in: projectIds } },
        select: {
          id: true,
          githubId: true,
          fullName: true,
          inventoryStatus: true,
        },
      })
    : await db.project.findMany({
        select: {
          id: true,
          githubId: true,
          fullName: true,
          inventoryStatus: true,
        },
      });

  if (projectFilter.githubId !== undefined && projects.length === 0) {
    return null;
  }

  // Finding N: tombstoned rows (reconciled as vanished in a complete
  // snapshot) are retained history, never queue members.
  const resources = (await db.workResource.findMany({
    where: projectIds
      ? { projectId: { in: projectIds }, sourceState: { not: "tombstoned" } }
      : { sourceState: { not: "tombstoned" } },
    orderBy: [{ sourceUpdatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      project: { select: { id: true, githubId: true, fullName: true } },
      references: {
        select: {
          targetExternalId: true,
          targetSourceType: true,
          targetUrl: true,
          relationshipType: true,
          evidence: true,
          category: true,
          confidence: true,
          intent: true,
          targetResourceId: true,
          targetResource: {
            select: {
              id: true,
              sourceState: true,
              sourceClosedAt: true,
            },
          },
        },
      },
    },
  })) as unknown as ResourceRow[];

  // Per-project sync scope evidence: which resource types have current
  // evidence vs missing/stale/unavailable. Clock-relative against Date.now().
  const scopeStates = await db.syncState.findMany({
    where: projectIds
      ? {
          scope: {
            startsWith: "github:work-resources:",
          },
        }
      : {
          scope: {
            startsWith: "github:work-resources:",
          },
        },
    select: {
      scope: true,
      status: true,
      lastSuccessAt: true,
    },
  });
  const scopeByScope = new Map(
    scopeStates.map((state) => [state.scope, state]),
  );

  const queues: Record<QueueName, QueueEntry[]> = {
    attention: [],
    active: [],
    recent: [],
    blocked: [],
    ready: [],
    stale: [],
  };
  const uncertain: UncertainEntry[] = [];
  const coverage: CoverageEntry[] = [];
  const seenPerQueue = new Map<QueueName, Set<string>>(
    QUEUE_NAMES.map((name) => [name, new Set<string>()]),
  );

  function push(queue: QueueName, row: ResourceRow) {
    const seen = seenPerQueue.get(queue);
    if (seen && !seen.has(row.id)) {
      seen.add(row.id);
      queues[queue].push(toQueueEntry(row));
    }
  }

  // Deployment outcome by refName per project, for ready-to-land matching.
  // Finding X: a newer failed deployment on a ref disqualifies ready even
  // when an older success row exists — compare latest timestamps per ref.
  const deployOutcomeByProjectRef = new Map<
    string,
    { state: string; at: number }
  >();
  for (const row of resources) {
    if (row.sourceType !== "deployment") continue;
    if (!row.refName) continue;
    const at = row.sourceUpdatedAt ? row.sourceUpdatedAt.getTime() : 0;
    const key = `${row.projectId}::${row.refName}`;
    const prior = deployOutcomeByProjectRef.get(key);
    if (!prior || at >= prior.at) {
      deployOutcomeByProjectRef.set(key, {
        state: row.sourceState.toLowerCase(),
        at,
      });
    }
  }
  const successRefsByProject = new Map<string, Set<string>>();
  for (const [key, outcome] of deployOutcomeByProjectRef) {
    if (outcome.state !== "success") continue;
    const [projectId, refName] = key.split("::");
    const refs = successRefsByProject.get(projectId) ?? new Set<string>();
    refs.add(refName);
    successRefsByProject.set(projectId, refs);
  }

  for (const row of resources) {
    const updatedAt = row.sourceUpdatedAt ? row.sourceUpdatedAt.getTime() : null;
    const ageMs = updatedAt === null ? null : now - updatedAt;
    const open = isOpenState(row.sourceState) && !row.sourceClosedAt;
    const blockingTarget = explicitOpenTarget(row);
    // Finding X: a `closing` reference (e.g. "Fixes #12") is not a blocker
    // — only `blocking`/`blocks` intent puts the source in blocked. Closing
    // intent still counts for attention via the explicit-link rule below.
    const blockingIntent =
      blockingTarget !== null &&
      (blockingTarget.intent === "blocking" ||
        blockingTarget.intent === "blocks");
    const failedDeployment =
      row.sourceType === "deployment" &&
      ["failure", "failed", "error"].includes(row.sourceState.toLowerCase());

    if (hasMentionOnlyBlockerIntent(row) && !blockingTarget) {
      uncertain.push({
        resourceId: row.id,
        projectId: row.projectId,
        projectFullName: row.project.fullName,
        reason: "mention_only_blocker",
        detail: `Blocking or closing language toward #number mentions is not backed by an explicit linked target for ${row.sourceType} ${row.externalId}.`,
      });
    }

    if (updatedAt === null) {
      uncertain.push({
        resourceId: row.id,
        projectId: row.projectId,
        projectFullName: row.project.fullName,
        reason: "missing_timestamp",
        detail: `${row.sourceType} ${row.externalId} has no source timestamp, so recency queues cannot be evaluated.`,
      });
    }

    // Blocked: explicit blocking link to an open target (never inferred,
    // never closing intent).
    if (open && blockingIntent) {
      push("blocked", row);
    }
    // Attention: explicit blocking/closing links to an open target, or
    // failed deployments. Closing intent lands here but not in blocked.
    const attentionIntent =
      blockingTarget !== null &&
      (blockingTarget.intent === "blocking" ||
        blockingTarget.intent === "blocks" ||
        blockingTarget.intent === "closing");
    if (attentionIntent || failedDeployment) {
      push("attention", row);
    }
    // Ready: open PR with a same-ref recorded deployment success.
    // Finding X: per-ref latest-state check happens at read time — a newer
    // failed deployment on the same ref disqualifies ready even when an
    // older success row exists. Success rows older than any failure on the
    // same ref are ignored.
    if (
      open &&
      row.sourceType === "pull_request" &&
      row.refName !== null &&
      (successRefsByProject.get(row.projectId)?.has(row.refName) ?? false)
    ) {
      push("ready", row);
    }
    // Active / recent / stale recency windows (open items with timestamps).
    if (open && ageMs !== null) {
      if (ageMs <= ACTIVE_WINDOW_MS) push("active", row);
      if (ageMs <= RECENT_WINDOW_MS) push("recent", row);
      if (ageMs > STALE_UNCHANGED_MS) push("stale", row);
    }
  }

  for (const project of projects) {
    const prefix = `github:work-resources:${project.githubId}:`;
    const scoped = [...scopeByScope.entries()].filter(([scope]) =>
      scope.startsWith(prefix),
    );
    let evidence: CoverageEvidence = "missing";
    if (scoped.length > 0) {
      const statuses = scoped.map(([, state]) => state);
      const anyFailed = statuses.some(
        (state) =>
          state.status === "failed" || state.status === "partial" || state.status === "deferred",
      );
      const anyCurrentFresh = statuses.some(
        (state) =>
          state.status === "current" &&
          state.lastSuccessAt !== null &&
          now - state.lastSuccessAt.getTime() <= WORK_SCOPE_STALE_MS &&
          project.inventoryStatus === "current",
      );
      const anyStaleFresh = statuses.some(
        (state) =>
          state.status === "current" &&
          (state.lastSuccessAt === null ||
            now - state.lastSuccessAt.getTime() > WORK_SCOPE_STALE_MS ||
            project.inventoryStatus !== "current"),
      );
      const anyUnsupported = statuses.some(
        (state) => state.status === "unsupported",
      );
      if (anyCurrentFresh && !anyFailed) {
        evidence = "current";
      } else if (anyStaleFresh) {
        evidence = "stale";
      } else if (anyFailed) {
        evidence = "degraded";
      } else if (anyUnsupported) {
        evidence = "missing";
      }
      // Scopes whose evidence is missing or unavailable keep their rows
      // visible in `uncertain` instead of silently vanishing.
      if (evidence === "missing" || evidence === "degraded") {
        const hasRows = resources.some((row) => row.projectId === project.id);
        if (!hasRows) {
          uncertain.push({
            resourceId: `${project.id}:scope-evidence`,
            projectId: project.id,
            projectFullName: project.fullName,
            reason:
              evidence === "missing"
                ? "missing_scope_evidence"
                : "unavailable_scope_evidence",
            detail: `No usable sync evidence for ${project.fullName}; empty queues here mean missing evidence, not no work.`,
          });
        }
      }
    } else {
      // No scope rows attempted at all for this project.
      uncertain.push({
        resourceId: `${project.id}:scope-evidence`,
        projectId: project.id,
        projectFullName: project.fullName,
        reason: "missing_scope_evidence",
        detail: `Work sync has not been attempted for ${project.fullName}; empty queues here mean missing evidence, not no work.`,
      });
    }
    coverage.push({
      projectId: project.id,
      projectFullName: project.fullName,
      evidence,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    queues,
    uncertain,
    coverage,
  };
}
