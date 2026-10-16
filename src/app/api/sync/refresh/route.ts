import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getInventoryScope,
  refreshAccessibleInventory,
} from "@/lib/github-inventory-sync";
import { isInternalRequestAuthorized } from "@/lib/internal-sync-auth";

const STALE_AFTER_MS = 30 * 60 * 1000;

export async function GET() {
  try {
    const [scope, heads] = await Promise.all([
      db.syncState.findUnique({
        where: { scope: getInventoryScope() },
      }),
      db.syncState.findUnique({
        where: { scope: "github:default-branch-heads" },
      }),
    ]);
    const [projectCount, staleProjectCount, unverifiedProjectCount] = await Promise.all([
      db.project.count(),
      db.project.count({ where: { inventoryStatus: "stale" } }),
      db.project.count({ where: { inventoryStatus: "unverified" } }),
    ]);
    const stale =
      scope?.lastSuccessAt != null &&
      Date.now() - scope.lastSuccessAt.getTime() > STALE_AFTER_MS;
    const headsStale =
      heads?.lastSuccessAt != null &&
      Date.now() - heads.lastSuccessAt.getTime() > STALE_AFTER_MS;
    const inventoryStatus = stale && scope?.status === "current"
      ? "stale"
      : scope?.status ?? "unknown";
    const headsStatus = headsStale && heads?.status === "current"
      ? "stale"
      : heads?.status ?? "unknown";
    const status = ["partial", "deferred", "failed"].includes(headsStatus)
      ? headsStatus
      : headsStatus === "stale" || inventoryStatus === "stale"
        ? "stale"
      : inventoryStatus;
    return NextResponse.json({
      scope: getInventoryScope(),
      status,
      fetchedAt: scope?.fetchedAt ?? null,
      lastSuccessAt: scope?.lastSuccessAt ?? null,
      retryAt:
        headsStatus === "deferred"
          ? (heads?.retryAt ?? scope?.retryAt ?? null)
          : (scope?.retryAt ?? null),
      errorCode:
        headsStatus === "deferred" || headsStatus === "partial"
          ? (heads?.errorCode ?? scope?.errorCode ?? null)
          : (scope?.errorCode ?? null),
      itemCount: scope?.itemCount ?? projectCount,
      pagesFetched: scope?.pagesFetched ?? 0,
      retainedProjectCount: projectCount,
      staleProjectCount,
      unverifiedProjectCount,
      resources: {
        repositories: {
          status: inventoryStatus,
          fetchedAt: scope?.fetchedAt ?? null,
          lastSuccessAt: scope?.lastSuccessAt ?? null,
        },
        defaultBranchHeads: {
          status: headsStatus,
          fetchedAt: heads?.fetchedAt ?? null,
          lastSuccessAt: heads?.lastSuccessAt ?? null,
          retryAt: heads?.retryAt ?? null,
          errorCode: heads?.errorCode ?? null,
          itemCount: heads?.itemCount ?? 0,
          unsupportedCount: heads?.unsupportedCount ?? 0,
          unverifiedCount: Math.max(
            0,
            (scope?.itemCount ?? 0) -
              (heads?.itemCount ?? 0) -
              (heads?.unsupportedCount ?? 0),
          ),
        },
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Inventory freshness is temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshAccessibleInventory();
    return NextResponse.json({
      ok: true,
      scope: getInventoryScope(),
      ...result,
    });
  } catch (error) {
    const providerError =
      error instanceof Error && "status" in error
        ? (error as Error & {
            status: number;
            code?: string;
            retryAt?: string | null;
            pagesFetched?: number;
          })
        : null;
    if (!providerError) {
      console.error("sync/refresh failed.");
      return NextResponse.json(
        { error: "Inventory refresh failed." },
        { status: 500 },
      );
    }
    const scope = await db.syncState.findUnique({
      where: { scope: getInventoryScope() },
    });
    return NextResponse.json(
      {
        ok: false,
        scope: getInventoryScope(),
        status: scope?.status ?? "failed",
        fetchedAt: scope?.fetchedAt ?? null,
        lastSuccessAt: scope?.lastSuccessAt ?? null,
        itemCount: scope?.itemCount ?? 0,
        pagesFetched: providerError.pagesFetched ?? 0,
        retryAt: providerError.retryAt ?? null,
        errorCode: providerError.code ?? "provider_failure",
      },
      { status: providerError.status },
    );
  }
}