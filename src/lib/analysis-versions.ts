/**
 * Revision state for a single repository analysis version.
 *
 * Why this file exists: GET /api/analysis/versions exposes every retained
 * RepositoryAnalysis row, but a raw `status` is not enough for the UI. A
 * `completed` row whose analyzedSha no longer matches the project's
 * defaultBranchHeadSha is superseded history and must render stale; rows
 * still in `pending`/`failed` quota backoff are non-authoritative work, not
 * conclusions. This pure helper keeps that presentation rule in one place so
 * the route stays a thin read.
 */

export type AnalysisVersionState =
  | "completed"
  | "completed_stale"
  | "pending"
  | "failed"
  | "processing"
  | "stale";

/**
 * Derive the presentation state of one analysis version.
 *
 * - `completed` is current only while its analyzedSha still matches the live
 *   head. Any drift (or an unverifiable null SHA on either side) makes it
 *   `completed_stale`: retained history, never a current result.
 * - Rows already marked `stale` by the worker are superseded history too, so
 *   they also present as `completed_stale` (which is what the route's
 *   `stale` flag keys on).
 * - `pending` / `failed` / `processing` pass through unchanged: explicit
 *   non-authoritative work states.
 * - Unknown statuses default to `pending` so nothing unfamiliar can ever be
 *   presented as a current completed analysis.
 */
export function analysisVersionState(
  status: string,
  analyzedSha: string | null,
  headSha: string | null,
): AnalysisVersionState {
  if (status === "completed") {
    return analyzedSha && headSha && analyzedSha === headSha
      ? "completed"
      : "completed_stale";
  }
  if (status === "stale") {
    return "completed_stale";
  }
  if (status === "pending") {
    return "pending";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "processing") {
    return "processing";
  }
  return "pending";
}
