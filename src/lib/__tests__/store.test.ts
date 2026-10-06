// src/lib/__tests__/store.test.ts
//
// Why these tests exist: the Zustand store is the single source of truth for
// all app state. Complex reducers (toggleTag, updateProject, resetGraphTweaks,
// setConnectionSource) carry real logic that can regress silently. We test
// the store in isolation – no React, no DOM – because the store itself is
// pure synchronous state.
import { describe, test, expect, beforeEach } from 'vitest';
import { useAtlasStore } from '../store';
import type { Project } from '../types';

// Capture the initial state once, before any test mutations.
// zustand setState(snapshot, true) does a full replacement, which resets
// both data fields and action references back to their originals.
const INITIAL_STATE = useAtlasStore.getState();

beforeEach(() => {
  useAtlasStore.setState(INITIAL_STATE, true);
});

// ─── helpers ────────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    githubId: 1,
    name: 'test-repo',
    fullName: 'user/test-repo',
    description: null,
    htmlUrl: 'https://github.com/user/test-repo',
    homepage: null,
    language: 'TypeScript',
    stargazersCount: 10,
    forksCount: 0,
    openIssuesCount: 0,
    githubCreatedAt: '2024-01-01T00:00:00Z',
    githubUpdatedAt: '2024-01-01T00:00:00Z',
    pushedAt: null,
    topics: [],
    isFork: false,
    isArchived: false,
    ownerLogin: 'user',
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

// ─── default state ───────────────────────────────────────────────────────────

describe('default state', () => {
  test('starts with expected physics defaults', () => {
    const s = useAtlasStore.getState();
    expect(s.repulsion).toBe(3500);
    expect(s.linkStrength).toBe(0.004);
    expect(s.linkDistance).toBe(130);
    expect(s.depLinkDistance).toBe(100);
    expect(s.damping).toBe(0.92);
    expect(s.centering).toBe(0.008);
    expect(s.nodeSizeBase).toBe(10);
    expect(s.nodeSizeScale).toBe(1);
    expect(s.minSharedDeps).toBe(3);
  });

  test('connectionSources: tag/dependency on, framework/category/owner off', () => {
    const { connectionSources } = useAtlasStore.getState();
    expect(connectionSources.tag).toBe(true);
    expect(connectionSources.dependency).toBe(true);
    expect(connectionSources.framework).toBe(false);
    expect(connectionSources.category).toBe(false);
    expect(connectionSources.owner).toBe(false);
  });

  test('starts with no active tags or concept groups', () => {
    const s = useAtlasStore.getState();
    expect(s.activeTags).toEqual([]);
    expect(s.activeConceptGroups).toEqual([]);
  });

  test('view mode defaults to graph', () => {
    expect(useAtlasStore.getState().viewMode).toBe('graph');
  });
});

// ─── simple setters ──────────────────────────────────────────────────────────

describe('simple setters', () => {
  test('setUsername updates username', () => {
    useAtlasStore.getState().setUsername('alice');
    expect(useAtlasStore.getState().username).toBe('alice');
  });

  test('setViewMode updates viewMode', () => {
    useAtlasStore.getState().setViewMode('grid');
    expect(useAtlasStore.getState().viewMode).toBe('grid');
  });

  test('setSearchQuery updates searchQuery', () => {
    useAtlasStore.getState().setSearchQuery('atlas');
    expect(useAtlasStore.getState().searchQuery).toBe('atlas');
  });

  test('setLoading toggles isLoading', () => {
    useAtlasStore.getState().setLoading(false);
    expect(useAtlasStore.getState().isLoading).toBe(false);
  });
});

// ─── setSelectedProject ──────────────────────────────────────────────────────

describe('setSelectedProject', () => {
  test('setting a project also opens the detail panel', () => {
    const p = makeProject();
    useAtlasStore.getState().setSelectedProject(p);
    const s = useAtlasStore.getState();
    expect(s.selectedProject).toEqual(p);
    expect(s.detailOpen).toBe(true);
  });

  test('setting null closes the detail panel', () => {
    useAtlasStore.getState().setSelectedProject(makeProject());
    useAtlasStore.getState().setSelectedProject(null);
    const s = useAtlasStore.getState();
    expect(s.selectedProject).toBeNull();
    expect(s.detailOpen).toBe(false);
  });
});

// ─── toggleTag ───────────────────────────────────────────────────────────────

describe('toggleTag', () => {
  test('adds a tag that is not active', () => {
    useAtlasStore.getState().toggleTag('typescript');
    expect(useAtlasStore.getState().activeTags).toContain('typescript');
  });

  test('removes a tag that is already active', () => {
    useAtlasStore.getState().toggleTag('typescript');
    useAtlasStore.getState().toggleTag('typescript');
    expect(useAtlasStore.getState().activeTags).not.toContain('typescript');
  });

  test('toggling different tags accumulates correctly', () => {
    useAtlasStore.getState().toggleTag('react');
    useAtlasStore.getState().toggleTag('typescript');
    useAtlasStore.getState().toggleTag('react');
    const tags = useAtlasStore.getState().activeTags;
    expect(tags).toContain('typescript');
    expect(tags).not.toContain('react');
  });

  test('does not add duplicate tags', () => {
    useAtlasStore.getState().toggleTag('rust');
    useAtlasStore.getState().toggleTag('rust');
    expect(useAtlasStore.getState().activeTags.filter((t) => t === 'rust').length).toBe(0);
  });
});

// ─── updateProject ───────────────────────────────────────────────────────────

describe('updateProject', () => {
  const proj1 = makeProject({ id: 'proj-1', name: 'alpha' });
  const proj2 = makeProject({ id: 'proj-2', name: 'beta' });

  beforeEach(() => {
    useAtlasStore.getState().setProjects([proj1, proj2]);
  });

  test('updates the correct project and leaves others untouched', () => {
    useAtlasStore.getState().updateProject('proj-1', { name: 'alpha-updated' });
    const projects = useAtlasStore.getState().projects;
    expect(projects.find((p) => p.id === 'proj-1')?.name).toBe('alpha-updated');
    expect(projects.find((p) => p.id === 'proj-2')?.name).toBe('beta');
  });

  test('also updates selectedProject when it matches', () => {
    useAtlasStore.getState().setSelectedProject(proj1);
    useAtlasStore.getState().updateProject('proj-1', { summary: 'new summary' });
    expect(useAtlasStore.getState().selectedProject?.summary).toBe('new summary');
  });

  test('leaves selectedProject alone when IDs differ', () => {
    useAtlasStore.getState().setSelectedProject(proj2);
    useAtlasStore.getState().updateProject('proj-1', { summary: 'should not affect proj2' });
    expect(useAtlasStore.getState().selectedProject?.id).toBe('proj-2');
    expect(useAtlasStore.getState().selectedProject?.summary).toBeNull();
  });
});

// ─── setConnectionSource ─────────────────────────────────────────────────────

describe('setConnectionSource', () => {
  test('enables a disabled source', () => {
    useAtlasStore.getState().setConnectionSource('framework', true);
    expect(useAtlasStore.getState().connectionSources.framework).toBe(true);
  });

  test('disables an enabled source', () => {
    useAtlasStore.getState().setConnectionSource('tag', false);
    expect(useAtlasStore.getState().connectionSources.tag).toBe(false);
  });

  test('produces a new connectionSources object reference (immutability)', () => {
    const before = useAtlasStore.getState().connectionSources;
    useAtlasStore.getState().setConnectionSource('owner', true);
    const after = useAtlasStore.getState().connectionSources;
    // Must be a different reference so Zustand subscribers re-render
    expect(after).not.toBe(before);
    expect(after.owner).toBe(true);
    // Untouched keys survive the spread
    expect(after.tag).toBe(true);
    expect(after.dependency).toBe(true);
  });
});

// ─── resetGraphTweaks ────────────────────────────────────────────────────────

describe('resetGraphTweaks', () => {
  test('restores all physics constants to documented defaults', () => {
    // Dirty the state
    useAtlasStore.getState().setRepulsion(9999);
    useAtlasStore.getState().setDamping(0.1);
    useAtlasStore.getState().setConnectionSource('framework', true);
    useAtlasStore.getState().setEdgeThreshold(10);

    useAtlasStore.getState().resetGraphTweaks();

    const s = useAtlasStore.getState();
    expect(s.repulsion).toBe(3500);
    expect(s.linkStrength).toBe(0.004);
    expect(s.linkDistance).toBe(130);
    expect(s.depLinkDistance).toBe(100);
    expect(s.damping).toBe(0.92);
    expect(s.centering).toBe(0.008);
    expect(s.nodeSizeBase).toBe(10);
    expect(s.nodeSizeScale).toBe(1);
    expect(s.minSharedDeps).toBe(3);
    expect(s.edgeThreshold).toBe(2);
    expect(s.animationSpeed).toBe(1);
  });

  test('resets connectionSources to original defaults', () => {
    useAtlasStore.getState().setConnectionSource('framework', true);
    useAtlasStore.getState().setConnectionSource('category', true);

    useAtlasStore.getState().resetGraphTweaks();

    const { connectionSources } = useAtlasStore.getState();
    expect(connectionSources.tag).toBe(true);
    expect(connectionSources.dependency).toBe(true);
    expect(connectionSources.framework).toBe(false);
    expect(connectionSources.category).toBe(false);
    expect(connectionSources.owner).toBe(false);
  });

  test('reset does not affect non-physics state (searchQuery, activeTags)', () => {
    useAtlasStore.getState().setSearchQuery('preserved');
    useAtlasStore.getState().toggleTag('mytag');

    useAtlasStore.getState().resetGraphTweaks();

    expect(useAtlasStore.getState().searchQuery).toBe('preserved');
    expect(useAtlasStore.getState().activeTags).toContain('mytag');
  });
});

// ─── toggleConceptGroup ──────────────────────────────────────────────────────

describe('toggleConceptGroup', () => {
  test('adds a group that is not active', () => {
    useAtlasStore.getState().toggleConceptGroup('web');
    expect(useAtlasStore.getState().activeConceptGroups).toContain('web');
  });

  test('removes a group that is already active', () => {
    useAtlasStore.getState().toggleConceptGroup('web');
    useAtlasStore.getState().toggleConceptGroup('web');
    expect(useAtlasStore.getState().activeConceptGroups).not.toContain('web');
  });

  test('multiple groups accumulate independently', () => {
    useAtlasStore.getState().toggleConceptGroup('web');
    useAtlasStore.getState().toggleConceptGroup('cli');
    expect(useAtlasStore.getState().activeConceptGroups).toContain('web');
    expect(useAtlasStore.getState().activeConceptGroups).toContain('cli');
  });
});
