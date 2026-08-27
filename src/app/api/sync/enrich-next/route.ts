import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/sync/enrich-next
 *
 * LEGACY COMPATIBILITY: this endpoint orchestrates the pre-#10 in-app AI
 * enrichment path. It chooses stale repositories and invokes the old shallow
 * and deep analysis routes.
 *
 * Target direction (issues #9-#19): do not extend this endpoint into a larger
 * semantic orchestrator or agent framework. New repository/corpus semantic
 * reasoning should be delegated to an existing capable coding/research
 * harness via the thin handoff in #10 and prompts/skills in #11/#13.
 *
 * Useful change-detection/staleness behavior may survive into #18, but semantic
 * meaning should not be decided by deterministic sequencing here.
 *
 * Current legacy strategy:
 *   1. If any project has `analyzedAt = null`, run shallow analyze on its owner's
 *      pending batch via /api/github/analyze.
 *   2. Otherwise if any project has `deepAnalyzedAt = null`, pick one and run
 *      deep-analyze for it.
 *   3. Otherwise return `{ done: true }`.
 *
 * Body: { username, baseUrl? } where baseUrl defaults to the request origin.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const username: string | undefined = body.username;
    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }
    // Why prefer the request origin: when called by the worker from the same
    // host the worker can pass an explicit baseUrl; in the browser/local case
    // the origin is correct automatically.
    const origin = body.baseUrl || new URL(request.url).origin;

    // Step 1: any shallow-pending repos for this user?
    const pendingShallow = await db.project.findFirst({
      where: { ownerLogin: username, summary: null },
      select: { id: true },
    });
    if (pendingShallow) {
      // Spawn an analysis job (shallow). Why: the analyze route accepts a jobId
      // and handles batching/state itself, so we keep this orchestrator dumb.
      const job = await db.analysisJob.create({
        data: {
          username,
          status: 'pending',
          totalRepos: await db.project.count({
            where: { ownerLogin: username, summary: null },
          }),
          processedRepos: 0,
          jobType: 'shallow',
        },
      });
      const res = await fetch(`${origin}/api/github/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ step: 'shallow', jobId: job.id, result: data });
    }

    // Step 2: pick one deep-pending repo.
    const pendingDeep = await db.project.findFirst({
      where: { ownerLogin: username, deepAnalyzedAt: null },
      orderBy: { githubUpdatedAt: 'desc' },
      select: { id: true, fullName: true },
    });
    if (pendingDeep) {
      const res = await fetch(`${origin}/api/github/deep-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Why: deep-analyze accepts { username, projectId } to target a single repo.
        body: JSON.stringify({ username, projectId: pendingDeep.id }),
      });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({
        step: 'deep',
        project: pendingDeep.fullName,
        result: data,
      });
    }

    return NextResponse.json({ done: true });
  } catch (err: any) {
    console.error('sync/enrich-next failed:', err);
    return NextResponse.json({ error: err?.message || 'unknown error' }, { status: 500 });
  }
}
