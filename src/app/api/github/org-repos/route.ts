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

export async function GET(request: NextRequest) {
  const org = request.nextUrl.searchParams.get("org")?.trim();
  if (!org) {
    return NextResponse.json({ error: "org is required" }, { status: 400 });
  }

  try {
    const projects = await db.project.findMany({
      where: { ownerLogin: org, ownerType: "Organization" },
      orderBy: { githubUpdatedAt: "desc" },
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