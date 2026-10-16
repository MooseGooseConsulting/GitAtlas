import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { GITHUB_HEADERS } from '@/lib/github-token';

/**
 * POST /api/sync/refresh
 *
 * Why this exists:
 *   The full `/api/github/fetch` route is heavy (it walks every page, every org,
 *   every README). For ongoing "live" refresh we only need to detect which repos
 *   changed since the last poll and mark them stale so the enrichment worker can
 *   re-analyze them on its next pass.
 *
 * Logic:
 *   1. Pull only the first page (sort=updated) of the user's repos. GitHub
 *      returns them in updated-desc order, so anything beyond the most recent
 *      30-100 is by definition older than what we already have.
 *   2. Compare each repo's `updated_at` against the row in the DB. If it's
 *      newer, clear `analyzedAt` and `deepAnalyzedAt` so the enrich worker
 *      will pick it up.
 *   3. If a repo is new (not in DB yet), upsert a minimal row so the next
 *      enrich tick will fill in the analysis.
 *
 * This route is intentionally cheap so it can run on a tight interval
 * (default: every 15 minutes via the sync-worker).
 */
export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json();
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    // Cheap "what changed" probe: just the first page sorted by updated.
    const res = await fetch(
      `https://api.github.com/users/${username}/repos?per_page=100&page=1&sort=updated`,
      { headers: GITHUB_HEADERS }
    );
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `GitHub API error: ${res.status} ${errText}` },
        { status: res.status },
      );
    }
    const repos: any[] = await res.json();

    const existing = await db.project.findMany({
      where: { ownerLogin: username },
      select: { githubId: true, githubUpdatedAt: true },
    });
    // Prisma returns githubId as bigint on PostgreSQL while GitHub supplies
    // numbers; Map keys use SameValueZero (42n !== 42), so normalize both
    // sides to String for the lookup.
    const existingMap = new Map(existing.map((r) => [String(r.githubId), r.githubUpdatedAt]));

    let changed = 0;
    let created = 0;
    for (const repo of repos) {
      const newUpdated = new Date(repo.updated_at);
      const prev = existingMap.get(String(repo.id));

      if (!prev) {
        // Brand new repo. Upsert a thin row; enrich worker will hydrate it.
        await db.project.create({
          data: {
            githubId: BigInt(repo.id),
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description,
            htmlUrl: repo.html_url,
            homepage: repo.homepage,
            language: repo.language,
            stargazersCount: repo.stargazers_count ?? 0,
            forksCount: repo.forks_count ?? 0,
            openIssuesCount: repo.open_issues_count ?? 0,
            githubCreatedAt: new Date(repo.created_at),
            githubUpdatedAt: newUpdated,
            pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
            topics: (repo.topics || []).join(','),
            isFork: repo.fork ?? false,
            isArchived: repo.archived ?? false,
            ownerLogin: repo.owner?.login ?? username,
            ownerType: repo.owner?.type ?? 'User',
            ownerAvatarUrl: repo.owner?.avatar_url ?? null,
            defaultBranch: repo.default_branch ?? 'main',
            visibility: repo.visibility ?? 'public',
          },
        });
        created++;
        continue;
      }

      if (newUpdated.getTime() > prev.getTime()) {
        // Why null both fields: marking analyzedAt/deepAnalyzedAt as null is the
        // signal the enrich-next worker uses to pick a repo up for re-analysis.
        await db.project.update({
          where: { githubId: BigInt(repo.id) },
          data: {
            githubUpdatedAt: newUpdated,
            pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
            stargazersCount: repo.stargazers_count ?? 0,
            forksCount: repo.forks_count ?? 0,
            openIssuesCount: repo.open_issues_count ?? 0,
            description: repo.description,
            topics: (repo.topics || []).join(','),
            isArchived: repo.archived ?? false,
            analyzedAt: null,
            deepAnalyzedAt: null,
          },
        });
        changed++;
      }
    }

    return NextResponse.json({
      ok: true,
      probed: repos.length,
      changed,
      created,
    });
  } catch (err: any) {
    console.error('sync/refresh failed:', err);
    return NextResponse.json({ error: err?.message || 'unknown error' }, { status: 500 });
  }
}
