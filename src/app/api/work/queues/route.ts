import { NextRequest, NextResponse } from "next/server";
import { loadWorkQueues } from "@/lib/work-queues-server";

export async function GET(request: NextRequest) {
  try {
    const projectGithubId = Number(request.nextUrl.searchParams.get("project"));
    const projectFilter: { githubId?: number } =
      Number.isSafeInteger(projectGithubId) && projectGithubId > 0
        ? { githubId: projectGithubId }
        : {};
    if (request.nextUrl.searchParams.has("project") && !projectFilter.githubId) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const result = await loadWorkQueues(projectFilter);
    if (!result) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Work queues are temporarily unavailable." },
      { status: 503 },
    );
  }
}
