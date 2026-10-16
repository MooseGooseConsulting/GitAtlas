import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshHeuristicProjectEdges } from "@/lib/project-edges";
import { isInternalRequestAuthorized } from "@/lib/internal-sync-auth";

const REFERENCE_LIMIT = 1000;

export async function GET(request: NextRequest) {
  try {
    const projectGithubId = Number(request.nextUrl.searchParams.get("project"));
    const hasProjectFilter = request.nextUrl.searchParams.has("project");
    const project =
      hasProjectFilter &&
      Number.isSafeInteger(projectGithubId) &&
      projectGithubId > 0
        ? await db.project.findUnique({
            where: { githubId: projectGithubId },
            select: { id: true },
          })
        : null;
    if (hasProjectFilter && !project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const heuristicEdges = await db.projectEdge.findMany({
      where: project
        ? {
            OR: [{ sourceProjectId: project.id }, { targetProjectId: project.id }],
          }
        : {},
      orderBy: [{ updatedAt: "desc" }],
      take: REFERENCE_LIMIT,
      include: {
        sourceProject: { select: { githubId: true, fullName: true } },
        targetProject: { select: { githubId: true, fullName: true } },
      },
    });

    // Why no targetResourceId filter here: unresolved outgoing references
    // (no persisted target resource yet) are real recorded evidence and must
    // stay inspectable. Their target identity is null and targetUrl is only
    // ever the genuinely recorded explicit URL, never an invented link.
    // Project scoping still excludes references unrelated to the project.
    const references = await db.workReference.findMany({
      where: project
        ? {
            OR: [
              { sourceResource: { projectId: project.id } },
              { targetResource: { projectId: project.id } },
            ],
          }
        : {},
      orderBy: [{ discoveredAt: "desc" }],
      take: REFERENCE_LIMIT,
      select: {
        id: true,
        relationshipType: true,
        category: true,
        confidence: true,
        intent: true,
        evidence: true,
        targetUrl: true,
        targetExternalId: true,
        targetSourceType: true,
        discoveredAt: true,
        sourceResource: {
          select: {
            sourceUrl: true,
            project: { select: { githubId: true, fullName: true } },
          },
        },
        targetResource: {
          select: {
            sourceUrl: true,
            project: { select: { githubId: true, fullName: true } },
          },
        },
      },
    });

    // Finding T: per-row try/catch so one corrupt evidenceJson row cannot
    // 503 the whole GET (matches the guarded parses in the estate route).
    function safeEvidenceJson(raw: string): unknown {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    }
    // Finding M: Prisma BigInt githubId cannot be JSON-serialized; convert
    // with the Number() pattern used by github/projects (safe integer, else
    // string).
    function safeGithubId(value: unknown): number | string | null {
      if (typeof value === "bigint") {
        const asNumber = Number(value);
        return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
      }
      return value as number | string | null;
    }

    return NextResponse.json({
      heuristic: heuristicEdges.map((edge) => ({
        id: edge.id,
        category: edge.category,
        confidence: edge.confidence,
        relationshipType: edge.relationshipType,
        sourceProject: {
          githubId: safeGithubId(
            (edge.sourceProject as { githubId?: unknown })?.githubId,
          ),
          fullName: edge.sourceProject.fullName,
        },
        targetProject: {
          githubId: safeGithubId(
            (edge.targetProject as { githubId?: unknown })?.githubId,
          ),
          fullName: edge.targetProject.fullName,
        },
        evidence: safeEvidenceJson(edge.evidenceJson),
      })),
      evidenceBacked: references.map((reference) => ({
        id: reference.id,
        category: reference.category,
        confidence: reference.confidence,
        intent: reference.intent,
        relationshipType: reference.relationshipType,
        evidence: reference.evidence,
        sourceProject: {
          githubId: safeGithubId(
            (reference.sourceResource.project as { githubId?: unknown })
              ?.githubId,
          ),
          fullName: reference.sourceResource.project.fullName,
        },
        sourceUrl: reference.sourceResource.sourceUrl,
        targetProject: reference.targetResource?.project
          ? {
              githubId: safeGithubId(
                (
                  reference.targetResource.project as {
                    githubId?: unknown;
                  }
                )?.githubId,
              ),
              fullName: reference.targetResource.project.fullName,
            }
          : null,
        targetUrl: reference.targetUrl,
        targetExternalId: reference.targetExternalId,
        targetSourceType: reference.targetSourceType,
        discoveredAt: reference.discoveredAt,
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "Relationship edges are temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await refreshHeuristicProjectEdges();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Heuristic relationship refresh could not be completed." },
      { status: 503 },
    );
  }
}
