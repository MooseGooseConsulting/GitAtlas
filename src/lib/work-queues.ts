// Evidence-derived work queue types. Pure types only (no Prisma import)
// so client components can import from here without pulling the server DB.
//
// Queues are derived from persisted WorkResource rows + WorkReference rows.
// Nothing is inferred from text mentions: mention-only links land in
// `uncertain`, never in a confirmed queue.

export type QueueName =
  | "attention"
  | "active"
  | "recent"
  | "blocked"
  | "ready"
  | "stale";

export type QueueEntry = {
  resourceId: string;
  projectId: string;
  projectFullName: string;
  sourceType: string;
  externalId: string;
  issueNumber: number | null;
  title: string | null;
  sourceUrl: string;
  sourceState: string;
  sourceUpdatedAt: string | null;
};

export type UncertainEntry = {
  resourceId: string;
  projectId: string;
  projectFullName: string;
  reason:
    | "mention_only_blocker"
    | "missing_timestamp"
    | "missing_scope_evidence"
    | "unavailable_scope_evidence";
  detail: string;
};

export type CoverageEvidence = "current" | "stale" | "missing" | "degraded";

export type CoverageEntry = {
  projectId: string;
  projectFullName: string;
  evidence: CoverageEvidence;
};

export type WorkQueues = {
  generatedAt: string;
  queues: Record<QueueName, QueueEntry[]>;
  uncertain: UncertainEntry[];
  coverage: CoverageEntry[];
};

// Work-scope freshness window. Defined here (never mocked) so both the
// server loader and the pure view builder share one clock-relative window.
export const WORK_SCOPE_STALE_MS = 6 * 60 * 60 * 1000;
