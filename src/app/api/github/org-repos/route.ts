import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function parseStoredJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Safe-default read cap for this portfolio-adjacent unauthenticated read.
// TODO(threat-model): owner to decide the org/corpus exposure policy; until
// then keep DB-backed org reads bounded.
const ORG_REPOS_READ_LIMIT = 200;

export async function GET(request: NextRequest) {
  const org = request.nextUrl.searchParams.get("org")?.trim();
  if (!org) {
    return NextResponse.json({ error: "org is required" }, { status: 400 });
  }

  try {
    // Intent: DB-backed org read (not live GitHub fetch); the UI persists on
    // the /github/projects corpus and discards this payload except on the org
    // view path (finding AB). Kept DB-backed intentionally.
    const projects = await db.project.findMany({
      where: { ownerLogin: org, ownerType: "Organization" },
      orderBy: { githubUpdatedAt: "desc" },
      take: ORG_REPOS_READ_LIMIT,
    });
    return NextResponse.json({
      projects: projects.map((project) => ({
        ...project,
        topics: project.topics ? project.topics.split(",").filter(Boolean) : [],
        tags: project.tags ? project.tags.split(",").filter(Boolean) : [],
        fileTree: parseStoredJson(project.fileTree),
        dependencies: parseStoredJson(project.dependencies),
        keyFiles: parseStoredJson(project.keyFiles),
        similarProjects: parseStoredJson(project.similarProjects),
        codeSignature: parseStoredJson(project.codeSignature),
      })),
      totalRepos: projects.length,
      org,
    });
  } catch {
    return NextResponse.json(
      { error: "Organization projects are temporarily unavailable." },
      { status: 503 },
    );
  }
}