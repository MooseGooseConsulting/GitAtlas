import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CockpitActiveFilters } from '@/components/cockpit-active-filters';
import { ConceptGroups, filterProjectsByConceptGroups, getConceptGroupById } from '@/components/concept-groups';
import { DEFAULT_FILTERS } from '@/components/advanced-filters';
import type { Project } from '@/lib/types';
import { useAtlasStore } from '@/lib/store';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'repo',
    githubId: 1,
    name: 'repo',
    fullName: 'owner/repo',
    description: null,
    htmlUrl: 'https://github.com/owner/repo',
    homepage: null,
    language: null,
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

describe('concept group selection and filtering', () => {
  beforeEach(() => {
    useAtlasStore.getState().setProjects([
      makeProject({ id: 'ai-repo', name: 'agent-workbench', description: 'An AI assistant' }),
      makeProject({ id: 'portfolio', name: 'portfolio', description: 'Personal notes' }),
    ]);
    useAtlasStore.getState().setActiveConceptGroups([]);
  });

  test('shows per-concept project counts and toggles selected concept IDs', () => {
    render(<ConceptGroups />);
    const aiGroup = screen.getByRole('button', { name: /AI & Intelligence/ });

    expect(aiGroup.textContent).toContain('1');
    expect(getConceptGroupById('ai')?.icon).toBe('🧠');

    fireEvent.click(aiGroup);
    expect(useAtlasStore.getState().activeConceptGroups).toEqual(['ai']);
    expect(aiGroup.className).toContain('bg-emerald-500/10');
  });

  test('cockpit filtering returns the union of selected groups for the visible project count', () => {
    const aiProject = makeProject({ id: 'ai-repo', name: 'agent-workbench', description: 'An AI assistant' });
    const webProject = makeProject({ id: 'web-repo', name: 'react-dashboard', topics: ['frontend'] });
    const unmatched = makeProject({ id: 'portfolio', name: 'portfolio', description: 'Personal notes' });

    const filtered = filterProjectsByConceptGroups([aiProject, webProject, unmatched], ['ai', 'web']);

    expect(filtered).toEqual([aiProject, webProject]);
    expect(filtered.length).toBe(2);
  });
});

describe('cockpit active filter chips', () => {
  beforeEach(() => {
    useAtlasStore.getState().setActiveConceptGroups([]);
  });

  afterEach(() => {
    cleanup();
  });

  test('removes one concept or language chip while preserving other selected filters', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      selectedLanguages: ['TypeScript', 'Rust'],
      selectedCategories: ['tool'],
      minStars: 5,
    };
    const onFiltersChange = vi.fn((_next: typeof filters) => {});
    const onConceptGroupsChange = vi.fn((_groups: string[]) => {});

    render(
      <CockpitActiveFilters
        filters={filters}
        activeConceptGroups={['ai', 'web']}
        onFiltersChange={onFiltersChange}
        onConceptGroupsChange={onConceptGroupsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove concept filter ai' }));
    expect(onConceptGroupsChange).toHaveBeenCalledWith(['web']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove language filter TypeScript' }));
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...filters,
      selectedLanguages: ['Rust'],
    });
  });
});
