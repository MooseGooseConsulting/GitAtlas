import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshAccessibleInventory } from "@/lib/github-inventory-sync";
import { isInternalRequestAuthorized } from "@/lib/internal-sync-auth";

// Safe default cap for the DB-backed corpus read below. The inventory itself
// is full-accessible-scope by design; this cap only bounds the response.
// TODO(threat-model): owner to decide single-user default vs full-corpus
// read; keep capped until that decision lands.
const FETCH_PROJECTS_LIMIT = 500;

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

export async function POST(request: NextRequest) {
  // KEEP: internal token gate. UI (page.tsx) and sync-worker send
  // Authorization: Bearer <GITATLAS_INTERNAL_SYNC_TOKEN>; unauth callers get
  // 401 by design. Do not remove this gate (finding A).
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rawUsername =
      typeof body.username === "string" && body.username.trim()
        ? body.username.trim()
        : "accessible-token";
    // Bound caller-controlled job label (matches sync/enrich-next pattern).
    const username = rawUsername.slice(0, 100);
    const inventory = await refreshAccessibleInventory();
    const job = await db.analysisJob.create({
      data: {
        username,
        status: "pending",
        totalRepos: inventory.itemCount,
        processedRepos: 0,
      },
    });
    const projects = await db.project.findMany({
      orderBy: { githubUpdatedAt: "desc" },
      take: FETCH_PROJECTS_LIMIT,
    });

    return NextResponse.json({
      jobId: job.id,
      totalRepos: inventory.itemCount,
      inventory,
      projects: projects.map((project) => ({
        ...project,
        githubId: toSafeGithubId(
          (project as unknown as { githubId?: unknown }).githubId,
        ),
        topics: project.topics ? project.topics.split(",").filter(Boolean) : [],
        tags: project.tags ? project.tags.split(",").filter(Boolean) : [],
      })),
    });
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const providerError = error as Error & {
        status: number;
        code?: string;
        retryAt?: string | null;
        pagesFetched?: number;
      };
      return NextResponse.json(
        {
          error: "GitHub inventory is incomplete; last-good records were retained.",
          status: providerError.code === "rate_limited" ? "deferred" : "partial",
          scope: "github:accessible-repositories",
          errorCode: providerError.code ?? "provider_failure",
          retryAt: providerError.retryAt ?? null,
          pagesFetched: providerError.pagesFetched ?? 0,
        },
        { status: providerError.status },
      );
    }
    console.error("GitHub inventory sync failed.");
    return NextResponse.json(
      { error: "GitHub inventory sync failed." },
      { status: 500 },
    );
  }
}