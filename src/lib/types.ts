export interface Project {
  id: string;
  githubId: number;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  homepage: string | null;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  githubCreatedAt: string;
  githubUpdatedAt: string;
  pushedAt: string | null;
  topics: string[];
  isFork: boolean;
  isArchived: boolean;
  ownerLogin: string;
  ownerType: string;
  ownerAvatarUrl: string | null;
  defaultBranch: string;
  visibility: string;
  inventoryStatus?: string | null;
  summary: string | null;
  tags: string[];
  category: string | null;
  readmeContent: string | null;
  analyzedAt: string | null;

  // Deep analysis fields
  fileTree: FileTreeNode[] | null;
  dependencies: Record<string, string[]> | null;
  keyFiles: { path: string; content: string; purpose: string }[] | null;
  deepSummary: string | null;
  deepAnalyzedAt: string | null;
  proposedReadme: string | null;
  readmeGeneratedAt: string | null;
  similarProjects: { id: string; name: string; reason: string; score: number }[] | null;
  codeSignature: { frameworks: string[]; patterns: string[]; architecture: string } | null;
}

export interface FileTreeNode {
  path: string;
  type: 'file' | 'dir';
  children?: FileTreeNode[];
}

export interface AnalysisJob {
  id: string;
  username: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalRepos: number;
  processedRepos: number;
  createdAt: string;
  updatedAt: string;
}

export type ViewMode = 'graph' | 'grid' | 'timeline' | 'stats' | 'network' | 'radar' | 'bookmarks' | 'relationships' | 'health' | 'portfolio';

// Why here and not in portfolio-view.ts: the Zustand store (lib/store.ts)
// and cockpit-dashboard.tsx both consume this filter, while the
// portfolio-view/work-queues libs are implemented in parallel. Keeping the
// union in the shared types module avoids a store → missing-lib import edge;
// portfolio-view.ts may re-export it once it lands (single source of truth).
export type PortfolioStatusFilter =
  | 'all'
  | 'attention'
  | 'active'
  | 'recent'
  | 'blocked'
  | 'ready'
  | 'stale'
  | 'uncertain'
  | 'unverified'
  | 'archived'
  | 'private';

export type GraphLayout = 'force' | 'radial' | 'circular' | 'hierarchical' | 'grid' | 'spiral';

export type NodeSizeBy = 'stars' | 'activity' | 'dependencies' | 'files' | 'default';

export type ColorBy = 'category' | 'language' | 'health' | 'activity';

export const CATEGORY_COLORS: Record<string, string> = {
  tool: '#10b981',
  library: '#f59e0b',
  application: '#ef4444',
  template: '#8b5cf6',
  experiment: '#ec4899',
  config: '#6366f1',
  documentation: '#14b8a6',
  learning: '#f97316',
  archive: '#64748b',
};

export const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Shell: '#89e051',
  PowerShell: '#012456',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Go: '#00ADD8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  Ruby: '#701516',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
};
