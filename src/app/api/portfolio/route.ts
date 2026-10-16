import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getInventoryScope } from "@/lib/github-inventory-sync";
import { buildPortfolioSummary } from "@/lib/portfolio-view";
import { loadWorkQueues } from "@/lib/work-queues-server";

// Single read endpoint for the portfolio-first landing: corpus counts,
// inventory freshness, per-resource-type scope states (including per-scope
// error codes, retained-but-unverified rows, unsupported and unattempted
// scopes) and the evidence-derived work queues. Read-only.
export async function GET() {
  try {
    const [
      projectCount,
      statusGroups,
      visibilityGroups,
      archivedCount,
      inventoryScopes,
      workScopeStates,
      resourceCounts,
    ] = await Promise.all([
      db.project.count(),
      db.project.groupBy({ by: ["inventoryStatus"], _count: { _all: true } }),
      db.project.groupBy({ by: ["visibility"], _count: { _all: true } }),
      db.project.count({ where: { isArchived: true } }),
      db.syncState.findMany({
        where: { scope: { in: [getInventoryScope(), "github:default-branch-heads"] } },
        select: {
          scope: true,
          status: true,
          lastSuccessAt: true,
          errorCode: true,
          itemCount: true,
          unsupportedCount: true,
        },
      }),
      db.syncState.findMany({
        where: { scope: { startsWith: "github:work-resources:" } },
        select: {
          scope: true,
          status: true,
          lastSuccessAt: true,
          errorCode: true,
          itemCount: true,
          unsupportedCount: true,
        },
      }),
      db.workResource.groupBy({ by: ["sourceType"], _count: { _all: true } }),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const group of statusGroups) {
      statusCounts[group.inventoryStatus] = group._count._all;
    }
    const visibilityCounts: Record<string, number> = {};
    for (const group of visibilityGroups) {
      visibilityCounts[group.visibility] = group._count._all;
    }
    const retainedRowCounts: Record<string, number> = {};
    for (const group of resourceCounts) {
      retainedRowCounts[group.sourceType] = group._count._all;
    }

    const queues = projectCount === 0 ? null : await loadWorkQueues();

    return NextResponse.json(
      buildPortfolioSummary({
        now: new Date(),
        totalProjects: projectCount,
        statusCounts,
        visibilityCounts,
        archivedCount,
        inventoryScope: inventoryScopes.find((s) => s.scope === getInventoryScope()) ?? null,
        workScopeStates,
        retainedRowCounts,
        queues,
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "Portfolio summary is temporarily unavailable." },
      { status: 503 },
    );
  }
}
