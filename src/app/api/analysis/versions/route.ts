import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analysisVersionState } from "@/lib/analysis-versions";

const VERSION_LIMIT = 50;

/**
 * Read-only per-project analysis history. Exposes every recorded version with
 * its revision state so the UI can show completed analyses as stale when the
 * repository head moved, and pending/quota-deferred work as non-authoritative.
 */
export async function GET(request: NextRequest) {
  const projectGithubId = Number(request.nextUrl.searchParams.get("project"));
  if (
    !request.nextUrl.searchParams.has("project") ||
    !Number.isSafeInteger(projectGithubId) ||
    projectGithubId <= 0
  ) {
    return NextResponse.json(
      { error: "A valid integer 'project' parameter is required." },
      { status: 400 },
    );
  }

  try {
    const project = await db.project.findUnique({
      where: { githubId: projectGithubId },
      select: {
        id: true,
        githubId: true,
        fullName: true,
        defaultBranch: true,
        defaultBranchHeadSha: true,
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const versions = await db.repositoryAnalysis.findMany({
      where: { projectId: project.id },
      orderBy: [{ createdAt: "desc" }],
      take: VERSION_LIMIT,
      select: {
        id: true,
        status: true,
        analyzedSha: true,
        promptVersion: true,
        model: true,
        errorCode: true,
        retryAt: true,
        samplingBoundary: true,
        createdAt: true,
        completedAt: true,
      },
    });

    // Finding M: Prisma BigInt githubId cannot be JSON-serialized; convert
    // with the Number() pattern used by github/projects (safe integer,
    // else string) so valid lookups do not 503.
    const githubId =
      typeof project.githubId === "bigint"
        ? (() => {
            const asNumber = Number(project.githubId);
            return Number.isSafeInteger(asNumber)
              ? asNumber
              : project.githubId.toString();
          })()
        : project.githubId;

    return NextResponse.json({
      project: {
        githubId,
        fullName: project.fullName,
        defaultBranch: project.defaultBranch,
        headSha: project.defaultBranchHeadSha,
      },
      versions: versions.map((version) => {
        const state = analysisVersionState(
          version.status,
          version.analyzedSha,
          project.defaultBranchHeadSha,
        );
        return {
          ...version,
          state,
          stale: state === "completed_stale",
        };
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Analysis versions are temporarily unavailable." },
      { status: 503 },
    );
  }
}
