import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { PortfolioOverview } from '@/components/portfolio-overview';
import type { Project } from '@/lib/types';
import { useAtlasStore } from '@/lib/store';
import type { PortfolioSummary } from '@/lib/portfolio-view';
import type { QueueEntry } from '@/lib/work-queues';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'repo',
    githubId: 1,
    name: 'repo',
    fullName: 'owner/repo',
    description: null,
    htmlUrl: 'https://github.com/owner/repo',
    homepage: null,
    language: 'TypeScript',
    stargazersCount: 0,
    forksCount: 0,
    openIssuesCount: 0,
    githubCreatedAt: '2024-01-01T00:00:00.000Z',
    githubUpdatedAt: '2024-01-01T00:00:00.000Z',
    pushedAt: null,
    topics: [],
    isFork: false,
    isArchived: false,
    ownerLogin: 'owner',
    ownerType: 'User',
    ownerAvatarUrl: null,
    defaultBranch: 'main',
    visibility: 'public',
    summary: null,
    tags: [],
    category: null,
    readmeContent: null,
    analyzedAt: null,
    fileTree: null,
    dependencies: null,
    keyFiles: null,
    deepSummary: null,
    deepAnalyzedAt: null,
    proposedReadme: null,
    readmeGeneratedAt: null,
    similarProjects: null,
    codeSignature: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAtlasStore.setState({ searchQuery: '', portfolioStatusFilter: 'all', selectedProject: null });
});

test('portfolio list, queues and visible count intersect cockpit scope without narrowing corpus totals or losing work-title search', async () => {
  const typescript = makeProject({ id: 'ts', name: 'frontend', fullName: 'owner/frontend', language: 'TypeScript' });
  const rust = makeProject({ id: 'rust', name: 'backend', fullName: 'owner/backend', language: 'Rust' });
  const entries: QueueEntry[] = [typescript, rust].map(project => ({
    resourceId: `${project.id}-pr`, projectId: project.id, projectFullName: project.fullName,
    sourceType: 'pull_request', externalId: '1', issueNumber: 1, title: 'Fix certificate handling',
    sourceUrl: project.htmlUrl, sourceState: 'open', sourceUpdatedAt: '2026-10-17T00:00:00Z',
  }));
  const summary: PortfolioSummary = {
    emptyCorpus: false,
    corpus: { total: 2, current: 2, retainedUnverified: 0, stale: 0, privateCount: 0, archived: 0 },
    inventory: { status: 'current', errorCode: null, itemCount: 2, lastSuccessAt: null },
    workScopes: [],
    queues: {
      generatedAt: '2026-10-17T00:00:00Z',
      queues: { attention: [], active: entries, recent: [], blocked: [], ready: [], stale: [] },
      uncertain: [], coverage: [],
    },
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/api/portfolio' ? summary : { estate: null, coverage: null },
  ), { status: 200 })));
  useAtlasStore.setState({ projects: [typescript, rust], searchQuery: '', portfolioStatusFilter: 'all', selectedProject: rust });
  const onCount = vi.fn();
  const { rerender } = render(<PortfolioOverview scopedProjects={[typescript]} onVisibleCountChange={onCount} />);
  await screen.findByTestId('portfolio-project-row');
  expect(screen.getAllByTestId('portfolio-project-row')).toHaveLength(1);
  expect(screen.getByTestId('portfolio-project-row').textContent).toContain('owner/frontend');
  expect(screen.getAllByTestId('queue-entry')).toHaveLength(1);
  expect(screen.getByTestId('queue-entry').textContent).toContain('owner/frontend');
  expect(screen.getByText('Repositories in corpus').parentElement?.textContent).toContain('2');
  expect(useAtlasStore.getState().selectedProject).toBeNull();
  expect(onCount).toHaveBeenLastCalledWith(1);

  act(() => useAtlasStore.getState().setSearchQuery('certificate'));
  expect(screen.getByTestId('portfolio-project-row').textContent).toContain('owner/frontend');
  rerender(<PortfolioOverview scopedProjects={[rust]} onVisibleCountChange={onCount} />);
  expect(screen.getByTestId('portfolio-project-row').textContent).toContain('owner/backend');
  expect(screen.getByTestId('queue-entry').textContent).toContain('owner/backend');

  rerender(<PortfolioOverview scopedProjects={[]} onVisibleCountChange={onCount} />);
  await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(0));
  expect(screen.queryAllByTestId('portfolio-project-row')).toHaveLength(0);
  expect(screen.queryAllByTestId('queue-entry')).toHaveLength(0);
  expect(screen.getByText('Repositories in corpus').parentElement?.textContent).toContain('2');
  fireEvent.click(screen.getByRole('button', { name: 'Clear search and status' }));
  expect(screen.queryByRole('button', { name: 'Clear search and status' })).toBeNull();
  expect(screen.queryAllByTestId('portfolio-project-row')).toHaveLength(0);
});
