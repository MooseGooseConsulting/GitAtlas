'use client';

// Portfolio-first operational landing. Renders corpus counts, inventory
// freshness, evidence-derived work queues, uncertain evidence, per-resource
// scope states (with per-scope error codes) and the estate synthesis status
// before any repository is selected. Read-only: it never calls protected
// import/sync/analyze endpoints, so no internal bearer token is needed here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtlasStore } from '@/lib/store';
import { Project } from '@/lib/types';
import type { PortfolioSummary, PortfolioStatusFilter } from '@/lib/portfolio-view';
import { filterPortfolioProjects, narrowWorkQueues } from '@/lib/portfolio-view';
import type { QueueEntry, QueueName } from '@/lib/work-queues';
import {
  getSemanticStatus,
  semanticStatusKeyForAnalysis,
  semanticStatusKeyForInventory,
  type SemanticStatusKey,
} from '@/lib/semantic-palette';
import { SemanticBadge } from '@/components/semantic-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HeroInput } from '@/components/hero-input';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle, Archive, ArrowRight, CheckCircle2, Clock, ExternalLink,
  GitPullRequest, HelpCircle, Loader2, PauseCircle,
  RefreshCw, Search, X,
} from 'lucide-react';

const QUEUE_META: { key: PortfolioStatusFilter; label: string; hint: string; icon: React.ReactNode }[] = [
  { key: 'attention', label: 'Needs attention', hint: 'Explicit blockers or failed deployments', icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> },
  { key: 'active', label: 'Active', hint: 'Open items updated in the last 14 days', icon: <ArrowRight className="w-3.5 h-3.5 text-emerald-400" /> },
  { key: 'recent', label: 'Recently changed', hint: 'Any item updated in the last 7 days', icon: <Clock className="w-3.5 h-3.5 text-sky-400" /> },
  { key: 'blocked', label: 'Blocked', hint: 'Explicit blocking links to open targets', icon: <PauseCircle className="w-3.5 h-3.5 text-amber-400" /> },
  { key: 'ready', label: 'Ready to land', hint: 'Open PRs with recorded deployment success', icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> },
  { key: 'stale', label: 'Stale unfinished', hint: 'Open and unchanged for over 90 days', icon: <Archive className="w-3.5 h-3.5 text-muted-foreground" /> },
];

// Status chips come from the shared semantic palette (semantic-palette.ts +
// semantic-badge.tsx) so the landing, detail panel, graph and legends all
// mean the same thing in light and dark, with text/icons beside every color.

const STATUS_FILTERS: { key: PortfolioStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...QUEUE_META.map((q) => ({ key: q.key, label: q.label })),
  { key: 'uncertain', label: 'Uncertain evidence' },
  { key: 'unverified', label: 'Unverified inventory' },
  { key: 'archived', label: 'Archived' },
  { key: 'private', label: 'Private' },
];

type EstateCoverageCounts = {
  completed: number;
  pending: number;
  failed: number;
  staleOnly: number;
  unattempted: number;
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  try {
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return 'unknown';
  }
}

function QueueEntryRow({
  entry,
  onSelectProject,
}: {
  entry: QueueEntry;
  onSelectProject: (projectId: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-card/50 transition-colors group">
      <button
        onClick={() => onSelectProject(entry.projectId)}
        className="flex-1 min-w-0 text-left"
        data-testid="queue-entry"
      >
        <div className="flex items-center gap-1.5 text-xs text-foreground/80 group-hover:text-foreground">
          {entry.sourceType === 'pull_request'
            ? <GitPullRequest className="w-3 h-3 shrink-0 text-sky-400" />
            : <span className="w-3 text-center shrink-0 text-muted-foreground">#</span>}
          <span className="truncate">
            {entry.title || `${entry.sourceType} ${entry.issueNumber ?? entry.externalId}`}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/50 truncate">{entry.projectFullName}</div>
      </button>
      <a
        href={entry.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 mt-0.5 text-muted-foreground/40 hover:text-foreground"
        title="Open source object on GitHub"
        aria-label={`Open source object for ${entry.projectFullName}`}
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

export function PortfolioOverview() {
  const {
    projects,
    searchQuery,
    setSearchQuery,
    portfolioStatusFilter,
    setPortfolioStatusFilter,
    setSelectedProject,
  } = useAtlasStore();

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [estateStatus, setEstateStatus] = useState<{
    status: string;
    errorCode: string | null;
    completedAt: string | null;
    coverageCounts: EstateCoverageCounts | null;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [portfolioRes, estateRes] = await Promise.all([
        fetch('/api/portfolio'),
        fetch('/api/estate'),
      ]);
      if (portfolioRes.ok) {
        setSummary(await portfolioRes.json());
      } else {
        setLoadError('Portfolio summary is temporarily unavailable.');
      }
      if (estateRes.ok) {
        const estateData = await estateRes.json();
        setEstateStatus({
          status: estateData.estate?.status ?? 'none',
          errorCode: estateData.estate?.errorCode ?? null,
          completedAt: estateData.estate?.completedAt ?? null,
          coverageCounts: estateData.coverage?.counts ?? null,
        });
      }
    } catch {
      setLoadError('Portfolio summary is temporarily unavailable.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // If onboarding just loaded a non-empty persisted corpus, re-check the
  // summary so the landing replaces the empty-corpus state with real counts.
  useEffect(() => {
    if (projects.length > 0) loadOverview();
  }, [projects.length, loadOverview]);

  const filteredProjects = useMemo(
    () =>
      filterPortfolioProjects(projects, searchQuery, portfolioStatusFilter, summary?.queues ?? null),
    [projects, searchQuery, portfolioStatusFilter, summary],
  );

  // Empty queues are a missing/stale-evidence statement, not an observation
  // that no work exists. Computed before the early returns so hook order is
  // stable across loading/error/ready renders.
  const evidenceCounts = useMemo(() => {
    const counts = { current: 0, stale: 0, missing: 0, degraded: 0 };
    for (const entry of summary?.queues?.coverage ?? []) {
      if (entry.evidence in counts) {
        counts[entry.evidence as keyof typeof counts] += 1;
      }
    }
    return counts;
  }, [summary]);

  // A selection that no longer matches the active filters must not keep
  // showing unrelated detail.
  const filteredIds = useMemo(() => new Set(filteredProjects.map((p) => p.id)), [filteredProjects]);
  useEffect(() => {
    if (searchQuery === '' && portfolioStatusFilter === 'all') return;
    const { selectedProject } = useAtlasStore.getState();
    if (selectedProject && !filteredIds.has(selectedProject.id)) {
      setSelectedProject(null);
    }
  }, [filteredIds, searchQuery, portfolioStatusFilter, setSelectedProject]);

  // Work-queue rows and counts narrow with the same shared search and the
  // same selected status as the repository list: a row survives when it
  // matches the query (work title or owning repository) and is owned by a
  // repository that survived both filters. Corpus/coverage sections above
  // keep rendering the unfiltered totals.
  const narrowedQueues = useMemo(() => {
    if (!summary?.queues) return null;
    return narrowWorkQueues(summary.queues, searchQuery, filteredIds);
  }, [summary, searchQuery, filteredIds]);

  const selectProjectById = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (project) setSelectedProject(project);
    },
    [projects, setSelectedProject],
  );

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setPortfolioStatusFilter('all');
  }, [setSearchQuery, setPortfolioStatusFilter]);

  if (isLoading && !summary) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        <p className="text-sm">Loading portfolio overview…</p>
      </div>
    );
  }

  if (loadError && !summary) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="w-6 h-6 text-rose-400" />
        <p className="text-sm text-foreground/80">{loadError}</p>
        <Button variant="outline" size="sm" onClick={loadOverview}>
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (!summary) return null;

  // Empty corpus is an explicit onboarding state, never a fake zero summary.
  // The onboarding hero only reads persisted data; it never posts to the
  // protected import/sync endpoints.
  if (summary.emptyCorpus) {
    return (
      <div className="h-full flex items-center justify-center">
        <HeroInput />
      </div>
    );
  }

  const queues = summary.queues;
  const coverageByProject = new Map((queues?.coverage ?? []).map((c) => [c.projectId, c]));
  // Empty queues are a missing/stale-evidence statement, not an observation
  // that no work exists.
  const emptyQueueNote = (() => {
    const total = queues?.coverage.length ?? 0;
    if (evidenceCounts.missing > 0) {
      return `No source-backed items yet — work-sync evidence is missing for ${evidenceCounts.missing} of ${total} repositories.`;
    }
    if (evidenceCounts.stale > 0) {
      return `No source-backed items yet — the only synced evidence is stale (${evidenceCounts.stale} of ${total}).`;
    }
    return 'No source-backed items right now.';
  })();

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4 max-w-5xl">
        {/* Corpus summary */}
        <section aria-label="Corpus summary" className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground/90">Portfolio overview</h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={loadOverview}
              title="Re-read persisted counts (read-only)"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </Button>
            {loadError && (
              <span className="text-[10px] text-rose-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {loadError}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <div className="rounded-lg border border-border/20 bg-card/30 p-3">
              <div className="text-2xl font-bold text-foreground">{summary.corpus.total}</div>
              <div className="text-[10px] text-muted-foreground">Repositories in corpus</div>
            </div>
            <div className="rounded-lg border border-border/20 bg-card/30 p-3">
              <div className="text-2xl font-bold text-emerald-400">{summary.corpus.current}</div>
              <div className="text-[10px] text-muted-foreground">Verified current</div>
            </div>
            <div className="rounded-lg border border-border/20 bg-card/30 p-3">
              <div className="text-2xl font-bold text-amber-400">{summary.corpus.retainedUnverified}</div>
              <div className="text-[10px] text-muted-foreground">Retained, not re-verified</div>
            </div>
            <div className="rounded-lg border border-border/20 bg-card/30 p-3">
              <div className="text-2xl font-bold text-foreground/80">{summary.corpus.privateCount}</div>
              <div className="text-[10px] text-muted-foreground">Private</div>
            </div>
            <div className="rounded-lg border border-border/20 bg-card/30 p-3">
              <div className="text-2xl font-bold text-muted-foreground">{summary.corpus.archived}</div>
              <div className="text-[10px] text-muted-foreground">Archived</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {(() => {
              const inv = getSemanticStatus(semanticStatusKeyForInventory(summary.inventory.status));
              return (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${inv.className}`}>
                  <RefreshCw className="w-3 h-3" /> {inv.label}
                </span>
              );
            })()}
            <span>
              {summary.inventory.itemCount} repositories at last full inventory · last success{' '}
              {relativeTime(summary.inventory.lastSuccessAt)}
            </span>
            {summary.inventory.errorCode && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-400">
                <AlertTriangle className="w-3 h-3" /> last sync error: {summary.inventory.errorCode}
              </span>
            )}
          </div>
        </section>

        {/* Work queues */}
        <section aria-label="Work queues" className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground/90">Work queues</h2>
          {queues ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {QUEUE_META.map((queue) => {
                const queueName = queue.key as QueueName;
                const sourceEntries: QueueEntry[] = queues.queues[queueName] ?? [];
                // Narrowed by the shared search and selected status; the
                // unfiltered rows are kept only to distinguish a filtered
                // zero from genuinely missing evidence.
                const entries = narrowedQueues
                  ? narrowedQueues.queues[queueName]
                  : sourceEntries;
                return (
                  <div key={queue.key} className="rounded-lg border border-border/20 bg-card/30 p-3">
                    <button
                      onClick={() => setPortfolioStatusFilter(queue.key)}
                      className="w-full flex items-center gap-1.5 text-left"
                      title={`Filter repositories to ${queue.label}`}
                    >
                      {queue.icon}
                      <span className="text-xs font-medium text-foreground/90">{queue.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{entries.length}</span>
                    </button>
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">{queue.hint}</p>
                    <div className="mt-2 space-y-0.5">
                      {entries.length === 0 ? (
                        sourceEntries.length > 0 ? (
                          <p className="text-[10px] text-muted-foreground/40 py-1">
                            No items in this queue match the current search or status filter.
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/40 py-1">
                            {emptyQueueNote}
                          </p>
                        )
                      ) : (
                        entries.slice(0, 4).map((entry) => (
                          <QueueEntryRow
                            key={entry.resourceId}
                            entry={entry}
                            onSelectProject={selectProjectById}
                          />
                        ))
                      )}
                      {entries.length > 4 && (
                        <button
                          onClick={() => setPortfolioStatusFilter(queue.key)}
                          className="text-[10px] text-emerald-400/80 hover:text-emerald-300 pt-1"
                        >
                          Show all {entries.length} in list ↓
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Work queues are not available yet; corpus counts above still reflect the persisted
              database.
            </p>
          )}
          {queues && queues.uncertain.length > 0 && (() => {
            const narrowedUncertain = narrowedQueues
              ? narrowedQueues.uncertain
              : queues.uncertain;
            return (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-medium text-amber-300">
                  {narrowedUncertain.length} of {queues.uncertain.length} items kept uncertain
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                Mention-only blockers, missing timestamps and missing or unavailable scope evidence
                are never classified as confirmed work states.
              </p>
              {narrowedUncertain.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/60 mt-2">
                  No uncertain items match the current search or status filter.
                </p>
              ) : (
                <div className="mt-2 space-y-0.5">
                  {narrowedUncertain.slice(0, 3).map((entry) => (
                    <div key={entry.resourceId} className="text-[10px] text-muted-foreground/70 truncate">
                      <span className="text-foreground/70">{entry.projectFullName}</span> ·{' '}
                      {entry.reason.replace(/_/g, ' ')} — {entry.detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })()}
        </section>

        {/* Scope coverage / freshness */}
        <section aria-label="Coverage and freshness" className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground/90">Coverage and freshness</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {summary.workScopes.map((scope) => {
              return (
                <div
                  key={scope.sourceType}
                  className="rounded-lg border border-border/20 bg-card/30 p-3 space-y-1"
                  data-testid={`scope-${scope.sourceType}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground/90">{scope.sourceType}</span>
                    <SemanticBadge statusKey={scope.label} className="ml-auto" />
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{scope.retainedRowCount} retained rows</span>
                    {scope.currentCount > 0 && <span>{scope.currentCount} scopes current</span>}
                    {scope.staleCount > 0 && <span>{scope.staleCount} stale</span>}
                    {scope.failedCount > 0 && <span>{scope.failedCount} failed</span>}
                    {scope.unsupportedCount > 0 && <span>{scope.unsupportedCount} unsupported</span>}
                    {scope.unattemptedProjects > 0 && (
                      <span>{scope.unattemptedProjects} not attempted</span>
                    )}
                    {scope.lastSuccessAt && <span>last success {relativeTime(scope.lastSuccessAt)}</span>}
                  </div>
                  {Object.keys(scope.errorCodes).length > 0 && (
                    <div className="text-[10px] text-rose-400/80">
                      per-scope errors:{' '}
                      {Object.entries(scope.errorCodes)
                        .map(([code, count]) => `${code}×${count}`)
                        .join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Estate synthesis */}
        <section aria-label="Estate synthesis" className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground/90">Estate synthesis</h2>
          {estateStatus ? (
            <div className="rounded-lg border border-border/20 bg-card/30 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-foreground/90 font-medium">Latest synthesis</span>
                <SemanticBadge
                  statusKey={
                    estateStatus.status === 'none'
                      ? 'analysis_unknown'
                      : semanticStatusKeyForAnalysis(estateStatus.status)
                  }
                />
                {estateStatus.completedAt && (
                  <span className="text-[10px] text-muted-foreground">
                    {estateStatus.status === 'stale' ? 'stored' : 'completed'} {relativeTime(estateStatus.completedAt)}
                  </span>
                )}
                {estateStatus.errorCode && (
                  <span className="text-[10px] text-rose-400">error: {estateStatus.errorCode}</span>
                )}
              </div>
              {estateStatus.coverageCounts && (
                <div className="text-[10px] text-muted-foreground/70 flex flex-wrap gap-x-3">
                  <span>{estateStatus.coverageCounts.completed} analyzed</span>
                  <span>{estateStatus.coverageCounts.pending} pending</span>
                  <span>{estateStatus.coverageCounts.failed} failed</span>
                  <span>{estateStatus.coverageCounts.staleOnly} stale</span>
                  <span>{estateStatus.coverageCounts.unattempted} not attempted</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Estate synthesis status unavailable.</p>
          )}
        </section>

        {/* Search / filter + repository list */}
        <section aria-label="Repositories" className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground/90">Repositories</h2>
            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search repositories…"
                className="h-7 pl-7 pr-7 text-xs bg-card/30 border-border/20"
                data-testid="portfolio-search"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  aria-label="Clear search"
                >
                  <X className="w-3 h-3 text-muted-foreground/40 hover:text-foreground" />
                </button>
              )}
            </div>
            {(searchQuery || portfolioStatusFilter !== 'all') && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearFilters}>
                <X className="w-3 h-3" /> Clear filters
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.key}
                onClick={() =>
                  setPortfolioStatusFilter(
                    portfolioStatusFilter === filter.key ? 'all' : filter.key,
                  )
                }
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                  portfolioStatusFilter === filter.key
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-border/15 text-muted-foreground/60 hover:text-foreground/80 hover:border-border/30'
                }`}
                data-testid={`status-filter-${filter.key}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/50">
            Showing {filteredProjects.length} of {projects.length} repositories
            {portfolioStatusFilter !== 'all' && ` · filtered by ${portfolioStatusFilter}`}
            {searchQuery && ` · matching “${searchQuery}”`}
          </p>
          {filteredProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/30 p-6 text-center space-y-2">
              <p className="text-sm text-foreground/70">No repositories match the current filters.</p>
              <p className="text-[10px] text-muted-foreground/60">
                The corpus still holds {summary.corpus.total} repositories; clearing filters
                restores the full list.
              </p>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <X className="w-3 h-3" /> Clear filters
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-border/20 divide-y divide-border/10">
              {filteredProjects.slice(0, 60).map((project) => {
                const projectCoverage = coverageByProject.get(project.id);
                return (
                  <button
                    key={project.id}
                    onClick={() => selectProjectById(project.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-card/40 transition-colors text-left"
                    data-testid="portfolio-project-row"
                  >
                    <span className="text-xs text-foreground/90 truncate flex-1">
                      {project.fullName}
                      {project.isArchived && (
                        <Archive className="inline w-3 h-3 ml-1.5 text-muted-foreground" />
                      )}
                    </span>
                    {project.language && (
                      <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">
                        {project.language}
                      </span>
                    )}
                    {project.inventoryStatus !== 'current' && (
                      <SemanticBadge
                        statusKey={
                          project.inventoryStatus === 'unverified'
                            ? 'retained_unverified'
                            : semanticStatusKeyForInventory(project.inventoryStatus ?? 'unknown')
                        }
                        size="xs"
                      />
                    )}
                    {projectCoverage && projectCoverage.evidence !== 'current' && (
                      <SemanticBadge
                        statusKey={`evidence_${projectCoverage.evidence}` as SemanticStatusKey}
                        size="xs"
                      />
                    )}
                    {project.visibility === 'private' && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                        private
                      </Badge>
                    )}
                  </button>
                );
              })}
              {filteredProjects.length > 60 && (
                <div className="px-3 py-2 text-[10px] text-muted-foreground/50">
                  Showing the first 60 — refine search or filters to narrow further.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
