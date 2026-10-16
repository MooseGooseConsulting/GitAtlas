import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function parseDeepFields(p: any) {
  return {
    ...p,
    // Prisma returns BigInt for githubId on PostgreSQL; JSON cannot serialize
    // bigint, so convert at the API boundary (safe: GitHub IDs fit in double).
    githubId: Number(p.githubId),
    topics: p.topics ? p.topics.split(',').filter(Boolean) : [],
    tags: p.tags ? p.tags.split(',').filter(Boolean) : [],
    fileTree: p.fileTree ? (typeof p.fileTree === 'string' ? JSON.parse(p.fileTree) : p.fileTree) : null,
    dependencies: p.dependencies ? (typeof p.dependencies === 'string' ? JSON.parse(p.dependencies) : p.dependencies) : null,
    keyFiles: p.keyFiles ? (typeof p.keyFiles === 'string' ? JSON.parse(p.keyFiles) : p.keyFiles) : null,
    similarProjects: p.similarProjects ? (typeof p.similarProjects === 'string' ? JSON.parse(p.similarProjects) : p.similarProjects) : null,
    codeSignature: p.codeSignature ? (typeof p.codeSignature === 'string' ? JSON.parse(p.codeSignature) : p.codeSignature) : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const username = request.nextUrl.searchParams.get('username');
    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    const projects = await db.project.findMany({
      where: {
        OR: [
          { ownerLogin: username },
        ],
      },
      orderBy: { githubUpdatedAt: 'desc' },
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
