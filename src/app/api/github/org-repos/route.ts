import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { GITHUB_HEADERS } from '@/lib/github-token';

export async function GET(request: NextRequest) {
  try {
    const org = request.nextUrl.searchParams.get('org');
    if (!org) {
      return NextResponse.json({ error: 'org is required' }, { status: 400 });
    }

    // Fetch org repos (all pages)
    const allRepos: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}&type=all`,
        { headers: GITHUB_HEADERS }
      );

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json(
          { error: `GitHub API error: ${res.status} ${errText}` },
          { status: res.status }
        );
      }

      const repos = await res.json();
      allRepos.push(...repos);
      hasMore = repos.length === 100;
      page++;
    }

    if (allRepos.length === 0) {
      return NextResponse.json({ error: `No repos found for org ${org}` }, { status: 404 });
    }

    // Fetch README for each repo (in batches of 8)
    const batchSize = 8;
    for (let i = 0; i < allRepos.length; i += batchSize) {
      const batch = allRepos.slice(i, i + batchSize);
      const readmeResults = await Promise.allSettled(
        batch.map(async (repo: any) => {
          try {
            const readmeRes = await fetch(
              `https://api.github.com/repos/${repo.full_name}/readme`,
              { headers: { ...GITHUB_HEADERS, 'Accept': 'application/vnd.github.v3.raw' } }
            );
            if (readmeRes.ok) {
              const text = await readmeRes.text();
              return { id: repo.id, readme: text.slice(0, 4000) };
            }
          } catch { /* skip */ }
          return { id: repo.id, readme: null };
        })
      );
      readmeResults.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value) {
          (batch[idx] as any)._readme = result.value.readme;
        }
      });
    }

    // Upsert into DB with ownerType='Organization'
    for (const repo of allRepos) {
      const r = repo as any;
      await db.project.upsert({
        where: { githubId: r.id },
        update: {
          name: r.name,
          fullName: r.full_name,
          description: r.description,
          htmlUrl: r.html_url,
          homepage: r.homepage,
          language: r.language,
          stargazersCount: r.stargazers_count ?? 0,
          forksCount: r.forks_count ?? 0,
          openIssuesCount: r.open_issues_count ?? 0,
          githubCreatedAt: new Date(r.created_at),
          githubUpdatedAt: new Date(r.updated_at),
          pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
          topics: (r.topics || []).join(','),
          isFork: r.fork ?? false,
          isArchived: r.archived ?? false,
          ownerLogin: r.owner?.login ?? org,
          ownerType: 'Organization',
          ownerAvatarUrl: r.owner?.avatar_url ?? null,
          defaultBranch: r.default_branch ?? 'main',
          visibility: r.visibility ?? 'public',
          readmeContent: r._readme ?? undefined,
        },
        create: {
          githubId: r.id,
          name: r.name,
          fullName: r.full_name,
          description: r.description,
          htmlUrl: r.html_url,
          homepage: r.homepage,
          language: r.language,
          stargazersCount: r.stargazers_count ?? 0,
          forksCount: r.forks_count ?? 0,
          openIssuesCount: r.open_issues_count ?? 0,
          githubCreatedAt: new Date(r.created_at),
          githubUpdatedAt: new Date(r.updated_at),
          pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
          topics: (r.topics || []).join(','),
          isFork: r.fork ?? false,
          isArchived: r.archived ?? false,
          ownerLogin: r.owner?.login ?? org,
          ownerType: 'Organization',
          ownerAvatarUrl: r.owner?.avatar_url ?? null,
          defaultBranch: r.default_branch ?? 'main',
          visibility: r.visibility ?? 'public',
          readmeContent: r._readme ?? null,
        },
      });
    }

    // Return same format as projects API
    const projects = await db.project.findMany({
      where: {
        ownerLogin: org,
        ownerType: 'Organization',
      },
      orderBy: { githubUpdatedAt: 'desc' },
    });

    return NextResponse.json({
      projects: projects.map(p => ({
        ...p,
        // Prisma returns BigInt for githubId on PostgreSQL; JSON cannot
        // serialize bigint, so convert at the API boundary.
        githubId: Number(p.githubId),
        topics: p.topics ? p.topics.split(',').filter(Boolean) : [],
        tags: p.tags ? p.tags.split(',').filter(Boolean) : [],
        fileTree: p.fileTree ? (typeof p.fileTree === 'string' ? JSON.parse(p.fileTree) : p.fileTree) : null,
        dependencies: p.dependencies ? (typeof p.dependencies === 'string' ? JSON.parse(p.dependencies) : p.dependencies) : null,
        keyFiles: p.keyFiles ? (typeof p.keyFiles === 'string' ? JSON.parse(p.keyFiles) : p.keyFiles) : null,
        similarProjects: p.similarProjects ? (typeof p.similarProjects === 'string' ? JSON.parse(p.similarProjects) : p.similarProjects) : null,
        codeSignature: p.codeSignature ? (typeof p.codeSignature === 'string' ? JSON.parse(p.codeSignature) : p.codeSignature) : null,
      })),
      totalRepos: allRepos.length,
      org,
    });
  } catch (error: any) {
    console.error('Org repos error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
