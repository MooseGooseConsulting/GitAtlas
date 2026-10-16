import { db } from "./db";

/**
 * Heuristic project edges: exploratory corpus-map links between projects.
 *
 * Why this file exists: GET /api/relationships serves two tiers — typed
 * evidence-backed work references (authoritative/supported, from
 * github-work-resources.ts) and heuristic similarity edges rendered with the
 * `exploratory` confidence label. This module owns the heuristic tier only:
 * it derives edges from project metadata (shared topics, shared language)
 * and persists them as `heuristic_similarity` / `exploratory` rows.
 *
 * Honesty rule (VAL-SEM-006): heuristic edges are never evidence. They are
 * scoped to metadata overlap, capped per source, and never touch the
 * evidence-backed WorkReference rows.
 */

export const HEURISTIC_CATEGORY = "heuristic_similarity";
export const HEURISTIC_CONFIDENCE = "exploratory";
const MAX_PROJECTS = 500;
const MAX_EDGES_PER_SOURCE = 8;

interface HeuristicProject {
  id: string;
  language: string | null;
  topics: string | null;
}

interface HeuristicEvidence {
  sharedTopics: string[];
  sharedLanguage: string | null;
  basis: "project_metadata";
}

function topicsOf(project: HeuristicProject): string[] {
  if (!project.topics) return [];
  return project.topics
    .split(",")
    .map((topic) => topic.trim().toLowerCase())
    .filter((topic) => topic.length > 0);
}

/**
 * Recompute heuristic similarity edges from project metadata. Deletes the
 * current heuristic tier and rewrites it from scratch so removed
 * similarities disappear; evidence-backed WorkReference rows are untouched.
 * Returns the number of edges written.
 */
export async function refreshHeuristicProjectEdges(): Promise<{
  edgeCount: number;
}> {
  const projects = await db.project.findMany({
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take: MAX_PROJECTS,
    select: { id: true, language: true, topics: true },
  });

  const topicSets = new Map<string, Set<string>>();
  for (const project of projects) {
    topicSets.set(project.id, new Set(topicsOf(project)));
  }

  const writes: Array<{
    sourceProjectId: string;
    targetProjectId: string;
    relationshipType: string;
    evidenceJson: string;
  }> = [];

  for (const source of projects) {
    const sourceTopics = topicSets.get(source.id) ?? new Set<string>();
    const candidates: Array<{
      target: HeuristicProject;
      sharedTopics: string[];
      sharedLanguage: string | null;
      score: number;
    }> = [];
    for (const target of projects) {
      if (target.id === source.id) continue;
      const targetTopics = topicSets.get(target.id) ?? new Set<string>();
      const sharedTopics = [...sourceTopics].filter((topic) =>
        targetTopics.has(topic),
      );
      const sharedLanguage =
        source.language &&
        target.language &&
        source.language.toLowerCase() === target.language.toLowerCase()
          ? source.language
          : null;
      if (sharedTopics.length === 0 && !sharedLanguage) continue;
      candidates.push({
        target,
        sharedTopics: sharedTopics.sort(),
        sharedLanguage,
        score: sharedTopics.length * 2 + (sharedLanguage ? 1 : 0),
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates.slice(0, MAX_EDGES_PER_SOURCE)) {
      const evidence: HeuristicEvidence = {
        sharedTopics: candidate.sharedTopics,
        sharedLanguage: candidate.sharedLanguage,
        basis: "project_metadata",
      };
      writes.push({
        sourceProjectId: source.id,
        targetProjectId: candidate.target.id,
        relationshipType:
          candidate.sharedTopics.length > 0 ? "shared_topics" : "shared_language",
        evidenceJson: JSON.stringify(evidence),
      });
    }
  }

  // Finding Z (scoping, not perf): the project scan is capped at 500 but
  // the delete above used to wipe the whole heuristic tier, removing edges
  // for projects outside the window on every refresh. Scope the delete to
  // the scanned project set so out-of-window edges survive. (Batching the
  // per-row creates is a deferred perf follow-up.)
  const scannedIds = projects.map((project) => project.id);

  await db.$transaction(async (tx) => {
    await tx.projectEdge.deleteMany({
      where: {
        category: HEURISTIC_CATEGORY,
        confidence: HEURISTIC_CONFIDENCE,
        OR: [
          { sourceProjectId: { in: scannedIds } },
          { targetProjectId: { in: scannedIds } },
        ],
      },
    });
    for (const write of writes) {
      await tx.projectEdge.create({
        data: {
          sourceProjectId: write.sourceProjectId,
          targetProjectId: write.targetProjectId,
          category: HEURISTIC_CATEGORY,
          relationshipType: write.relationshipType,
          confidence: HEURISTIC_CONFIDENCE,
          evidenceJson: write.evidenceJson,
        },
      });
    }
  });

  return { edgeCount: writes.length };
}
