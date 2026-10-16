import { NextRequest, NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/internal-sync-auth";
import { runNextSemanticAnalysis } from "@/lib/semantic-analysis";

/**
 * Process one bounded revision-aware analysis. Every successful or incomplete
 * result is persisted before returning, so the next worker tick can resume it.
 */
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const username: unknown = body.username;
    const projectId: unknown = body.projectId;
    if (
      username !== undefined &&
      (typeof username !== "string" || username.length > 100)
    ) {
      return NextResponse.json(
        { error: "username must be a bounded string" },
        { status: 400 },
      );
    }
    if (
      projectId !== undefined &&
      (typeof projectId !== "string" || projectId.length > 100)
    ) {
      return NextResponse.json(
        { error: "projectId must be a bounded string" },
        { status: 400 },
      );
    }
    const result = await runNextSemanticAnalysis(
      {
        ...(typeof username === "string" ? { ownerLogin: username } : {}),
        ...(typeof projectId === "string" ? { projectId } : {}),
      },
    );
    return NextResponse.json({
      step: "semantic",
      done: result.status === "idle" || result.status === "skipped",
      result,
    });
  } catch {
    // Do not include provider error text, prompts, source content, or tokens.
    console.error("sync/enrich-next failed");
    return NextResponse.json(
      { error: "Semantic analysis could not be completed" },
      { status: 500 },
    );
  }
}