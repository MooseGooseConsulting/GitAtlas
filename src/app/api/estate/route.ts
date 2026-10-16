import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildEstateCoverage } from "@/lib/estate-synthesis";

const PROJECT_LIMIT = 500;

export async function GET() {
  try {
    const [estate, projects, analyses] = await Promise.all([
      db.estateAnalysis.findFirst({ orderBy: { createdAt: "desc" } }),
      db.project.findMany({
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
        take: PROJECT_LIMIT,
        select: {
          id: true,
          fullName: true,
          isArchived: true,
          defaultBranchHeadSha: true,
        },
      }),
      db.repositoryAnalysis.findMany({
        // Finding J: newest-first so buildEstateCoverage's first-match-wins
        // buckets pick the newest version deterministically.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          projectId: true,
          status: true,
          analyzedSha: true,
          promptVersion: true,
          model: true,
          errorCode: true,
          retryAt: true,
          completedAt: true,
          createdAt: true,
          resultJson: true,
        },
      }),
    ]);
    // Coverage is always computed live so missing, stale, pending and failed
    // source versions stay explicit even before any synthesis completes.
    const coverage = buildEstateCoverage(projects, analyses, new Date());
    // Only completed versions whose analyzedSha still matches the current
    // head count as current constituents; superseded versions remain
    // retained history and show up as stale coverage instead.
    const currentVersionIds = new Set(
      coverage.projects
        .filter((entry) => entry.state === "completed" && entry.versionId)
        .map((entry) => entry.versionId as string),
    );

    let constituents: unknown[] = [];
    let result: unknown = null;
    let staleReason: string | null = null;
    let staleConstituentCount = 0;
    if (estate) {
      let versionIds: string[] = [];
      let citationsVerifiable = true;
      try {
        const parsed: unknown = JSON.parse(estate.analysisVersionIds);
        if (Array.isArray(parsed)) {
          versionIds = parsed.filter(
            (entry): entry is string => typeof entry === "string",
          );
        } else {
          citationsVerifiable = false;
        }
      } catch {
        citationsVerifiable = false;
        versionIds = [];
      }
      // Every stored citation is verified against live coverage. Estate
      // synthesis persists up to PROJECT_LIMIT constituent IDs, so a
      // leading window would let a stale later constituent keep an old
      // narrative presented as current.
      const citedVersionIds = versionIds;
      const versions = await db.repositoryAnalysis.findMany({
        where: { id: { in: citedVersionIds } },
        select: {
          id: true,
          projectId: true,
          status: true,
          analyzedSha: true,
          completedAt: true,
          promptVersion: true,
          model: true,
        },
      });
      const nameByProject = new Map(
        projects.map((project) => [project.id, project.fullName]),
      );
      constituents = versions
        .filter((version) => currentVersionIds.has(version.id))
        .map((version) => ({
          analysisId: version.id,
          projectId: version.projectId,
          fullName: nameByProject.get(version.projectId) ?? "unknown",
          status: version.status,
          analyzedSha: version.analyzedSha,
          completedAt: version.completedAt,
          promptVersion: version.promptVersion,
          model: version.model,
        }));
      // A persisted completed synthesis is only current while every cited
      // constituent version still matches a live head. If a cited analysis
      // has been superseded (or its citations cannot be verified), the old
      // narrative must not be presented as current; it stays available
      // below as inspectable history while live coverage reports the gap.
      if (estate.status === "completed") {
        if (!citationsVerifiable) {
          staleReason = "constituent_versions_unverifiable";
        } else {
          const notCurrent = citedVersionIds.filter(
            (id) => !currentVersionIds.has(id),
          );
          // Finding L (set-growth stale): a newly completed project grows
          // the live constituent set without invalidating any old citation,
          // so compare the full sets, not just old-citation disappearance.
          const grown =
            currentVersionIds.size > citedVersionIds.length &&
            [...currentVersionIds].some((id) => !citedVersionIds.includes(id));
          if (notCurrent.length > 0) {
            staleReason = "cited_constituent_not_current";
            staleConstituentCount = notCurrent.length;
          } else if (grown) {
            staleReason = "constituent_set_grew";
            staleConstituentCount =
              currentVersionIds.size - citedVersionIds.length;
          }
        }
      }
      try {
        result = estate.resultJson ? JSON.parse(estate.resultJson) : null;
      } catch {
        result = null;
      }
    }

    const presentedStatus =
      estate && staleReason ? "stale" : estate?.status ?? null;

    return NextResponse.json({
      estate: estate
        ? {
            id: estate.id,
            status: presentedStatus,
            // Persisted status is preserved so the stored synthesis stays
            // inspectable as history rather than silently rewritten.
            storedStatus: estate.status,
            stale: staleReason !== null,
            staleReason,
            staleConstituentCount,
            promptVersion: estate.promptVersion,
            model: estate.model,
            errorCode: estate.errorCode,
            retryAt: estate.retryAt,
            createdAt: estate.createdAt,
            completedAt: estate.completedAt,
            result,
          }
        : null,
      coverage,
      constituents,
    });
  } catch {
    return NextResponse.json(
      { error: "Estate synthesis is temporarily unavailable." },
      { status: 503 },
    );
  }
}
