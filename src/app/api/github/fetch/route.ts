import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshAccessibleInventory } from "@/lib/github-inventory-sync";
import { isInternalRequestAuthorized } from "@/lib/internal-sync-auth";

export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const username =
      typeof body.username === "string" && body.username.trim()
        ? body.username.trim()
        : "accessible-token";
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
    });

    return NextResponse.json({
      jobId: job.id,
      totalRepos: inventory.itemCount,
      inventory,
      projects: projects.map(p => {
        // Prisma returns BigInt for githubId on PostgreSQL; JSON cannot
        // serialize bigint, so convert at the API boundary. Guard against
        // precision loss for values above Number.MAX_SAFE_INTEGER.
        const githubIdNumber = Number(p.githubId);
        if (!Number.isSafeInteger(githubIdNumber)) {
          throw new Error(
            `githubId ${p.githubId.toString()} for project ${p.id} exceeds Number.MAX_SAFE_INTEGER; refusing lossy conversion.`
          );
        }
        // Deep-analysis columns are persisted as JSON strings; parse them
        // back to structured values at the API boundary. Malformed payloads
        // fall back to null rather than failing the whole response.
        const parseJsonField = (value: unknown) => {
          if (value == null) return null;
          if (typeof value !== 'string') return value;
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        };
        return {
          ...p,
          githubId: githubIdNumber,
          topics: p.topics ? p.topics.split(',').filter(Boolean) : [],
          tags: p.tags ? p.tags.split(',').filter(Boolean) : [],
          fileTree: parseJsonField(p.fileTree),
          dependencies: parseJsonField(p.dependencies),
          keyFiles: parseJsonField(p.keyFiles),
          similarProjects: parseJsonField(p.similarProjects),
          codeSignature: parseJsonField(p.codeSignature),
        };
      }),
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
