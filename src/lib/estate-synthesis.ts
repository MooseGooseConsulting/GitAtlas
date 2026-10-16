import { createHash } from "node:crypto";
import { db } from "./db";
import {
  chatWithFreeModel,
  DEFAULT_FREE_OPENROUTER_MODEL,
  FreeRouteError,
  getVerifiedFreeModel,
} from "./llm";

/**
 * Estate synthesis: the corpus-level rollup over versioned repository
 * analyses.
 *
 * Why this file exists: GET /api/estate must disclose honest coverage
 * (completed / pending / failed / stale-only / unattempted per project)
 * even before any synthesis completes, and POST /api/estate/synthesize must
 * persist a synthesis that cites only currently-current constituent versions.
 * Both paths share the pure `buildEstateCoverage` helper so the read API and
 * the persisted `coverageJson` can never disagree on what "current" means.
 *
 * Honesty rules (VAL-SEM-004, control-estate-all-citations-fix):
 * - Only a `completed` analysis whose analyzedSha still matches the
 *   project's defaultBranchHeadSha counts as a current constituent.
 *   Superseded versions stay retained history and surface as `stale_only`
 *   coverage, never as current results.
 * - `pending` / `failed` quota work is disclosed with its error code; it
 *   never becomes an authoritative conclusion.
 * - The synthesis writer persists every current constituent version ID and
 *   the read path verifies all of them — no leading-window truncation.
 */

export const ESTATE_PROMPT_VERSION = "estate-synthesis-v1";
const ESTATE_PROJECT_LIMIT = 500;

export type EstateProjectState =
  | "completed"
  | "pending"
  | "failed"
  | "stale_only"
  | "unattempted";

export interface EstateCoverageProject {
  projectId: string;
  fullName: string;
  state: EstateProjectState;
  versionId: string | null;
  pendingErrorCode?: string | null;
}

export interface EstateCoverageCounts {
  completed: number;
  pending: number;
  failed: number;
  staleOnly: number;
  unattempted: number;
}

export interface EstateCoverage {
  generatedAt: string;
  projectCount: number;
  archivedCount: number;
  counts: EstateCoverageCounts;
  projects: EstateCoverageProject[];
}

interface CoverageProjectInput {
  id: string;
  fullName: string;
  isArchived: boolean;
  defaultBranchHeadSha: string | null;
}

interface CoverageAnalysisInput {
  id: string;
  projectId: string;
  status: string;
  analyzedSha: string | null;
  errorCode: string | null;
}

/**
 * Compute live per-project coverage. Pure: no I/O, so the read route and the
 * synthesis writer share one definition of "current".
 *
 * Per project, the winning analysis is the newest current completed version;
 * otherwise the newest pending/processing row (quota work stays visible);
 * otherwise the newest failed row; otherwise any superseded completed/stale
 * row degrades to `stale_only`; otherwise `unattempted`. Archived projects
 * are counted separately and excluded from the per-project list.
 *
 * Determinism contract (finding J): callers must pass `analyses`
 * newest-first (`orderBy` createdAt desc, id desc) because the winner of
 * each bucket is the first matching row.
 */
export function buildEstateCoverage(
  projects: CoverageProjectInput[],
  analyses: CoverageAnalysisInput[],
  now: Date,
): EstateCoverage {
  const byProject = new Map<string, CoverageAnalysisInput[]>();
  for (const analysis of analyses) {
    const list = byProject.get(analysis.projectId) ?? [];
    list.push(analysis);
    byProject.set(analysis.projectId, list);
  }

  const counts: EstateCoverageCounts = {
    completed: 0,
    pending: 0,
    failed: 0,
    staleOnly: 0,
    unattempted: 0,
  };
  const entries: EstateCoverageProject[] = [];
  let archivedCount = 0;

  for (const project of projects) {
    if (project.isArchived) {
      archivedCount++;
      continue;
    }
    const rows = byProject.get(project.id) ?? [];
    const current = rows.filter(
      (row) =>
        row.status === "completed" &&
        row.analyzedSha &&
        project.defaultBranchHeadSha &&
        row.analyzedSha === project.defaultBranchHeadSha,
    );
    if (current.length > 0) {
      counts.completed++;
      entries.push({
        projectId: project.id,
        fullName: project.fullName,
        state: "completed",
        versionId: current[0].id,
      });
      continue;
    }
    const pending = rows.filter(
      (row) => row.status === "pending" || row.status === "processing",
    );
    if (pending.length > 0) {
      counts.pending++;
      entries.push({
        projectId: project.id,
        fullName: project.fullName,
        state: "pending",
        versionId: null,
        pendingErrorCode: pending[0].errorCode,
      });
      continue;
    }
    const failed = rows.filter((row) => row.status === "failed");
    if (failed.length > 0) {
      counts.failed++;
      entries.push({
        projectId: project.id,
        fullName: project.fullName,
        state: "failed",
        versionId: null,
        pendingErrorCode: failed[0].errorCode,
      });
      continue;
    }
    const superseded = rows.filter(
      (row) => row.status === "completed" || row.status === "stale",
    );
    if (superseded.length > 0) {
      counts.staleOnly++;
      entries.push({
        projectId: project.id,
        fullName: project.fullName,
        state: "stale_only",
        versionId: null,
      });
      continue;
    }
    counts.unattempted++;
    entries.push({
      projectId: project.id,
      fullName: project.fullName,
      state: "unattempted",
      versionId: null,
    });
  }

  return {
    generatedAt: now.toISOString(),
    projectCount: entries.length,
    archivedCount,
    counts,
    projects: entries,
  };
}

export interface EstateSynthesisResult {
  status: string;
  estateId?: string;
  errorCode?: string;
  retryAt?: string;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function retryDate(code: string): Date {
  // Quota exhaustion backs off longer than generic provider failures so the
  // worker does not burn ticks against a known-empty quota.
  const delayMs = code === "free_quota_exhausted" ? 60_000 : 30_000;
  return new Date(Date.now() + delayMs);
}

/**
 * Run one bounded estate synthesis tick. Skips unchanged inputs (same
 * constituent set and coverage shape as the latest completed estate),
 * defers while a persisted quota retry is still cooling down, and never
 * selects a paid model fallback: free-route failures persist as
 * pending/failed estates with resumable retry state.
 */
export async function runEstateSynthesis(): Promise<EstateSynthesisResult> {
  const now = new Date();

  const latest = await db.estateAnalysis.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (
    latest &&
    latest.status === "pending" &&
    latest.retryAt &&
    latest.retryAt.getTime() > now.getTime()
  ) {
    return {
      status: "pending",
      estateId: latest.id,
      errorCode: latest.errorCode ?? undefined,
      retryAt: latest.retryAt.toISOString(),
    };
  }

  const [projects, analyses] = await Promise.all([
    db.project.findMany({
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: ESTATE_PROJECT_LIMIT,
      select: {
        id: true,
        fullName: true,
        isArchived: true,
        defaultBranchHeadSha: true,
      },
    }),
    db.repositoryAnalysis.findMany({
      // Finding J: newest-first so buildEstateCoverage's first-match-wins
      // buckets are deterministic.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        projectId: true,
        status: true,
        analyzedSha: true,
        errorCode: true,
      },
    }),
  ]);

  const coverage = buildEstateCoverage(projects, analyses, now);
  const currentVersionIds = coverage.projects
    .filter((entry) => entry.state === "completed" && entry.versionId)
    .map((entry) => entry.versionId as string);

  // Finding L (rename-hash gap): the narrative prompt includes repository
  // names, so a rename must change the hash even when the constituent set
  // is identical. Include the completed constituents' fullNames.
  const nameById = new Map(projects.map((p) => [p.id, p.fullName]));
  const constituentNames = coverage.projects
    .filter((entry) => entry.state === "completed" && entry.versionId)
    .map((entry) => nameById.get(entry.projectId) ?? entry.projectId)
    .sort();

  const inputHash = sha256({
    promptVersion: ESTATE_PROMPT_VERSION,
    versionIds: currentVersionIds,
    names: constituentNames,
    counts: coverage.counts,
  });

  if (
    latest &&
    latest.status === "completed" &&
    latest.inputHash === inputHash
  ) {
    return { status: "completed", estateId: latest.id };
  }

  let model: string;
  try {
    model = await getVerifiedFreeModel(DEFAULT_FREE_OPENROUTER_MODEL);
  } catch (error) {
    const code =
      error instanceof FreeRouteError ? error.code : "free_model_unavailable";
    const retryAt = retryDate(code);
    // Finding I: reuse the existing row for the same input hash instead of
    // inserting a duplicate (inputHash is unique). History is preserved
    // only when the hash changes.
    const estate = await db.estateAnalysis.upsert({
      where: { inputHash },
      update: {
        model: DEFAULT_FREE_OPENROUTER_MODEL,
        analysisVersionIds: JSON.stringify(currentVersionIds),
        coverageJson: JSON.stringify(coverage),
        status: "pending",
        errorCode: code,
        retryAt,
        resultJson: null,
        completedAt: null,
      },
      create: {
        inputHash,
        promptVersion: ESTATE_PROMPT_VERSION,
        model: DEFAULT_FREE_OPENROUTER_MODEL,
        analysisVersionIds: JSON.stringify(currentVersionIds),
        coverageJson: JSON.stringify(coverage),
        status: "pending",
        errorCode: code,
        retryAt,
      },
    });
    return {
      status: "pending",
      estateId: estate.id,
      errorCode: code,
      retryAt: retryAt.toISOString(),
    };
  }

  // Finding K: include bounded, attributed summaries/citations from the
  // selected completed analyses so the model can summarize findings, not
  // just names+IDs. Each line is capped (summary 500 chars) and citations
  // below are still verified against current constituents.
  const completedByVersionId = new Map(
    (
      (await db.repositoryAnalysis.findMany({
        where: { id: { in: currentVersionIds.slice(0, ESTATE_PROJECT_LIMIT) } },
        select: { id: true, resultJson: true },
      })) as Array<{ id: string; resultJson: string | null }>
    ).map((row) => [row.id, row.resultJson]),
  );
  function boundedSummary(resultJson: string | null | undefined): string {
    if (!resultJson) return "";
    try {
      const parsed = JSON.parse(resultJson) as {
        summary?: unknown;
        citations?: unknown;
      };
      const parts: string[] = [];
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        parts.push(
          parsed.summary.trim().slice(0, 500).replace(/\s+/g, " "),
        );
      }
      if (Array.isArray(parsed.citations)) {
        const ids = (parsed.citations as Array<{ evidenceId?: unknown }>)
          .map((c) => (typeof c?.evidenceId === "string" ? c.evidenceId : null))
          .filter((id): id is string => id !== null)
          .slice(0, 5);
        if (ids.length > 0) parts.push(`cites: ${ids.join(", ")}`);
      }
      return parts.join(" | ").slice(0, 600);
    } catch {
      return "";
    }
  }
  const constituentLines = coverage.projects
    .filter((entry) => entry.state === "completed" && entry.versionId)
    .slice(0, ESTATE_PROJECT_LIMIT)
    .map((entry) => {
      const detail = boundedSummary(
        completedByVersionId.get(entry.versionId as string),
      );
      return detail
        ? `- ${entry.fullName} (analysis ${entry.versionId}): ${detail}`
        : `- ${entry.fullName} (analysis ${entry.versionId})`;
    })
    .join("\n");

  let raw: string;
  try {
    raw = await chatWithFreeModel({
      model,
      maxTokens: 2000,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Summarize a repository estate as JSON: {\"narrative\": string, " +
            "\"themes\": string[], \"uncertainties\": string[], " +
            "\"citations\": string[]} where citations lists only the " +
            "analysis IDs provided. Disclose partial coverage as " +
            "uncertainty; never invent constituents.",
        },
        {
          role: "user",
          content:
            `Current constituents (${currentVersionIds.length} of ` +
            `${coverage.projectCount} projects; ` +
            `pending ${coverage.counts.pending}, failed ` +
            `${coverage.counts.failed}, stale-only ` +
            `${coverage.counts.staleOnly}, unattempted ` +
            `${coverage.counts.unattempted}):\n${constituentLines}`,
        },
      ],
    });
  } catch (error) {
    const code =
      error instanceof FreeRouteError ? error.code : "provider_failure";
    const quota = code === "free_quota_exhausted";
    const retryAt = retryDate(code);
    // Finding I: reuse the existing row for the same input hash.
    const estate = await db.estateAnalysis.upsert({
      where: { inputHash },
      update: {
        model,
        analysisVersionIds: JSON.stringify(currentVersionIds),
        coverageJson: JSON.stringify(coverage),
        status: quota ? "pending" : "failed",
        errorCode: code,
        retryAt,
        resultJson: null,
        completedAt: null,
      },
      create: {
        inputHash,
        promptVersion: ESTATE_PROMPT_VERSION,
        model,
        analysisVersionIds: JSON.stringify(currentVersionIds),
        coverageJson: JSON.stringify(coverage),
        status: quota ? "pending" : "failed",
        errorCode: code,
        retryAt,
      },
    });
    return {
      status: quota ? "pending" : "failed",
      estateId: estate.id,
      errorCode: code,
      retryAt: retryAt.toISOString(),
    };
  }

  // Citation verification (all-citations fix): keep only citations that are
  // still current constituents. A model-hallucinated or superseded ID is
  // dropped from the persisted narrative, never presented as evidence.
  // Finding L (weak cast): require the promised shape — narrative string
  // plus themes/uncertainties/citations arrays — before persisting completed.
  let resultJson: string | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const current = new Set(currentVersionIds);
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.citations)) {
        record.citations = (record.citations as unknown[]).filter(
          (entry): entry is string =>
            typeof entry === "string" && current.has(entry),
        );
      }
      const shapeOk =
        typeof record.narrative === "string" &&
        record.narrative.trim().length > 0 &&
        Array.isArray(record.themes) &&
        Array.isArray(record.uncertainties) &&
        (record.citations === undefined || Array.isArray(record.citations));
      resultJson = shapeOk ? JSON.stringify(record) : null;
    } else {
      resultJson = null;
    }
  } catch {
    resultJson = null;
  }
  if (!resultJson) {
    const retryAt = retryDate("provider_failure");
    // Finding I: reuse the existing row for the same input hash.
    const estate = await db.estateAnalysis.upsert({
      where: { inputHash },
      update: {
        model,
        analysisVersionIds: JSON.stringify(currentVersionIds),
        coverageJson: JSON.stringify(coverage),
        status: "failed",
        errorCode: "provider_failure",
        retryAt,
        resultJson: null,
        completedAt: null,
      },
      create: {
        inputHash,
        promptVersion: ESTATE_PROMPT_VERSION,
        model,
        analysisVersionIds: JSON.stringify(currentVersionIds),
        coverageJson: JSON.stringify(coverage),
        status: "failed",
        errorCode: "provider_failure",
        retryAt,
      },
    });
    return {
      status: "failed",
      estateId: estate.id,
      errorCode: "provider_failure",
      retryAt: retryAt.toISOString(),
    };
  }
  // Finding I: reuse the existing row for the same input hash.
  const estate = await db.estateAnalysis.upsert({
    where: { inputHash },
    update: {
      model,
      analysisVersionIds: JSON.stringify(currentVersionIds),
      coverageJson: JSON.stringify(coverage),
      resultJson,
      status: "completed",
      errorCode: null,
      retryAt: null,
      completedAt: now,
    },
    create: {
      inputHash,
      promptVersion: ESTATE_PROMPT_VERSION,
      model,
      analysisVersionIds: JSON.stringify(currentVersionIds),
      coverageJson: JSON.stringify(coverage),
      resultJson,
      status: "completed",
      completedAt: now,
    },
  });
  return { status: "completed", estateId: estate.id };
}
