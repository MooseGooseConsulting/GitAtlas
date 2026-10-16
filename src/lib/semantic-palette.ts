// Shared semantic status palette. Single source of truth for what each
// status word means across the landing, detail panel, graph and legends —
// in light and dark, with text/icons beside every color (color is never the
// only signal).
//
// Every key has paired light/dark Tailwind classes so both themes stay
// reachable via the ThemeToggle.

export type SemanticStatusKey =
  | "analysis_completed"
  | "analysis_pending"
  | "analysis_failed"
  | "analysis_stale"
  | "analysis_unknown"
  | "inventory_current"
  | "inventory_partial"
  | "inventory_stale"
  | "inventory_failed"
  | "inventory_deferred"
  | "inventory_unknown"
  | "retained_unverified"
  | "populated"
  | "stale"
  | "failed"
  | "unsupported"
  | "unattempted"
  | "empty"
  | "evidence_current"
  | "evidence_stale"
  | "evidence_missing"
  | "evidence_degraded";

export type SemanticStatus = {
  key: SemanticStatusKey;
  label: string;
  className: string;
};

const PALETTE: Record<SemanticStatusKey, { label: string; className: string }> = {
  analysis_completed: {
    label: "Analyzed",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  analysis_pending: {
    label: "Analysis pending",
    className:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  analysis_failed: {
    label: "Analysis failed",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  analysis_stale: {
    label: "Analysis stale",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  analysis_unknown: {
    label: "Not analyzed",
    className:
      "border-border/30 bg-card/40 text-muted-foreground",
  },
  inventory_current: {
    label: "Inventory current",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  inventory_partial: {
    label: "Inventory partial",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  inventory_stale: {
    label: "Inventory stale",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  inventory_failed: {
    label: "Inventory failed",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  inventory_deferred: {
    label: "Inventory deferred",
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  inventory_unknown: {
    label: "Inventory unknown",
    className: "border-border/30 bg-card/40 text-muted-foreground",
  },
  retained_unverified: {
    label: "Retained, not re-verified",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  populated: {
    label: "Populated",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  stale: {
    label: "Stale",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  failed: {
    label: "Failed",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  unsupported: {
    label: "Unsupported",
    className:
      "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
  unattempted: {
    label: "Not attempted",
    className: "border-border/30 bg-card/40 text-muted-foreground",
  },
  empty: {
    label: "Empty",
    className: "border-border/30 bg-card/40 text-muted-foreground",
  },
  evidence_current: {
    label: "Evidence current",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  evidence_stale: {
    label: "Evidence stale",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  evidence_missing: {
    label: "Evidence missing",
    className:
      "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
  evidence_degraded: {
    label: "Evidence degraded",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
};

export function getSemanticStatus(key: SemanticStatusKey): SemanticStatus {
  const entry = PALETTE[key];
  return { key, label: entry.label, className: entry.className };
}

const ANALYSIS_ALIASES: Record<string, SemanticStatusKey> = {
  completed: "analysis_completed",
  current: "analysis_completed",
  pending: "analysis_pending",
  idle: "analysis_pending",
  failed: "analysis_failed",
  stale: "analysis_stale",
  skipped: "analysis_unknown",
  none: "analysis_unknown",
  unknown: "analysis_unknown",
};

const INVENTORY_ALIASES: Record<string, SemanticStatusKey> = {
  current: "inventory_current",
  partial: "inventory_partial",
  stale: "inventory_stale",
  failed: "inventory_failed",
  deferred: "inventory_deferred",
  syncing: "inventory_deferred",
  unknown: "inventory_unknown",
  unsupported: "inventory_unknown",
};

export function semanticStatusKeyForAnalysis(status: string): SemanticStatusKey {
  return ANALYSIS_ALIASES[status.toLowerCase()] ?? "analysis_unknown";
}

export function semanticStatusKeyForInventory(status: string): SemanticStatusKey {
  return INVENTORY_ALIASES[status.toLowerCase()] ?? "inventory_unknown";
}
