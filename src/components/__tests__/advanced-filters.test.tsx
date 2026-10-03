import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AdvancedFilters, applyAdvancedFilters, DEFAULT_FILTERS, removeAdvancedFilter } from '@/components/advanced-filters';
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

describe('applyAdvancedFilters', () => {
  test('excludes projects missing a selected language or category', () => {
    const matching = makeProject({ language: 'TypeScript', category: 'tool' });
    const missingLanguage = makeProject({ id: 'no-language', language: null, category: 'tool' });
    const missingCategory = makeProject({ id: 'no-category', category: null });

    expect(applyAdvancedFilters(
      [matching, missingLanguage, missingCategory],
      { ...DEFAULT_FILTERS, selectedLanguages: ['TypeScript'], selectedCategories: ['tool'] },
    )).toEqual([matching]);
  });

  test('applies the shared activity range to pushedAt and excludes missing activity', () => {
    const now = Date.parse('2026-10-03T00:00:00.000Z');
    const fiveDays = makeProject({ id: 'five-days', pushedAt: '2026-09-28T00:00:00.000Z' });
    const twentyDays = makeProject({ id: 'twenty-days', pushedAt: '2026-09-13T00:00:00.000Z' });
    const unknown = makeProject({ id: 'unknown-activity', pushedAt: null });

    expect(applyAdvancedFilters(
      [fiveDays, twentyDays, unknown],
      { ...DEFAULT_FILTERS, activityRangeDays: [1, 10] },
      now,
    )).toEqual([fiveDays]);
  });

  test('removing a selected filter preserves the other advanced filters', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      selectedLanguages: ['TypeScript', 'Rust'],
      selectedCategories: ['tool'],
      minStars: 4,
    };

    expect(removeAdvancedFilter(filters, 'selectedLanguages', 'TypeScript')).toEqual({
      ...filters,
      selectedLanguages: ['Rust'],
    });
  });
});

describe('AdvancedFilters interactions', () => {
  test('selection and reset change only advanced filters, preserving search and tags', () => {
    const projects = [makeProject()];
    let filters = DEFAULT_FILTERS;
    const onChange = vi.fn((next: typeof DEFAULT_FILTERS) => { filters = next; });

    useAtlasStore.getState().setSearchQuery('my independent query');
    useAtlasStore.getState().setActiveTags(['existing-tag']);
    const removed = removeAdvancedFilter(
      { ...DEFAULT_FILTERS, selectedLanguages: ['TypeScript'], selectedCategories: ['tool'] },
      'selectedLanguages',
      'TypeScript',
    );
    expect(removed).toMatchObject({ selectedLanguages: [], selectedCategories: ['tool'] });
    expect(useAtlasStore.getState().searchQuery).toBe('my independent query');
    expect(useAtlasStore.getState().activeTags).toEqual(['existing-tag']);

    const { rerender } = render(<AdvancedFilters projects={projects} filters={filters} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /typescript/i }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, selectedLanguages: ['TypeScript'] });

    filters = { ...filters, selectedLanguages: ['TypeScript'] };
    rerender(<AdvancedFilters projects={projects} filters={filters} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true }));

    expect(filters).toEqual(DEFAULT_FILTERS);
    expect(useAtlasStore.getState().searchQuery).toBe('my independent query');
    expect(useAtlasStore.getState().activeTags).toEqual(['existing-tag']);

    useAtlasStore.getState().setSearchQuery('');
    useAtlasStore.getState().setActiveTags([]);
  });
});

