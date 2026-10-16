import { db } from "./db";

/**
 * GitHub source evidence sampling for revision-aware semantic analysis.
 *
 * Why this file exists: `semantic-analysis.ts` needs bounded, attributable
 * text samples per project (metadata → README → recent issues/commits) with
 * each sample carrying a stable `evidenceId` ("repo:metadata",
 * "readme:README.md", "issue:<id>", "commit:<sha>") so model citations can
 * be checked against the samples actually provided. Sampling reads only
 * persisted rows (Project, WorkResource) — never the provider — and caps
 * the total bytes so prompts stay bounded.
 *
 * Honesty rules: samples are the newest persisted rows (by sourceUpdatedAt /
 * fetched order); an empty sample set means `runNextSemanticAnalysis`
 * records `source_sample_unavailable` instead of calling the model; titles
 * and bodies are truncated, never fabricated.
 */

export interface SourceSample {
  evidenceId: string;
  /** Repository-relative path (e.g. "README.md"); "" when not a file sample. */
  path: string;
  /** Blob/source URL when attributable; "" when no URL was recorded. */
  sourceUrl: string;
  excerpt: string;
  truncated: boolean;
}

export interface ProjectSourceInput {
  id: string;
  fullName?: string | null;
  ownerLogin?: string | null;
  name?: string | null;
  htmlUrl?: string | null;
  defaultBranchHeadSha?: string | null;
  description?: string | null;
  language?: string | null;
  topics?: string | null;
  readmeContent?: string | null;
}

const MAX_SAMPLE_CHARS = 2000;
const MAX_ISSUE_SAMPLES = 8;
const MAX_COMMIT_SAMPLES = 8;

function truncate(text: string, max = MAX_SAMPLE_CHARS): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

function describeProject(project: ProjectSourceInput): string {
  const parts = [
    `Repository: ${project.fullName ?? project.id}`,
    project.description ? `Description: ${project.description}` : null,
    project.language ? `Language: ${project.language}` : null,
    project.topics ? `Topics: ${project.topics}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join("\n");
}

/**
 * Collect bounded source samples for a project: metadata first, then the
 * persisted README, then the newest persisted issues and commits. Returns
 * `[]` when nothing attributable exists (the caller treats that as
 * `source_sample_unavailable`).
 */
/**
 * Fetch bounded, attributable source samples for a project. Reads only
 * persisted rows — never the provider — newest first. Returns `[]` when
 * nothing attributable exists (the caller records
 * `source_sample_unavailable` instead of calling the model).
 *
 * Exported under both names: `fetchRepositorySourceSamples` is the spelling
 * consumed by `semantic-analysis.ts` and its tests; `collectProjectSourceSamples`
 * is the task-description spelling.
 */
export async function fetchRepositorySourceSamples(
  project: ProjectSourceInput,
): Promise<SourceSample[]> {
  const samples: SourceSample[] = [];

  const sha =
    typeof project.defaultBranchHeadSha === "string" &&
    project.defaultBranchHeadSha.length > 0
      ? project.defaultBranchHeadSha
      : null;
  const blobBase =
    typeof project.htmlUrl === "string" && project.htmlUrl.length > 0 && sha
      ? `${project.htmlUrl.replace(/\/$/, "")}/blob/${sha}`
      : null;

  if (project.readmeContent && project.readmeContent.trim().length > 0) {
    const excerpt =
      project.readmeContent.length <= MAX_SAMPLE_CHARS
        ? project.readmeContent
        : project.readmeContent.slice(0, MAX_SAMPLE_CHARS);
    samples.push({
      evidenceId: "source:README.md",
      path: "README.md",
      sourceUrl: blobBase ? `${blobBase}/README.md` : "",
      excerpt,
      truncated: project.readmeContent.length > MAX_SAMPLE_CHARS,
    });
  }

  const resources = await db.workResource.findMany({
    where: {
      projectId: project.id,
      sourceType: { in: ["issue", "commit"] },
    },
    orderBy: { sourceUpdatedAt: "desc" },
    take: MAX_ISSUE_SAMPLES + MAX_COMMIT_SAMPLES,
  });

  let issues = 0;
  let commits = 0;
  for (const resource of resources) {
    const title =
      typeof resource.title === "string" && resource.title.length > 0
        ? resource.title
        : "";
    if (!title) continue;
    if (resource.sourceType === "issue" && issues < MAX_ISSUE_SAMPLES) {
      const excerpt =
        `Issue ${resource.externalId}: ${title}`.length <= MAX_SAMPLE_CHARS
          ? `Issue ${resource.externalId}: ${title}`
          : `Issue ${resource.externalId}: ${title}`.slice(0, MAX_SAMPLE_CHARS);
      samples.push({
        evidenceId: `work:${resource.id}`,
        path: "",
        sourceUrl:
          typeof resource.sourceUrl === "string" ? resource.sourceUrl : "",
        excerpt,
        truncated: `Issue ${resource.externalId}: ${title}`.length > MAX_SAMPLE_CHARS,
      });
      issues++;
    } else if (
      resource.sourceType === "commit" &&
      commits < MAX_COMMIT_SAMPLES
    ) {
      const excerpt =
        `Commit ${resource.externalId.slice(0, 12)}: ${title}`.length <=
        MAX_SAMPLE_CHARS
          ? `Commit ${resource.externalId.slice(0, 12)}: ${title}`
          : `Commit ${resource.externalId.slice(0, 12)}: ${title}`.slice(
              0,
              MAX_SAMPLE_CHARS,
            );
      samples.push({
        evidenceId: `work:${resource.id}`,
        path: "",
        sourceUrl:
          typeof resource.sourceUrl === "string" ? resource.sourceUrl : "",
        excerpt,
        truncated:
          `Commit ${resource.externalId.slice(0, 12)}: ${title}`.length >
          MAX_SAMPLE_CHARS,
      });
      commits++;
    }
    if (issues >= MAX_ISSUE_SAMPLES && commits >= MAX_COMMIT_SAMPLES) break;
  }

  return samples;
}

export const collectProjectSourceSamples = fetchRepositorySourceSamples;

export { db };
