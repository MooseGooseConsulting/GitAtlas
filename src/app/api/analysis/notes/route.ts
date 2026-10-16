import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isInternalRequestAuthorized } from "@/lib/internal-sync-auth";

export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.projectId !== "string" ||
    body.projectId.length > 100 ||
    typeof body.note !== "string" ||
    body.note.trim().length === 0 ||
    body.note.length > 4000 ||
    (body.author !== undefined &&
      (typeof body.author !== "string" ||
        body.author.trim().length === 0 ||
        body.author.length > 100))
  ) {
    return NextResponse.json(
      { error: "projectId, note, and optional author are invalid" },
      { status: 400 },
    );
  }

  const project = await db.project.findUnique({
    where: { id: body.projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const note = await db.ownerNote.create({
    data: {
      projectId: project.id,
      author:
        typeof body.author === "string" ? body.author.trim() : "operator",
      provenance: "owner",
      note: body.note.trim(),
    },
    select: {
      id: true,
      projectId: true,
      author: true,
      provenance: true,
      note: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ note }, { status: 201 });
}