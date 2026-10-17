import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  chatWithFreeModel,
  DEFAULT_FREE_OPENROUTER_MODEL,
  FreeRouteError,
  getVerifiedFreeModel,
} from "@/lib/llm";
import {
  fetchRepositorySourceSamples,
  type SourceSample,
} from "@/lib/github-source-evidence";

export const SEMANTIC_PROMPT_VERSION = "repository-analysis-v1";
const PROJECT_SCAN_LIMIT = 500;
const WORKER_STATE_ID = "semantic-worker";
const RESOURCE_SAMPLE_LIMIT = 5000;
const OWNER_NOTE_SAMPLE_LIMIT = 5000;
const WORK_RESOURCE_SAMPLE_LIMIT = 20;
const QUOTA_RETRY_MS = 30 * 60 * 1000;

const analysisSchema = z.object({
  summary: z.string().min(1).max(1200),
  tags: z.array(z.string().min(1).max(40)).max(10),
  category: z
    .enum([
      "tool",
      "library",
      "application",
      "template",
      "experiment",
      "config",
      "documentation",
      "learning",
      "archive",
    ]),
  citations: z
    .array(
      z.object({
        evidenceId: z.string().min(1).max(100),
        claim: z.string().min(1).max(500),
      }),
    )
    .max(20),
  uncertainties: z.array(z.string().min(1).max(400)).max(20),
});

class InvalidAnalysisOutputError extends Error {
  constructor(
    readonly code: "invalid_analysis_json" | "invalid_analysis_schema",
  ) {
    super(code);
  }
}

type ProjectInput = {
  id: string;
  githubId: number;
  ownerLogin: string;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  defaultBranchHeadSha: string | null;
  githubUpdatedAt?: Date;
  inventoryFetchedAt?: Date | null;
  inventoryStatus?: string;
  language: string | null;
  topics: string;
  readmeContent?: string | null;
};

type WorkEvidence = {
  id: string;
  sourceType: string;
  externalId: string;
  title: string | null;
  sourceUrl: string;
  sourceState: string;
  sourceUpdatedAt: Date | null;
};

type NoteInput = {
  id: string;
  note: string;
  author: string;
  createdAt: Date;
};

type OwnerNoteEvidence = NoteInput & { provenance: "owner" };

export type SemanticInput = {
  evidence: Array<{
    id: string;
    kind:
      | "repository_metadata"
      | "readme_sample"
      | "github_work_resource"
      | "repository_source_sample";
    sourceUrl: string;
    observedAt: string | null;
    excerpt: string;
  }>;
  ownerNotes: OwnerNoteEvidence[];
  samplingBoundary: string;
};

export type SemanticRunResult = {
  status: "completed" | "skipped" | "pending" | "failed" | "idle";
  projectId?: string;
  analysisId?: string;
  errorCode?: string;
  retryAt?: string;
};

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildSemanticInput(
  project: ProjectInput,
  workResources: WorkEvidence[],
  notes: NoteInput[],
  sourceSamples: SourceSample[] = [],
): SemanticInput {
  const evidence: SemanticInput["evidence"] = [
    {
      id: "repo:metadata",
      kind: "repository_metadata",
      sourceUrl: project.htmlUrl,
      observedAt: null,
      excerpt: [
        `Repository: ${project.fullName}`,
        `Default branch: ${project.defaultBranch}`,
        `Analyzed SHA: ${project.defaultBranchHeadSha ?? "unknown"}`,
        `GitHub repository updated at: ${project.githubUpdatedAt?.toISOString() ?? "unknown"}`,
        `Inventory freshness: ${project.inventoryStatus ?? "unknown"}; last inventory fetch: ${project.inventoryFetchedAt?.toISOString() ?? "unknown"}`,
        `Description: ${project.description ?? "not provided"}`,
        `Language: ${project.language ?? "not reported"}`,
        `Topics: ${project.topics || "none reported"}`,
      ].join("\n"),
    },
  ];
  for (const sample of sourceSamples) {
    evidence.push({
      id: sample.evidenceId,
      kind: sample.path.toLowerCase().startsWith("readme")
        ? "readme_sample"
        : "repository_source_sample",
      sourceUrl: sample.sourceUrl,
      observedAt: project.defaultBranchHeadSha,
      excerpt: [
        `Path at analyzed SHA ${project.defaultBranchHeadSha ?? "unknown"}: ${sample.path}`,
        `Excerpt truncated: ${sample.truncated}`,
        sample.excerpt,
      ].join("\n"),
    });
  }

  for (const resource of workResources.slice(0, WORK_RESOURCE_SAMPLE_LIMIT)) {
    evidence.push({
      id: `work:${resource.id}`,
      kind: "github_work_resource",
      sourceUrl: resource.sourceUrl,
      observedAt: resource.sourceUpdatedAt?.toISOString() ?? null,
      excerpt: [
        `Type: ${resource.sourceType}`,
        `External ID: ${resource.externalId}`,
        `State: ${resource.sourceState}`,
        `Title: ${resource.title ?? "untitled"}`,
      ].join("\n"),
    });
  }

  return {
    evidence,
    ownerNotes: notes.slice(0, OWNER_NOTE_SAMPLE_LIMIT).map((note) => ({
      id: note.id,
      note: note.note.slice(0, 1000),
      author: note.author,
      createdAt: note.createdAt,
      provenance: "owner",
    })),
    samplingBoundary:
      `One repository revision; work query capped at ${RESOURCE_SAMPLE_LIMIT} records across ` +
      `the bounded repository scan, with at most ${WORK_RESOURCE_SAMPLE_LIMIT} of the newest ` +
      `${workResources.length} available records used here; up to 2 source files sampled at 1600 characters each; ` +
      `at most ${OWNER_NOTE_SAMPLE_LIMIT} owner notes. This is sampled evidence, not a full source audit.`,
  };
}

function parseModelOutput(output: string) {
  let raw = output.trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) raw = fenced[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last >= first) raw = raw.slice(first, last + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidAnalysisOutputError("invalid_analysis_json");
  }
  const validated = analysisSchema.safeParse(parsed);
  if (!validated.success) {
    throw new InvalidAnalysisOutputError("invalid_analysis_schema");
  }
  return validated.data;
}

function errorCode(error: unknown) {
  if (error instanceof FreeRouteError) return error.code;
  if (error instanceof InvalidAnalysisOutputError) return error.code;
  return "invalid_analysis";
}

function retryDate(code: string, now = Date.now()) {
  const delay =
    code === "free_quota_exhausted"
      ? QUOTA_RETRY_MS
      : code === "missing_config"
        // Missing configuration cannot self-heal by waiting; use the
        // standard backoff so callers persist failed work with a retryAt.
        ? 5 * 60 * 1000
        : code === "free_model_unavailable"
          ? 60 * 60 * 1000
          : 5 * 60 * 1000;
  return new Date(now + delay);
}

/**
 * Rotation cursor for fair queue coverage. Each unfiltered tick resumes
 * after the last project scanned by the previous tick, so eligible
 * repositories beyond a fixed first window are selected on subsequent
 * ticks instead of being starved by the newest-updated head of the list.
 */
async function loadWorkerCursor(): Promise<string | null> {
  const state = await db.semanticWorkerState.findUnique({
    where: { id: WORKER_STATE_ID },
    select: { cursorProjectId: true },
  });
  return state?.cursorProjectId ?? null;
}

async function saveWorkerCursor(projectId: string | null): Promise<void> {
  await db.semanticWorkerState.upsert({
    where: { id: WORKER_STATE_ID },
    update: { cursorProjectId: projectId },
    create: { id: WORKER_STATE_ID, cursorProjectId: projectId },
  });
}

export async function runNextSemanticAnalysis(
  options: { ownerLogin?: string; projectId?: string } = {},
): Promise<SemanticRunResult> {
  const requestedModel =
    process.env.OPENROUTER_FREE_MODEL || DEFAULT_FREE_OPENROUTER_MODEL;
  // Cursor rotation applies to global ticks only; explicit owner/project
  // ticks keep their exact filter and never move the shared cursor.
  const useCursor = !options.ownerLogin && !options.projectId;
  const projectWhere = {
    ...(options.ownerLogin ? { ownerLogin: options.ownerLogin } : {}),
    ...(options.projectId ? { id: options.projectId } : {}),
    isArchived: false,
    defaultBranchHeadSha: { not: null },
  } as const;
  const fetchProjectWindow = (afterId: string | null) =>
    db.project.findMany({
      where: {
        ...projectWhere,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      // Stable ID order must match the id > cursor predicate: every window
      // is the next 500 eligible IDs after the cursor, so resumed ticks
      // eventually visit every eligible ID, with wraparound back to the
      // first window once the tail is exhausted. A githubUpdatedAt-ordered
      // window would exclude lower-ID projects below the cursor forever.
      orderBy: [{ id: "asc" }],
      take: PROJECT_SCAN_LIMIT,
      select: {
        id: true,
        githubId: true,
        ownerLogin: true,
        name: true,
        fullName: true,
        description: true,
        htmlUrl: true,
        defaultBranch: true,
        defaultBranchHeadSha: true,
        githubUpdatedAt: true,
        inventoryFetchedAt: true,
        inventoryStatus: true,
        language: true,
        topics: true,
      },
    }) as unknown as Promise<ProjectInput[]>;

  let cursor = useCursor ? await loadWorkerCursor() : null;
  let projects = await fetchProjectWindow(cursor);
  if (!projects.length && cursor) {
    // Every project after the cursor was exhausted; resume from the first
    // window so earlier projects rotate back into scope.
    cursor = null;
    projects = await fetchProjectWindow(null);
  }
  if (!projects.length) return { status: "idle" };

  const projectIds = projects.map((project) => project.id);
  const [resources, notes] = await Promise.all([
    db.workResource.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ sourceUpdatedAt: "desc" }, { id: "asc" }],
      take: RESOURCE_SAMPLE_LIMIT,
      select: {
        id: true,
        projectId: true,
        sourceType: true,
        externalId: true,
        title: true,
        sourceUrl: true,
        sourceState: true,
        sourceUpdatedAt: true,
      },
    }) as Promise<Array<WorkEvidence & { projectId: string }>>,
    db.ownerNote.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        projectId: true,
        note: true,
        author: true,
        createdAt: true,
      },
    }) as Promise<Array<NoteInput & { projectId: string }>>,
  ]);

  const resourcesByProject = new Map<string, WorkEvidence[]>();
  const notesByProject = new Map<string, NoteInput[]>();
  for (const resource of resources) {
    const group = resourcesByProject.get(resource.projectId) ?? [];
    if (group.length < WORK_RESOURCE_SAMPLE_LIMIT) group.push(resource);
    resourcesByProject.set(resource.projectId, group);
  }
  for (const note of notes) {
    const group = notesByProject.get(note.projectId) ?? [];
    if (group.length < OWNER_NOTE_SAMPLE_LIMIT) group.push(note);
    notesByProject.set(note.projectId, group);
  }

  let selected:
    | {
        project: ProjectInput;
        input: SemanticInput;
        inputHash: string;
        evidenceHash: string;
        model: string;
        analysisId: string;
      }
    | undefined;
  let sawSkipped = false;
  let lastScannedId: string | null = null;
  let waiting:
    | {
        projectId: string;
        analysisId: string;
        errorCode?: string;
        retryAt: string;
      }
    | undefined;
  for (const project of projects) {
    if (!project.defaultBranchHeadSha) continue;
    lastScannedId = project.id;
    const workResourcesForProject = resourcesByProject.get(project.id) ?? [];
    const notesForProject = notesByProject.get(project.id) ?? [];
    // Fetch source samples BEFORE hashing: the completed-row lookup must
    // cover the same bounded evidence the model will see, otherwise a README
    // or issue/commit change at the same SHA silently reuses a stale result.
    const sourceSamples = await fetchRepositorySourceSamples(project);
    const revisionInput = buildSemanticInput(
      project,
      workResourcesForProject,
      notesForProject,
      sourceSamples,
    );
    const evidenceHash = sha256({
      revisionEvidence: revisionInput.evidence,
      ownerNotes: revisionInput.ownerNotes,
      sourceRevision: project.defaultBranchHeadSha,
      sourceSamples,
      sourceSamplePolicy: "up-to-2-files-at-1600-chars-v1",
    });
    const inputHash = sha256({
      analyzedSha: project.defaultBranchHeadSha,
      evidenceHash,
      promptVersion: SEMANTIC_PROMPT_VERSION,
      model: requestedModel,
    });
    const existing = await db.repositoryAnalysis.findUnique({
      where: {
        projectId_inputHash: { projectId: project.id, inputHash },
      },
    });
    if (existing?.status === "completed") {
      sawSkipped = true;
      continue;
    }
    if (
      (existing?.status === "pending" || existing?.status === "failed") &&
      existing.retryAt &&
      existing.retryAt > new Date()
    ) {
      waiting ??= {
        projectId: project.id,
        analysisId: existing.id,
        errorCode: existing.errorCode ?? undefined,
        retryAt: existing.retryAt.toISOString(),
      };
      continue;
    }

    // Factory order (shard-lib ledger): mark superseded completed rows stale
    // BEFORE sampling/creating the new revision, so a changed SHA or changed
    // same-SHA evidence always retires prior completed history on this path.
    await db.repositoryAnalysis.updateMany({
      where: { projectId: project.id, status: "completed" },
      data: { status: "stale" },
    });
    if (sourceSamples.length === 0) {
      const retryAt = retryDate("source_sample_unavailable");
      const row = existing
        ? await db.repositoryAnalysis.update({
            where: { id: existing.id },
            data: {
              status: "failed",
              errorCode: "source_sample_unavailable",
              retryAt,
            },
          })
        : await db.repositoryAnalysis.create({
            data: {
              projectId: project.id,
              analyzedSha: project.defaultBranchHeadSha,
              evidenceHash,
              inputHash,
              promptVersion: SEMANTIC_PROMPT_VERSION,
              model: requestedModel,
              evidenceJson: JSON.stringify(revisionInput.evidence),
              ownerNotesJson: JSON.stringify(revisionInput.ownerNotes),
              samplingBoundary: revisionInput.samplingBoundary,
              status: "failed",
              errorCode: "source_sample_unavailable",
              retryAt,
            },
          });
      if (useCursor) await saveWorkerCursor(project.id);
      return {
        status: "failed",
        projectId: project.id,
        analysisId: row.id,
        errorCode: "source_sample_unavailable",
        retryAt: retryAt.toISOString(),
      };
    }
    const row = existing
      ? await db.repositoryAnalysis.update({
          where: { id: existing.id },
          data: { status: "processing", errorCode: null, retryAt: null },
        })
      : await db.repositoryAnalysis.create({
          data: {
            projectId: project.id,
            analyzedSha: project.defaultBranchHeadSha,
            evidenceHash,
            inputHash,
            promptVersion: SEMANTIC_PROMPT_VERSION,
            model: requestedModel,
            evidenceJson: JSON.stringify(revisionInput.evidence),
            ownerNotesJson: JSON.stringify(revisionInput.ownerNotes),
            samplingBoundary: revisionInput.samplingBoundary,
            status: "processing",
          },
        });
    selected = {
      project,
      input: revisionInput,
      inputHash,
      evidenceHash,
      model: requestedModel,
      analysisId: row.id,
    };
    break;
  }
  if (useCursor && lastScannedId) {
    // Resume the next tick after the furthest project reached here,
    // whether this tick selected work, hit a retry window, or found
    // nothing new in the window.
    await saveWorkerCursor(lastScannedId);
  }
  if (!selected) {
    if (waiting) return { status: "pending", ...waiting };
    return { status: sawSkipped ? "skipped" : "idle" };
  }

  let verifiedModel: string;
  try {
    verifiedModel = await getVerifiedFreeModel(selected.model);
  } catch {
    return persistFailure(selected.analysisId, "free_model_unavailable", true, {
      projectId: selected.project.id,
    });
  }
  if (!verifiedModel || verifiedModel !== selected.model) {
    return persistFailure(selected.analysisId, "free_model_unavailable", true, {
      projectId: selected.project.id,
    });
  }

  try {
    const output = await chatWithFreeModel({
      model: verifiedModel,
      temperature: 0.2,
      maxTokens: 1200,
      messages: [
        {
          role: "system",
          content:
            "Analyze only the provided bounded evidence. Return ONLY one JSON object with this exact shape: " +
            '{"summary":"one concise sentence","tags":["short-tag"],"category":"tool","citations":[{"evidenceId":"repo:metadata","claim":"a directly supported claim"}],"uncertainties":["what this sample cannot establish"]}. ' +
            "category must be one of tool, library, application, template, experiment, config, documentation, learning, archive. " +
            "Citations must use evidence IDs supplied in the input exactly, or use an empty citations array if no source supports a claim. " +
            "Do not infer completion, deployment, implementation, or readiness from a mention/title alone. " +
            "Owner notes are corrections/context, not GitHub evidence. State that evidence is sampled and disclose limits.",
        },
        {
          role: "user",
          content: JSON.stringify({
            repository: selected.project.fullName,
            analyzedSha: selected.project.defaultBranchHeadSha,
            evidence: selected.input.evidence,
            ownerNotes: selected.input.ownerNotes,
            samplingBoundary: selected.input.samplingBoundary,
          }),
        },
      ],
    });
    const result = parseModelOutput(output);
    const allowedEvidenceIds = new Set(
      selected.input.evidence.map((evidence) => evidence.id),
    );
    if (result.citations.some((citation) => !allowedEvidenceIds.has(citation.evidenceId))) {
      throw new InvalidAnalysisOutputError("invalid_analysis_schema");
    }
    await db.repositoryAnalysis.update({
      where: { id: selected.analysisId },
      data: {
        status: "completed",
        resultJson: JSON.stringify(result),
        errorCode: null,
        retryAt: null,
        completedAt: new Date(),
      },
    });
    return {
      status: "completed",
      projectId: selected.project.id,
      analysisId: selected.analysisId,
    };
  } catch (error) {
    const code = errorCode(error);
    // Only explicit quota exhaustion defers as pending; missing
    // configuration (no API key) and other failures persist as failed work
    // with retryAt so a later tick can re-attempt after the operator fixes
    // the environment.
    const pending = code === "free_quota_exhausted" || code === "provider_failure";
    return persistFailure(selected.analysisId, code, pending, {
      projectId: selected.project.id,
    });
  }
}

async function persistFailure(
  analysisId: string,
  code: string,
  pending: boolean,
  result: Pick<SemanticRunResult, "projectId">,
): Promise<SemanticRunResult> {
  const retryAt = retryDate(code);
  await db.repositoryAnalysis.update({
    where: { id: analysisId },
    data: {
      status: pending ? "pending" : "failed",
      errorCode: code,
      retryAt,
    },
  });
  return {
    ...result,
    status: pending ? "pending" : "failed",
    analysisId,
    errorCode: code,
    retryAt: retryAt.toISOString(),
  };
}
