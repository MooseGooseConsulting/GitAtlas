import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function toSafeGithubId(value: unknown): number | string | null {
  // Prisma returns BigInt for githubId on PostgreSQL; JSON cannot serialize
  // bigint. Guard with Number.isSafeInteger and fall back to string (M).
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : String(value);
  }
  return null;
}

function parseDeepFields(p: any) {
  return {
    ...p,
    githubId: toSafeGithubId(p.githubId),
    topics: p.topics ? p.topics.split(',').filter(Boolean) : [],
    tags: p.tags ? p.tags.split(',').filter(Boolean) : [],
    fileTree: p.fileTree ? (typeof p.fileTree === 'string' ? JSON.parse(p.fileTree) : p.fileTree) : null,
    dependencies: p.dependencies ? (typeof p.dependencies === 'string' ? JSON.parse(p.dependencies) : p.dependencies) : null,
    keyFiles: p.keyFiles ? (typeof p.keyFiles === 'string' ? JSON.parse(p.keyFiles) : p.keyFiles) : null,
    similarProjects: p.similarProjects ? (typeof p.similarProjects === 'string' ? JSON.parse(p.similarProjects) : p.similarProjects) : null,
    codeSignature: p.codeSignature ? (typeof p.codeSignature === 'string' ? JSON.parse(p.codeSignature) : p.codeSignature) : null,
  };
}

// Safe-default read cap for this portfolio-adjacent unauthenticated read.
// TODO(threat-model): owner to decide whether `username=all` full-corpus
// reads stay; until then keep the corpus read bounded and default
// single-user scoped.
const PROJECTS_READ_LIMIT = 500;

export async function GET(request: NextRequest) {
  try {
    const username = request.nextUrl.searchParams.get('username');
    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    // Intent: DB-backed persisted corpus read. `username=all` exists for the
    // portfolio-first landing; single-user values scope to one ownerLogin.
    // Bounded by PROJECTS_READ_LIMIT as a safe default (findings B/D).
    const projects = await db.project.findMany({
      where: username === 'all'
        ? {}
        : {
            OR: [
              { ownerLogin: username },
            ],
          },
      orderBy: { githubUpdatedAt: 'desc' },
      take: PROJECTS_READ_LIMIT,
    });

    const analysisJob = await db.analysisJob.findFirst({
      where: { username },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      projects: projects.map(p => parseDeepFields(p)),
      analysisJob,
    });
  } catch (error: any) {
    console.error('Projects error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
