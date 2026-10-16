import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getWorkResourceScope,
  syncProjectWorkResources,
} from "@/lib/github-work-resources";
import { isInternalRequestAuthorized } from "@/lib/internal-sync-auth";

const WORK_TYPES = [
  "issue",
  "pull_request",
  "branch",
  "commit",
  "deployment",
] as const;
const SAFE_FAILURE_CODES = new Set([
  "missing_token",
  "network_failure",
  "provider_failure",
  "rate_limited",
  "scope_unsupported",
  "invalid_pagination",
  "invalid_provider_response",
]);

// Finding C-cap: bound the unauthenticated bulk read. Without a ?project
// filter the query below would dump the whole workResource table plus its
// references include. Keep the auth-model decision with the owner; just cap
// it. TODO(threat-model): owner to decide unauth corpus reads vs auth gate.
const WORK_RESOURCES_READ_LIMIT = 500;

// Finding M: Prisma BigInt githubId cannot be JSON-serialized; convert with
// the Number() pattern used by github/projects (safe integer, else string).
function toSafeGithubId(value: unknown): number | string | null {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : String(value);
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const projectGithubId = Number(request.nextUrl.searchParams.get("project"));
    const sourceType = request.nextUrl.searchParams.get("type");
    const project = Number.isSafeInteger(projectGithubId) && projectGithubId > 0
      ? await db.project.findUnique({
          where: { githubId: projectGithubId },
            select: {
              id: true,
              githubId: true,
              fullName: true,
              inventoryStatus: true,
            },
        })
      : null;
    if (request.nextUrl.searchParams.has("project") && !project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    const rawResources = await db.workResource.findMany({
      where: {
        ...(project ? { projectId: project.id } : {}),
        ...(WORK_TYPES.includes(sourceType as (typeof WORK_TYPES)[number])
          ? { sourceType: sourceType as (typeof WORK_TYPES)[number] }
          : {}),
      },
      orderBy: [{ sourceUpdatedAt: "desc" }, { createdAt: "desc" }],
      take: WORK_RESOURCES_READ_LIMIT,
      include: {
        project: { select: { githubId: true, fullName: true } },
        references: {
          select: {
            targetExternalId: true,
            targetSourceType: true,
            targetUrl: true,
            relationshipType: true,
            evidence: true,
          },
        },
      },
    });
    const resources = rawResources.map((resource) => ({
      ...resource,
      project: {
        fullName:
          (resource as { project?: { fullName?: unknown } }).project
            ?.fullName ?? "unknown",
        githubId: toSafeGithubId(
          (resource as { project?: { githubId?: unknown } }).project?.githubId,
        ),
      },
    }));
    // Finding M: Prisma returns githubId as BigInt on PG but ProjectRef
    // wants number — convert at the boundary (in-scope: owned route file).
    const projectRef = project
      ? { ...project, githubId: Number(project.githubId) }
      : null;
    const states = projectRef
      ? await Promise.all(
          ([...WORK_TYPES, "services", "agents"] as const).map((type) =>
            db.syncState.findUnique({
              where: {
                scope: getWorkResourceScope(projectRef, type),
              },
              select: {
                scope: true,
                status: true,
                fetchedAt: true,
                lastSuccessAt: true,
                retryAt: true,
                errorCode: true,
                itemCount: true,
                unsupportedCount: true,
                pagesFetched: true,
              },
            }),
          ),
        )
      : [];
    const scopes = states
      .filter((state) => state !== null)
      .map((state) => ({
        ...state,
        status:
          state.status === "current" &&
          (projectRef?.inventoryStatus !== "current" ||
            (state.lastSuccessAt !== null &&
              Date.now() - state.lastSuccessAt.getTime() >
                6 * 60 * 60 * 1000))
            ? "stale"
            : state.status,
      }));
    return NextResponse.json({
      resources,
      scopes,
      unsupported: {
        services: { status: "unsupported", reason: "source_unavailable" },
        agents: { status: "unsupported", reason: "source_unavailable" },
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Work resource snapshots are temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [projects, projectCount] = await Promise.all([
      db.project.findMany({
        where: { inventoryStatus: "current" },
        select: {
          id: true,
          githubId: true,
          ownerLogin: true,
          name: true,
          htmlUrl: true,
        },
        orderBy: { githubId: "asc" },
      }),
      db.project.count(),
    ]);
    const skippedProjects = Math.max(projectCount - projects.length, 0);
    let syncedProjects = 0;
    let failedProjects = 0;
    let failedScopes = 0;
    let unsupportedScopes = 0;
    let resources = 0;
    let pagesFetched = 0;
    const failureCodes: Record<string, number> = {};
    for (const project of projects) {
      // These sources have no supported GitHub API in the current snapshotter.
      unsupportedScopes += 2;
      try {
        // Finding M: convert Prisma BigInt githubId to number at the
        // boundary before passing to ProjectRef-typed sync.
        const result = await syncProjectWorkResources({
          ...project,
          githubId: Number(project.githubId),
        });
        syncedProjects++;
        for (const value of Object.values(result)) {
          resources += value.count;
          pagesFetched += value.pages;
          if (value.unsupported) unsupportedScopes++;
        }
      } catch (error) {
        failedProjects++;
        const rawCode =
          error instanceof Error &&
          "code" in error &&
          typeof (error as Error & { code?: unknown }).code === "string"
            ? (error as Error & { code: string }).code
            : "sync_failure";
        const code = SAFE_FAILURE_CODES.has(rawCode)
          ? rawCode
          : "sync_failure";
        failureCodes[code] = (failureCodes[code] ?? 0) + 1;
        failedScopes++;
        const failedPages =
          error instanceof Error &&
          "pagesFetched" in error &&
          typeof (error as Error & { pagesFetched?: unknown }).pagesFetched ===
            "number"
            ? (error as Error & { pagesFetched: number }).pagesFetched
            : 0;
        pagesFetched += failedPages;
      }
    }
    const status =
      failedProjects > 0
        ? syncedProjects > 0 || skippedProjects > 0
          ? "partial"
          : "failed"
        : unsupportedScopes > 0 || skippedProjects > 0
          ? "partial"
          : "current";
    return NextResponse.json({
      ok: status === "current",
      status,
      projectCount,
      attemptedProjectCount: projects.length,
      syncedProjectCount: syncedProjects,
      skippedProjectCount: skippedProjects,
      failedProjectCount: failedProjects,
      failedScopeCount: failedScopes,
      unsupportedScopeCount: unsupportedScopes,
      resourceCount: resources,
      pagesFetched,
      failureCodes,
    });
  } catch (error) {
    const failure =
      error instanceof Error && "code" in error
        ? (error as Error & {
            code: string;
            status?: number;
            pagesFetched?: number;
            retryAt?: string | null;
          })
        : null;
    return NextResponse.json(
      {
        ok: false,
        status:
          failure?.code === "rate_limited"
            ? "deferred"
            : failure?.pagesFetched
              ? "partial"
              : "failed",
        errorCode: failure?.code ?? "sync_failure",
        pagesFetched: failure?.pagesFetched ?? 0,
        retryAt: failure?.retryAt ?? null,
      },
      { status: failure?.status ?? 503 },
    );
  }
}
