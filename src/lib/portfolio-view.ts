import type { Project } from "@/lib/types";
import type { PortfolioStatusFilter } from "@/lib/types";
import type {
  CoverageEntry,
  QueueEntry,
  QueueName,
  WorkQueues,
} from "@/lib/work-queues";
import { WORK_SCOPE_STALE_MS } from "@/lib/work-queues";

export type { PortfolioStatusFilter };
export { WORK_SCOPE_STALE_MS };

export type WorkScopeLabel =
  | "populated"
  | "retained_unverified"
  | "stale"
  | "failed"
  | "unsupported"
  | "unattempted"
  | "empty";

export type WorkScopeState = {
  sourceType: string;
  /** Semantic palette key consumed by SemanticBadge. */
  label: WorkScopeLabel;
  retainedRowCount: number;
  currentCount: number;
  staleCount: number;
  failedCount: number;
  unsupportedCount: number;
  unattemptedProjects: number;
  lastSuccessAt: string | null;
  errorCodes: Record<string, number>;
};

export type PortfolioCorpus = {
  total: number;
  current: number;
  retainedUnverified: number;
  stale: number;
  privateCount: number;
  archived: number;
};

export type PortfolioInventory = {
  status: string;
  errorCode: string | null;
  itemCount: number;
  lastSuccessAt: string | null;
};

export type PortfolioSummary = {
  emptyCorpus: boolean;
  corpus: PortfolioCorpus;
  inventory: PortfolioInventory;
  workScopes: WorkScopeState[];
  queues: WorkQueues | null;
};

type SyncStateRow = {
  scope: string;
  status: string;
  lastSuccessAt: Date | null;
  errorCode: string | null;
  itemCount: number;
  unsupportedCount: number;
};

export type BuildPortfolioSummaryInput = {
  now: Date;
  totalProjects: number;
  statusCounts: Record<string, number>;
  visibilityCounts: Record<string, number>;
  archivedCount: number;
  inventoryScope: {
    status: string;
    lastSuccessAt: Date | null;
    errorCode: string | null;
    itemCount: number;
  } | null;
  workScopeStates: SyncStateRow[];
  retainedRowCounts: Record<string, number>;
  queues: WorkQueues | null;
};

const KNOWN_WORK_TYPES = [
  "issue",
  "pull_request",
  "branch",
  "commit",
  "deployment",
  "services",
  "agents",
] as const;

/**
 * A work scope is current only when its sync status is current AND its
 * last success is within WORK_SCOPE_STALE_MS of the real clock. A pinned
 * old date decays to retained_unverified so stale evidence is never
 * presented as current.
 */
function isScopeCurrent(
  state: SyncStateRow,
  nowMs: number,
): boolean {
  if (state.status !== "current") return false;
  if (!state.lastSuccessAt) return false;
  return nowMs - state.lastSuccessAt.getTime() <= WORK_SCOPE_STALE_MS;
}

function scopeLabelFor(
  sourceType: string,
  states: SyncStateRow[],
  retainedRowCount: number,
  nowMs: number,
): { label: WorkScopeLabel; counts: Omit<WorkScopeState, "sourceType" | "label" | "retainedRowCount" | "lastSuccessAt" | "errorCodes"> & { lastSuccessAt: string | null; errorCodes: Record<string, number> } } {
  const errorCodes: Record<string, number> = {};
  let currentCount = 0;
  let staleCount = 0;
  let failedCount = 0;
  let unsupportedCount = 0;
  let latestSuccess: Date | null = null;

  for (const state of states) {
    if (state.errorCode) {
      errorCodes[state.errorCode] = (errorCodes[state.errorCode] ?? 0) + 1;
    }
    if (state.lastSuccessAt && (!latestSuccess || state.lastSuccessAt > latestSuccess)) {
      latestSuccess = state.lastSuccessAt;
    }
    if (state.status === "unsupported") {
      unsupportedCount += 1;
    } else if (state.status === "failed" || state.status === "deferred") {
      failedCount += 1;
    } else if (state.status === "current" && isScopeCurrent(state, nowMs)) {
      currentCount += 1;
    } else if (state.status === "current" || state.status === "partial") {
      staleCount += 1;
    } else if (state.status === "partial") {
      staleCount += 1;
    }
  }

  // Finding Y: an explicit `unattempted` sync status must keep its
  // `unattempted` label (never attempted ≠ checked-and-empty). The trailing
  // `empty` applies only when no unattempted scopes exist and no rows were
  // retained; the always-zero count below is fixed to count unattempted
  // scopes.
  const hasUnattempted = states.some((state) => state.status === "unattempted");
  const unattemptedCount = states.filter(
    (state) => state.status === "unattempted",
  ).length;

  let label: WorkScopeLabel;
  if (states.length === 0 || hasUnattempted) {
    label = "unattempted";
  } else if (unsupportedCount > 0 && currentCount === 0 && staleCount === 0 && failedCount === 0) {
    label = "unsupported";
  } else if (currentCount > 0) {
    label = "populated";
  } else if (retainedRowCount > 0) {
    // Rows were retained from a prior sync but no scope re-verified them
    // within the freshness window.
    label = "retained_unverified";
  } else if (failedCount > 0) {
    label = "failed";
  } else if (staleCount > 0) {
    label = "stale";
  } else if (retainedRowCount === 0) {
    label = "empty";
  } else {
    label = "retained_unverified";
  }

  return {
    label,
    counts: {
      currentCount,
      staleCount,
      failedCount,
      unsupportedCount,
      unattemptedProjects: unattemptedCount,
      lastSuccessAt: latestSuccess ? latestSuccess.toISOString() : null,
      errorCodes,
    },
  };
}

export function buildPortfolioSummary(
  input: BuildPortfolioSummaryInput,
): PortfolioSummary {
  const emptyCorpus = input.totalProjects === 0;
  const nowMs = input.now.getTime();
  const current = input.statusCounts["current"] ?? 0;
  const stale = input.statusCounts["stale"] ?? 0;
  const unverified =
    input.totalProjects -
    Object.entries(input.statusCounts).reduce(
      (sum, [status, count]) =>
        status === "current" || status === "stale" ? sum + count : sum,
      0,
    );

  const corpus: PortfolioCorpus = {
    total: input.totalProjects,
    current,
    retainedUnverified: Math.max(unverified, 0),
    stale,
    privateCount: input.visibilityCounts["private"] ?? 0,
    archived: input.archivedCount,
  };

  const inventory: PortfolioInventory = {
    status: input.inventoryScope?.status ?? "unknown",
    errorCode: input.inventoryScope?.errorCode ?? null,
    itemCount: input.inventoryScope?.itemCount ?? 0,
    lastSuccessAt: input.inventoryScope?.lastSuccessAt
      ? input.inventoryScope.lastSuccessAt.toISOString()
      : null,
  };

  // Scope is derived from retained rows: every sourceType with retained
  // rows gets a scope entry even when no sync state exists (unattempted
  // with retained history), and every sync-state scope gets an entry even
  // with zero retained rows.
  const statesByType = new Map<string, SyncStateRow[]>();
  for (const state of input.workScopeStates) {
    const type = state.scope.split(":").at(-1) ?? state.scope;
    const list = statesByType.get(type) ?? [];
    list.push(state);
    statesByType.set(type, list);
  }
  const allTypes = new Set<string>([
    ...KNOWN_WORK_TYPES,
    ...Object.keys(input.retainedRowCounts),
    ...statesByType.keys(),
  ]);

  const workScopes: WorkScopeState[] = [...allTypes]
    .sort()
    .map((sourceType) => {
      const states = statesByType.get(sourceType) ?? [];
      const retainedRowCount = input.retainedRowCounts[sourceType] ?? 0;
      const { label, counts } = scopeLabelFor(
        sourceType,
        states,
        retainedRowCount,
        nowMs,
      );
      return {
        sourceType,
        label,
        retainedRowCount,
        ...counts,
      };
    });

  return {
    emptyCorpus,
    corpus,
    inventory,
    workScopes,
    queues: input.queues,
  };
}

type FilterableProject = Pick<
  Project,
  "id" | "fullName" | "name" | "description" | "language" | "isArchived" | "visibility"
> & {
  inventoryStatus?: string | null;
};

/**
 * Filter the repository list by shared search text + selected status.
 * Queue membership comes from the summary queues (projectId sets built
 * from the evidence-derived rows), not from re-deriving anything client-side.
 */
export function filterPortfolioProjects<T extends FilterableProject>(
  projects: T[],
  searchQuery: string,
  filter: PortfolioStatusFilter,
  queues: WorkQueues | null,
): T[] {
  const query = searchQuery.trim().toLowerCase();
  const matchingWorkProjectIds = new Set<string>();
  if (query && queues) {
    const matching = narrowWorkQueues(queues, searchQuery, new Set(projects.map(project => project.id)));
    for (const entries of Object.values(matching.queues)) {
      for (const entry of entries) matchingWorkProjectIds.add(entry.projectId);
    }
    for (const entry of matching.uncertain) matchingWorkProjectIds.add(entry.projectId);
  }
  const queueProjectIds = new Map<QueueName, Set<string>>();
  if (queues) {
    (Object.keys(queues.queues) as QueueName[]).forEach((name) => {
      queueProjectIds.set(
        name,
        new Set(queues.queues[name].map((entry) => entry.projectId)),
      );
    });
  }
  const uncertainIds = new Set(
    (queues?.uncertain ?? []).map((entry) => entry.projectId),
  );

  return projects.filter((project) => {
    if (query) {
      const haystack = [project.fullName, project.name, project.description ?? "", project.language ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query) && !matchingWorkProjectIds.has(project.id)) return false;
    }
    switch (filter) {
      case "all":
        return true;
      case "attention":
      case "active":
      case "recent":
      case "blocked":
      case "ready":
      case "stale":
        return queueProjectIds.get(filter)?.has(project.id) ?? false;
      case "uncertain":
        return uncertainIds.has(project.id);
      case "unverified":
        return (project.inventoryStatus ?? "unverified") !== "current";
      case "archived":
        return project.isArchived;
      case "private":
        return project.visibility === "private";
      default:
        return true;
    }
  });
}

/**
 * Narrow work-queue rows with the same shared search and the same surviving
 * repository set as the list: a row survives when it matches the query
 * (work title or owning repository) and is owned by a repository that
 * survived both filters. Totals above keep the unfiltered counts.
 */
export function narrowWorkQueues(
  queues: WorkQueues,
  searchQuery: string,
  survivingProjectIds: Set<string>,
): WorkQueues {
  const query = searchQuery.trim().toLowerCase();
  const matches = (entry: QueueEntry): boolean => {
    if (!survivingProjectIds.has(entry.projectId)) return false;
    if (!query) return true;
    const haystack = [entry.title ?? "", entry.projectFullName, entry.sourceType, String(entry.issueNumber ?? ""), entry.externalId]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  };
  const narrowed = {} as WorkQueues["queues"];
  (Object.keys(queues.queues) as QueueName[]).forEach((name) => {
    narrowed[name] = queues.queues[name].filter(matches);
  });
  const uncertain = queues.uncertain.filter((entry) => {
    if (!survivingProjectIds.has(entry.projectId)) return false;
    if (!query) return true;
    return [entry.detail, entry.projectFullName, entry.reason]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const coverage: CoverageEntry[] = queues.coverage.filter((entry) =>
    survivingProjectIds.has(entry.projectId),
  );
  return {
    generatedAt: queues.generatedAt,
    queues: narrowed,
    uncertain,
    coverage,
  };
}
