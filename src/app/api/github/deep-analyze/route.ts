import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { GITHUB_HEADERS } from '@/lib/github-token';
// Why: provider-agnostic LLM client (see src/lib/llm.ts).
import { chat } from '@/lib/llm';
import { isInternalRequestAuthorized } from '@/lib/internal-sync-auth';

export async function POST(request: NextRequest) {
  // KEEP: internal token gate. UI (page.tsx) and sync-worker send
  // Authorization: Bearer <GITATLAS_INTERNAL_SYNC_TOKEN>; unauth callers get
  // 401 by design. Do not remove this gate (finding A).
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { projectId, username, repoIndex } = body;
    const isProgressive = request.nextUrl.searchParams.get('progress') === 'true';

    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    // Progressive mode: analyze ONE repo at a time
    if (isProgressive) {
      return await handleProgressiveAnalysis(username, repoIndex ?? 0);
    }

    // Batch mode (original behavior)
    // If projectId is provided, analyze just that project
    // If not, analyze all projects without deep analysis
    const where = projectId
      ? { id: projectId }
      : { ownerLogin: username, deepAnalyzedAt: null };

    const projects = await db.project.findMany({ where });

    if (projects.length === 0) {
      return NextResponse.json({ error: 'No projects found for deep analysis', results: [], total: 0 });
    }

    const results: { id: string; name: string; status: string; error?: string }[] = [];

    // Process in batches of 3 to avoid rate limiting
    const batchSize = 3;
    for (let i = 0; i < projects.length; i += batchSize) {
      const batch = projects.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (project) => {
          try {
            return await analyzeProject(project, username);
          } catch {
            console.error("Deep analysis failed for a repository.");
            return { id: project.id, name: project.name, status: 'failed', error: 'Analysis failed' };
          }
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({ id: 'unknown', name: 'unknown', status: 'failed', error: 'Analysis failed' });
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < projects.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return NextResponse.json({ results, total: results.length });
  } catch {
    console.error("Deep analysis request failed.");
    return NextResponse.json({ error: "Analysis request failed" }, { status: 500 });
  }
}

/**
 * Progressive analysis: analyze ONE repo at a time so the frontend can show
 * real-time per-repo progress by chaining requests.
 */
async function handleProgressiveAnalysis(
  username: string,
  repoIndex: number
): Promise<NextResponse> {
  // Get all unanalyzed repos for this user
  const unanalyzed = await db.project.findMany({
    where: { ownerLogin: username, deepAnalyzedAt: null },
    orderBy: { githubUpdatedAt: 'desc' },
  });

  // Count total repos and already-completed for this user
  const totalForUser = await db.project.count({
    where: { ownerLogin: username },
  });
  const completedCount = await db.project.count({
    where: { ownerLogin: username, deepAnalyzedAt: { not: null } },
  });

  if (unanalyzed.length === 0) {
    return NextResponse.json({
      result: null,
      total: totalForUser,
      completed: completedCount,
      nextIndex: completedCount,
      message: 'All projects have been analyzed',
    });
  }

  // Clamp repoIndex to valid range
  const idx = Math.min(Math.max(0, repoIndex), unanalyzed.length - 1);
  const project = unanalyzed[idx];

  try {
    const result = await analyzeProject(project, username);

    // Recount completed after this analysis
    const newCompleted = await db.project.count({
      where: { ownerLogin: username, deepAnalyzedAt: { not: null } },
    });

    return NextResponse.json({
      result,
      total: totalForUser,
      completed: newCompleted,
      nextIndex: newCompleted, // Frontend can use this as the next repoIndex
    });
  } catch {
    console.error("Progressive deep analysis failed for a repository.");
    return NextResponse.json({
      result: { id: project.id, name: project.name, status: 'failed', error: 'Analysis failed' },
      total: totalForUser,
      completed: completedCount,
      nextIndex: completedCount,
    });
  }
}

/**
 * Analyze a single project — shared by batch and progressive modes.
 */
async function analyzeProject(
  project: any,
  username: string
): Promise<{ id: string; name: string; status: string; error?: string }> {
  // Build file tree from repo contents via GitHub API
  const fileTree = await buildFileTree(project.fullName, project.defaultBranch);

  // Analyze dependencies from package.json or similar
  const dependencies = await analyzeDependencies(project.fullName, project.defaultBranch);

  // Extract key files (entry points, configs, etc)
  const keyFiles = await extractKeyFiles(project.fullName, project.defaultBranch, fileTree);

  // Detect code signature (frameworks, patterns, architecture)
  const codeSignature = detectCodeSignature(project, fileTree, dependencies);

  // Generate deep summary using LLM with actual code context
  const deepSummary = await generateDeepSummary(project, fileTree, dependencies, codeSignature, keyFiles);

  // Find similar projects
  const similarProjects = await findSimilarProjects(project, username);

  // Update the project with deep analysis results
  await db.project.update({
    where: { id: project.id },
    data: {
      fileTree: JSON.stringify(fileTree),
      dependencies: JSON.stringify(dependencies),
      keyFiles: JSON.stringify(keyFiles),
      deepSummary,
      deepAnalyzedAt: new Date(),
      codeSignature: JSON.stringify(codeSignature),
      similarProjects: JSON.stringify(similarProjects),
    },
  });

  return { id: project.id, name: project.name, status: 'completed' };
}

async function buildFileTree(fullName: string, branch: string) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${fullName}/git/trees/${branch}?recursive=1`,
      { headers: GITHUB_HEADERS }
    );

    if (!res.ok) return [];

    const data = await res.json();
    if (!data.tree) return [];

    // Filter out noise directories and limit size
    const SKIP_DIRS = new Set([
      'node_modules', '.git', '__pycache__', '.next', 'dist', 'build',
      '.cache', 'vendor', 'target', '.venv', 'venv', 'env', '.tox',
      'coverage', '.nyc_output', 'out', '.output', '.nuxt', '.turbo',
      'podspecs', 'Pods', '.gradle', '.idea', '.vscode', '.history',
    ]);

    const tree: { path: string; type: string }[] = data.tree
      .filter((item: any) => {
        const parts = item.path.split('/');
        return !parts.some((p: string) => SKIP_DIRS.has(p));
      })
      .slice(0, 500)
      .map((item: any) => ({
        path: item.path,
        type: item.type === 'tree' ? 'dir' : 'file',
      }));

    return tree;
  } catch {
    return [];
  }
}

async function analyzeDependencies(fullName: string, branch: string): Promise<Record<string, string[]> | null> {
  try {
    // Try package.json first
    const res = await fetch(
      `https://api.github.com/repos/${fullName}/contents/package.json?ref=${branch}`,
      { headers: GITHUB_HEADERS }
    );

    if (res.ok) {
      const data = await res.json();
      if (data.content) {
        const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
        const runtime = Object.keys(content.dependencies || {});
        const dev = Object.keys(content.devDependencies || {});
        if (runtime.length > 0 || dev.length > 0) {
          return { runtime, dev };
        }
      }
    }

    // Try requirements.txt for Python
    const pyRes = await fetch(
      `https://api.github.com/repos/${fullName}/contents/requirements.txt?ref=${branch}`,
      { headers: GITHUB_HEADERS }
    );

    if (pyRes.ok) {
      const data = await pyRes.json();
      if (data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const runtime = content.split('\n')
          .filter((l: string) => l.trim() && !l.startsWith('#') && !l.startsWith('-'))
          .map((l: string) => l.split('==')[0].split('>=')[0].split('~=')[0].split('<')[0].split('>')[0].trim())
          .filter(Boolean);
        return { runtime, dev: [] };
      }
    }

    // Try pyproject.toml
    const pyprojectRes = await fetch(
      `https://api.github.com/repos/${fullName}/contents/pyproject.toml?ref=${branch}`,
      { headers: GITHUB_HEADERS }
    );

    if (pyprojectRes.ok) {
      const data = await pyprojectRes.json();
      if (data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        // Simple parsing - extract lines after [project] dependencies or dependencies =
        const runtime: string[] = [];
        let inDeps = false;
        for (const line of content.split('\n')) {
          if (line.trim() === 'dependencies = [' || line.includes('[project.dependencies]')) {
            inDeps = true;
            continue;
          }
          if (inDeps && line.trim() === ']') break;
          if (inDeps && line.includes('"')) {
            const match = line.match(/"([^"]+)"/);
            if (match) runtime.push(match[1].split(/[><=!]/)[0].trim());
          }
          if (inDeps && line.includes("'")) {
            const match = line.match(/'([^']+)'/);
            if (match) runtime.push(match[1].split(/[><=!]/)[0].trim());
          }
        }
        if (runtime.length > 0) return { runtime, dev: [] };
      }
    }

    // Try Cargo.toml for Rust
    const cargoRes = await fetch(
      `https://api.github.com/repos/${fullName}/contents/Cargo.toml?ref=${branch}`,
      { headers: GITHUB_HEADERS }
    );

    if (cargoRes.ok) {
      const data = await cargoRes.json();
      if (data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const runtime: string[] = [];
        const dev: string[] = [];
        let section = '';
        for (const line of content.split('\n')) {
          if (line.trim() === '[dependencies]') section = 'runtime';
          else if (line.trim() === '[dev-dependencies]') section = 'dev';
          else if (line.startsWith('[')) section = '';
          else if (section && line.includes('=')) {
            const name = line.split('=')[0].trim();
            if (name) (section === 'dev' ? dev : runtime).push(name);
          }
        }
        if (runtime.length > 0 || dev.length > 0) return { runtime, dev };
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function extractKeyFiles(fullName: string, branch: string, fileTree: { path: string; type: string }[]) {
  const results: { path: string; content: string; purpose: string }[] = [];

  // Detect key files to read based on the file tree
  const keyFilePatterns = [
    // Entry points
    { pattern: /^(src\/)?(index|main|app|cli|server|cmd)\.(ts|js|py|rs|go)$/, purpose: 'Entry point' },
    // Config files
    { pattern: /^(tsconfig|vite\.config|next\.config|tailwind\.config|webpack\.config|jest\.config)\.(js|ts|json|mjs)$/, purpose: 'Configuration' },
    // Build/deploy
    { pattern: /^(Dockerfile|docker-compose|Makefile|\.env\.example)$/, purpose: 'Build/Deploy' },
  ];

  const filesToFetch: { path: string; purpose: string }[] = [];

  // Always fetch these if they exist
  const alwaysFetch = ['package.json', 'requirements.txt', 'Cargo.toml', 'pyproject.toml'];
  for (const fileName of alwaysFetch) {
    if (fileTree.some(f => f.path === fileName)) {
      filesToFetch.push({ path: fileName, purpose: getKeyFilePurpose(fileName) });
    }
  }

  // Find entry points and configs
  for (const file of fileTree) {
    if (file.type !== 'file') continue;
    for (const { pattern, purpose } of keyFilePatterns) {
      if (pattern.test(file.path)) {
        filesToFetch.push({ path: file.path, purpose });
        break;
      }
    }
    if (filesToFetch.length >= 8) break;
  }

  // Fetch file contents (max 5 files, max 3000 chars each)
  for (const { path, purpose } of filesToFetch.slice(0, 5)) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${fullName}/contents/${path}?ref=${branch}`,
        { headers: { ...GITHUB_HEADERS, Accept: 'application/vnd.github.v3.raw' } }
      );
      if (res.ok) {
        const content = await res.text();
        results.push({ path, content: content.slice(0, 3000), purpose });
      }
    } catch { /* skip */ }
  }

  return results;
}

function getKeyFilePurpose(fileName: string): string {
  const map: Record<string, string> = {
    'package.json': 'Node.js project manifest',
    'requirements.txt': 'Python dependencies',
    'Cargo.toml': 'Rust package manifest',
    'pyproject.toml': 'Python project config',
    'Dockerfile': 'Container build instructions',
    'docker-compose.yml': 'Multi-container setup',
    '.env.example': 'Environment variable template',
    'Makefile': 'Build automation',
    'tsconfig.json': 'TypeScript configuration',
  };
  return map[fileName] || 'Configuration';
}

function detectCodeSignature(
  project: any,
  fileTree: { path: string; type: string }[],
  dependencies: Record<string, string[]> | null
): { frameworks: string[]; patterns: string[]; architecture: string } {
  const frameworks: string[] = [];
  const patterns: string[] = [];
  let architecture = 'Unknown';

  // Detect frameworks from dependencies
  if (dependencies) {
    const allDeps = [...(dependencies.runtime || []), ...(dependencies.dev || [])];
    if (allDeps.includes('next')) frameworks.push('Next.js');
    if (allDeps.includes('react')) frameworks.push('React');
    if (allDeps.includes('vue')) frameworks.push('Vue');
    if (allDeps.includes('express')) frameworks.push('Express');
    if (allDeps.includes('fastify')) frameworks.push('Fastify');
    if (allDeps.includes('svelte')) frameworks.push('Svelte');
    if (allDeps.includes('astro')) frameworks.push('Astro');
    if (allDeps.includes('nuxt')) frameworks.push('Nuxt');
    if (allDeps.includes('tailwindcss')) frameworks.push('Tailwind CSS');
    if (allDeps.includes('prisma')) frameworks.push('Prisma');
    if (allDeps.includes('trpc')) frameworks.push('tRPC');
    if (allDeps.includes('fastapi')) frameworks.push('FastAPI');
    if (allDeps.includes('flask')) frameworks.push('Flask');
    if (allDeps.includes('django')) frameworks.push('Django');
    if (allDeps.includes('click')) frameworks.push('Click');
    if (allDeps.includes('typer')) frameworks.push('Typer');
    if (allDeps.includes('rich')) frameworks.push('Rich');
    if (allDeps.includes('pydantic')) frameworks.push('Pydantic');
    if (allDeps.includes('sqlalchemy')) frameworks.push('SQLAlchemy');
    if (allDeps.includes('langchain') || allDeps.includes('langchain-core')) frameworks.push('LangChain');
    if (allDeps.includes('openai')) frameworks.push('OpenAI SDK');
    if (allDeps.includes('anthropic')) frameworks.push('Anthropic SDK');
    if (allDeps.includes('tokio')) frameworks.push('Tokio');
    if (allDeps.includes('actix-web')) frameworks.push('Actix');
    if (allDeps.includes('axum')) frameworks.push('Axum');
    if (allDeps.includes('typescript')) patterns.push('TypeScript');
    if (allDeps.includes('eslint')) patterns.push('Linting');
    if (allDeps.includes('jest') || allDeps.includes('vitest')) patterns.push('Unit Testing');
    if (allDeps.includes('playwright') || allDeps.includes('cypress')) patterns.push('E2E Testing');
  }

  // Detect from file tree
  const paths = fileTree.map(f => f.path);
  if (paths.some(p => p.startsWith('src/app/'))) architecture = 'App Router (Next.js)';
  else if (paths.some(p => p.startsWith('src/pages/') || p.startsWith('pages/'))) architecture = 'Pages Router (Next.js)';
  else if (paths.some(p => p.startsWith('src/components/'))) patterns.push('Component-based');
  if (paths.some(p => p.includes('api/') || p.includes('routes/'))) patterns.push('API Routes');
  if (paths.some(p => p.includes('.test.') || p.includes('.spec.') || p.includes('tests/'))) patterns.push('Test Files');
  if (paths.some(p => p.includes('docker') || p.includes('Dockerfile'))) patterns.push('Containerized');
  if (paths.some(p => p.includes('.github/workflows'))) patterns.push('CI/CD');
  if (paths.some(p => p.includes('mcp') || p.includes('mcp-server'))) patterns.push('MCP');
  if (paths.some(p => p.includes('prompt') || p.includes('agent') || p.includes('llm'))) patterns.push('AI/LLM');

  // Detect from language
  if (project.language === 'Rust') {
    if (paths.some(p => p.includes('src/main.rs'))) architecture = 'Binary (Rust)';
    else if (paths.some(p => p.includes('src/lib.rs'))) architecture = 'Library (Rust)';
  }
  if (project.language === 'Python') {
    if (paths.some(p => p.includes('app.py') || p.includes('main.py'))) architecture = 'Script-based (Python)';
    if (paths.some(p => p.includes('__init__.py'))) patterns.push('Package');
    if (paths.some(p => p.includes('cli.py'))) patterns.push('CLI');
  }
  if (project.language === 'Go') {
    if (paths.some(p => p.includes('cmd/'))) architecture = 'Multi-binary (Go)';
    else if (paths.some(p => p.endsWith('main.go'))) architecture = 'Single binary (Go)';
  }

  if (frameworks.length === 0 && project.language) {
    frameworks.push(project.language);
  }

  return { frameworks, patterns, architecture };
}

async function generateDeepSummary(
  project: any,
  fileTree: { path: string; type: string }[],
  dependencies: Record<string, string[]> | null,
  codeSignature: { frameworks: string[]; patterns: string[]; architecture: string },
  keyFiles: { path: string; content: string; purpose: string }[]
): Promise<string> {
  try {
    // Provider-agnostic chat client; see src/lib/llm.ts.

    // Build rich context from actual code analysis
    const treeOverview = fileTree
      .slice(0, 80)
      .map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}`)
      .join('\n');

    const keyFilesContext = keyFiles.length > 0
      ? keyFiles.map(kf => `--- ${kf.path} (${kf.purpose}) ---\n${kf.content.slice(0, 1500)}`).join('\n\n')
      : 'No key files extracted';

    const depsContext = dependencies
      ? `Runtime: ${dependencies.runtime?.join(', ') || 'none'}\nDev: ${dependencies.dev?.join(', ') || 'none'}`
      : 'No dependencies detected';

    const summary = (await chat({
      messages: [
        {
          role: 'system',
          content: `You are a project analyst who reads actual source code and describes what a project ACTUALLY does — not what it aspires to do. Be concrete, specific, and honest. If the project seems unfinished or is a learning experiment, say so. Focus on what the code reveals about the project's purpose and current state.`,
        },
        {
          role: 'user',
          content: [
            `Repo: ${project.fullName}`,
            `Name: ${project.name}`,
            `Language: ${project.language || 'Unknown'}`,
            `Description: ${project.description || 'No description'}`,
            `Category: ${project.category || 'Unknown'}`,
            `Tags: ${project.tags || 'None'}`,
            `Is Fork: ${project.isFork}`,
            ``,
            `Architecture: ${codeSignature.architecture}`,
            `Frameworks: ${codeSignature.frameworks.join(', ') || 'None detected'}`,
            `Patterns: ${codeSignature.patterns.join(', ') || 'None detected'}`,
            ``,
            `Dependencies:`,
            depsContext,
            ``,
            `File Tree (first 80 entries):`,
            treeOverview,
            ``,
            `Key Files:`,
            keyFilesContext,
          ].join('\n'),
        },
      ],
      temperature: 0.4,
    })).trim();
    if (summary && summary.length > 10) {
      return summary;
    }
  } catch {
    console.error("Deep summary generation failed; using bounded metadata fallback.");
  }

  // Fallback: heuristic summary
  const parts: string[] = [];
  if (codeSignature.architecture !== 'Unknown') {
    parts.push(`Uses ${codeSignature.architecture} architecture.`);
  }
  if (codeSignature.frameworks.length > 0) {
    parts.push(`Built with ${codeSignature.frameworks.join(', ')}.`);
  }
  if (dependencies) {
    const runtimeCount = dependencies.runtime?.length || 0;
    const devCount = dependencies.dev?.length || 0;
    parts.push(`${runtimeCount} runtime and ${devCount} dev dependencies.`);
  }
  const fileCount = fileTree.filter(f => f.type === 'file').length;
  const dirCount = fileTree.filter(f => f.type === 'dir').length;
  if (fileCount > 0) {
    parts.push(`${fileCount} files across ${dirCount} directories.`);
  }
  if (codeSignature.patterns.length > 0) {
    parts.push(`Patterns: ${codeSignature.patterns.join(', ')}.`);
  }
  return parts.join(' ') || `${project.name} - deep analysis completed.`;
}

async function findSimilarProjects(
  project: any,
  username: string
): Promise<{ id: string; name: string; reason: string; score: number }[]> {
  const allProjects = await db.project.findMany({
    where: { ownerLogin: username, id: { not: project.id } },
  });

  const similar: { id: string; name: string; reason: string; score: number }[] = [];

  const pTags = project.tags ? project.tags.split(',').filter(Boolean) : [];
  const pTopics = project.topics ? project.topics.split(',').filter(Boolean) : [];
  const pDeps: Record<string, string[]> = project.dependencies
    ? (typeof project.dependencies === 'string' ? JSON.parse(project.dependencies) : project.dependencies)
    : {};
  const pAllDeps = [...(pDeps.runtime || []), ...(pDeps.dev || [])];

  let pCodeSig: any = {};
  if (project.codeSignature) {
    try {
      pCodeSig = typeof project.codeSignature === 'string' ? JSON.parse(project.codeSignature) : project.codeSignature;
    } catch { /* ignore */ }
  }

  for (const other of allProjects) {
    let score = 0;
    const reasons: string[] = [];

    // Same language (+30)
    if (project.language && other.language && project.language === other.language) {
      score += 30;
      reasons.push(`Same language (${project.language})`);
    }

    // Same category (+25)
    if (project.category && other.category && project.category === other.category) {
      score += 25;
      reasons.push(`Same category (${project.category})`);
    }

    // Shared tags (+10 per tag)
    const oTags = other.tags ? other.tags.split(',').filter(Boolean) : [];
    const sharedTags = pTags.filter((t: string) => oTags.includes(t));
    if (sharedTags.length > 0) {
      score += sharedTags.length * 10;
      reasons.push(`Shared tags: ${sharedTags.slice(0, 3).join(', ')}`);
    }

    // Shared topics (+8 per topic)
    const oTopics = other.topics ? other.topics.split(',').filter(Boolean) : [];
    const sharedTopics = pTopics.filter((t: string) => oTopics.includes(t));
    if (sharedTopics.length > 0) {
      score += sharedTopics.length * 8;
      reasons.push(`Shared topics: ${sharedTopics.slice(0, 3).join(', ')}`);
    }

    // Shared dependencies (+5 per dep, max 30)
    if (other.dependencies) {
      try {
        const oDeps = typeof other.dependencies === 'string'
          ? JSON.parse(other.dependencies)
          : other.dependencies;
        const oAllDeps = [...(oDeps.runtime || []), ...(oDeps.dev || [])];
        const sharedDeps = pAllDeps.filter((d: string) => oAllDeps.includes(d));
        if (sharedDeps.length > 0) {
          score += Math.min(sharedDeps.length * 5, 30);
          reasons.push(`Shared deps: ${sharedDeps.slice(0, 3).join(', ')}`);
        }
      } catch { /* skip */ }
    }

    // Shared frameworks from code signature (+8 per framework)
    if (other.codeSignature) {
      try {
        const oCodeSig = typeof other.codeSignature === 'string'
          ? JSON.parse(other.codeSignature)
          : other.codeSignature;
        if (pCodeSig.frameworks && oCodeSig.frameworks) {
          const sharedFw = pCodeSig.frameworks.filter((f: string) => oCodeSig.frameworks.includes(f));
          if (sharedFw.length > 0) {
            score += sharedFw.length * 8;
            reasons.push(`Shared frameworks: ${sharedFw.join(', ')}`);
          }
        }
      } catch { /* skip */ }
    }

    if (score >= 15) {
      similar.push({
        id: other.id,
        name: other.name,
        reason: reasons.join('; '),
        score: Math.min(score, 100),
      });
    }
  }

  return similar.sort((a, b) => b.score - a.score).slice(0, 5);
}
