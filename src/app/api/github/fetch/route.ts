import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { GITHUB_HEADERS } from '@/lib/github-token';

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json();
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    const allRepos: any[] = [];

    // Fetch user repos (all pages)
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const res = await fetch(
        `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&sort=updated`,
        { headers: GITHUB_HEADERS }
      );
      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json({ error: `GitHub API error: ${res.status} ${errText}` }, { status: res.status });
      }
      const repos = await res.json();
      allRepos.push(...repos);
      hasMore = repos.length === 100;
      page++;
    }

    // Fetch user's orgs
    const orgsRes = await fetch(
      `https://api.github.com/users/${username}/orgs`,
      { headers: GITHUB_HEADERS }
    );
    const orgs = orgsRes.ok ? await orgsRes.json() : [];

    // Fetch org repos
    for (const org of orgs) {
      let orgPage = 1;
      let orgHasMore = true;
      while (orgHasMore) {
        const orgRes = await fetch(
          `https://api.github.com/orgs/${org.login}/repos?per_page=100&page=${orgPage}&sort=updated`,
          { headers: GITHUB_HEADERS }
        );
        if (orgRes.ok) {
          const orgRepos = await orgRes.json();
          allRepos.push(...orgRepos);
          orgHasMore = orgRepos.length === 100;
          orgPage++;
        } else {
          orgHasMore = false;
        }
      }
    }

    // Also fetch repos the user has access to via the token
    const authedRes = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=1&sort=updated`,
      { headers: GITHUB_HEADERS }
    );
    if (authedRes.ok) {
      let authPage = 2;
      const authedRepos = await authedRes.json();
      allRepos.push(...authedRepos);
      let authHasMore = authedRepos.length === 100;
      while (authHasMore) {
        const pRes = await fetch(
          `https://api.github.com/user/repos?per_page=100&page=${authPage}&sort=updated`,
          { headers: GITHUB_HEADERS }
        );
        if (pRes.ok) {
          const pRepos = await pRes.json();
          allRepos.push(...pRepos);
          authHasMore = pRepos.length === 100;
          authPage++;
        } else {
          authHasMore = false;
        }
      }
    }

    // Deduplicate by id
    const seen = new Set<number>();
    const uniqueRepos = allRepos.filter((r: any) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    // Fetch README for each repo (in batches of 8)
    const batchSize = 8;
    for (let i = 0; i < uniqueRepos.length; i += batchSize) {
      const batch = uniqueRepos.slice(i, i + batchSize);
      const readmeResults = await Promise.allSettled(
        batch.map(async (repo: any) => {
          try {
            const readmeRes = await fetch(
              `https://api.github.com/repos/${repo.full_name}/readme`,
              { headers: { ...GITHUB_HEADERS, 'Accept': 'application/vnd.github.v3.raw' } }
            );
            if (readmeRes.ok) {
              const text = await readmeRes.text();
              // Truncate to ~4000 chars to fit in DB
              return { id: repo.id, readme: text.slice(0, 4000) };
            }
          } catch {}
          return { id: repo.id, readme: null };
        })
      );
      readmeResults.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value) {
          (batch[idx] as any)._readme = result.value.readme;
        }
      });
    }

    // Upsert into DB
    for (const repo of uniqueRepos) {
      const repoData = repo as any;
      await db.project.upsert({
        where: { githubId: repoData.id },
        update: {
          name: repoData.name,
          fullName: repoData.full_name,
          description: repoData.description,
          htmlUrl: repoData.html_url,
          homepage: repoData.homepage,
          language: repoData.language,
          stargazersCount: repoData.stargazers_count ?? 0,
          forksCount: repoData.forks_count ?? 0,
          openIssuesCount: repoData.open_issues_count ?? 0,
          githubCreatedAt: new Date(repoData.created_at),
          githubUpdatedAt: new Date(repoData.updated_at),
          pushedAt: repoData.pushed_at ? new Date(repoData.pushed_at) : null,
          topics: (repoData.topics || []).join(','),
          isFork: repoData.fork ?? false,
          isArchived: repoData.archived ?? false,
          ownerLogin: repoData.owner?.login ?? username,
          ownerType: repoData.owner?.type ?? 'User',
          ownerAvatarUrl: repoData.owner?.avatar_url ?? null,
          defaultBranch: repoData.default_branch ?? 'main',
          visibility: repoData.visibility ?? 'public',
          readmeContent: repoData._readme ?? undefined,
        },
        create: {
          githubId: repoData.id,
          name: repoData.name,
          fullName: repoData.full_name,
          description: repoData.description,
          htmlUrl: repoData.html_url,
          homepage: repoData.homepage,
          language: repoData.language,
          stargazersCount: repoData.stargazers_count ?? 0,
          forksCount: repoData.forks_count ?? 0,
          openIssuesCount: repoData.open_issues_count ?? 0,
          githubCreatedAt: new Date(repoData.created_at),
          githubUpdatedAt: new Date(repoData.updated_at),
          pushedAt: repoData.pushed_at ? new Date(repoData.pushed_at) : null,
          topics: (repoData.topics || []).join(','),
          isFork: repoData.fork ?? false,
          isArchived: repoData.archived ?? false,
          ownerLogin: repoData.owner?.login ?? username,
          ownerType: repoData.owner?.type ?? 'User',
          ownerAvatarUrl: repoData.owner?.avatar_url ?? null,
          defaultBranch: repoData.default_branch ?? 'main',
          visibility: repoData.visibility ?? 'public',
          readmeContent: repoData._readme ?? null,
        },
      });
    }

    // Create analysis job
    const job = await db.analysisJob.create({
      data: {
        username,
        status: 'pending',
        totalRepos: uniqueRepos.length,
        processedRepos: 0,
      },
    });

    // Get all projects from DB for response
    const projects = await db.project.findMany({
      where: {
        ownerLogin: username,
      },
      orderBy: { githubUpdatedAt: 'desc' },
    });

    return NextResponse.json({
      jobId: job.id,
      totalRepos: uniqueRepos.length,
      projects: projects.map(p => ({
        ...p,
        // Prisma returns BigInt for githubId on PostgreSQL; JSON cannot
        // serialize bigint, so convert at the API boundary.
        githubId: Number(p.githubId),
        topics: p.topics ? p.topics.split(',').filter(Boolean) : [],
        tags: p.tags ? p.tags.split(',').filter(Boolean) : [],
      })),
    });
  } catch (error: any) {
    console.error('Fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
