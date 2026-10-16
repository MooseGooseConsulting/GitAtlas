import { create } from 'zustand';
import { Project, AnalysisJob, ViewMode, GraphLayout, NodeSizeBy, ColorBy, PortfolioStatusFilter } from './types';

interface AtlasState {
  username: string;
  projects: Project[];
  analysisJob: AnalysisJob | null;
  isLoading: boolean;
  isAnalyzing: boolean;
  fetchProgress: string;
  analyzeProgress: string;
  viewMode: ViewMode;
  selectedProject: Project | null;
  searchQuery: string;
  activeTags: string[];
  detailOpen: boolean;
  isDataLoaded: boolean;
  isDeepAnalyzing: boolean;
  deepAnalyzeProgress: string;

  // Graph settings
  graphLayout: GraphLayout;
  nodeSizeBy: NodeSizeBy;
  colorBy: ColorBy;
  edgeThreshold: number;
  showParticles: boolean;
  showClusterBackgrounds: boolean;
  showHealthRings: boolean;
  showDependencyEdges: boolean;
  animationSpeed: number;
  showEdgeLabels: boolean;

  // Why: previously the Verlet physics constants were hardcoded inside
  // project-graph.tsx. Exposing them as store state lets the new
  // GraphTweaksPanel adjust the simulation live without re-mounting the SVG,
  // and keeps the defaults co-located with everything else the panel touches.
  repulsion: number;        // node-node repulsion strength
  linkStrength: number;     // spring stiffness for tag/category edges
  linkDistance: number;     // ideal distance for tag/category edges (px)
  depLinkDistance: number;  // ideal distance for dependency edges (px)
  damping: number;          // 0..1, velocity multiplier per tick
  centering: number;        // pull toward viewport center
  nodeSizeBase: number;     // smallest node radius in px
  nodeSizeScale: number;    // multiplier on top of nodeSizeBy metric
  minSharedDeps: number;    // dependency overlap required to draw an edge

  // Why: a single boolean toggle per *kind* of connection. The graph
  // currently fuses tag/topic/language/dependency edges into one stream;
  // splitting them lets the user reason about each signal in isolation
  // (e.g. "show me only dependency edges") without losing the others.
  connectionSources: {
    tag: boolean;        // shared tag/topic/language
    dependency: boolean; // shared package dependencies
    framework: boolean;  // shared frameworks (from codeSignature)
    category: boolean;   // same category bucket
    owner: boolean;      // same ownerLogin
  };

  // Why: separate panel from the existing Settings dialog so power-users can
  // tweak physics without losing the graph view to a modal.
  showGraphTweaksPanel: boolean;

  // Concept group filters
  activeConceptGroups: string[];

  // Why in the shared store: both the cockpit search input and the
  // portfolio-overview panel (implemented in parallel) read/write the same
  // filter so work-queue cards and the repository list narrow together
  // (VAL-UI-006). Additive slice — no existing state touched.
  portfolioStatusFilter: PortfolioStatusFilter;

  // Setters
  setUsername: (u: string) => void;
  setProjects: (p: Project[]) => void;
  setAnalysisJob: (j: AnalysisJob | null) => void;
  setLoading: (l: boolean) => void;
  setAnalyzing: (a: boolean) => void;
  setFetchProgress: (p: string) => void;
  setAnalyzeProgress: (p: string) => void;
  setViewMode: (v: ViewMode) => void;
  setSelectedProject: (p: Project | null) => void;
  setSearchQuery: (q: string) => void;
  toggleTag: (t: string) => void;
  setActiveTags: (t: string[]) => void;
  setDetailOpen: (o: boolean) => void;
  setDataLoaded: (l: boolean) => void;
  setDeepAnalyzing: (v: boolean) => void;
  setDeepAnalyzeProgress: (v: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;

  // Graph settings setters
  setGraphLayout: (v: GraphLayout) => void;
  setNodeSizeBy: (v: NodeSizeBy) => void;
  setColorBy: (v: ColorBy) => void;
  setEdgeThreshold: (v: number) => void;
  setShowParticles: (v: boolean) => void;
  setShowClusterBackgrounds: (v: boolean) => void;
  setShowHealthRings: (v: boolean) => void;
  setShowDependencyEdges: (v: boolean) => void;
  setAnimationSpeed: (v: number) => void;
  setShowEdgeLabels: (v: boolean) => void;

  // Graph physics / connection setters (see field docs above for why each exists)
  setRepulsion: (v: number) => void;
  setLinkStrength: (v: number) => void;
  setLinkDistance: (v: number) => void;
  setDepLinkDistance: (v: number) => void;
  setDamping: (v: number) => void;
  setCentering: (v: number) => void;
  setNodeSizeBase: (v: number) => void;
  setNodeSizeScale: (v: number) => void;
  setMinSharedDeps: (v: number) => void;
  setConnectionSource: (k: keyof AtlasState['connectionSources'], v: boolean) => void;
  setShowGraphTweaksPanel: (v: boolean) => void;
  resetGraphTweaks: () => void;

  // Concept group setters
  toggleConceptGroup: (g: string) => void;
  setActiveConceptGroups: (g: string[]) => void;

  // Portfolio filter setter (see field doc above)
  setPortfolioStatusFilter: (f: PortfolioStatusFilter) => void;
}

export const useAtlasStore = create<AtlasState>((set) => ({
  username: 'Coldaine',
  projects: [],
  analysisJob: null,
  isLoading: true,
  isAnalyzing: false,
  fetchProgress: '',
  analyzeProgress: '',
  viewMode: 'graph',
  selectedProject: null,
  searchQuery: '',
  activeTags: [],
  detailOpen: false,
  isDataLoaded: false,
  isDeepAnalyzing: false,
  deepAnalyzeProgress: '',

  // Graph settings defaults
  graphLayout: 'force',
  nodeSizeBy: 'default',
  colorBy: 'category',
  edgeThreshold: 2,
  showParticles: true,
  showClusterBackgrounds: true,
  showHealthRings: true,
  showDependencyEdges: true,
  animationSpeed: 1,
  showEdgeLabels: true,

  // Why these defaults: they match the constants that were previously
  // hardcoded inside project-graph.tsx, so flipping the panel on is a no-op
  // visually until the user actually drags something.
  repulsion: 3500,
  linkStrength: 0.004,
  linkDistance: 130,
  depLinkDistance: 100,
  damping: 0.92,
  centering: 0.008,
  nodeSizeBase: 10,
  nodeSizeScale: 1,
  minSharedDeps: 3,
  connectionSources: {
    tag: true,         // current behavior: tag edges on
    dependency: true,  // current behavior: dependency edges on
    framework: false,  // new signal, off by default to keep parity
    category: false,   // new signal, off by default
    owner: false,      // new signal, off by default
  },
  showGraphTweaksPanel: false,

  // Concept group defaults
  activeConceptGroups: [],

  portfolioStatusFilter: 'all',

  setUsername: (u) => set({ username: u }),
  setProjects: (p) => set({ projects: p }),
  setAnalysisJob: (j) => set({ analysisJob: j }),
  setLoading: (l) => set({ isLoading: l }),
  setAnalyzing: (a) => set({ isAnalyzing: a }),
  setFetchProgress: (p) => set({ fetchProgress: p }),
  setAnalyzeProgress: (p) => set({ analyzeProgress: p }),
  setViewMode: (v) => set({ viewMode: v }),
  setSelectedProject: (p) => set({ selectedProject: p, detailOpen: !!p }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  toggleTag: (t) =>
    set((state) => ({
      activeTags: state.activeTags.includes(t)
        ? state.activeTags.filter((x) => x !== t)
        : [...state.activeTags, t],
    })),
  setActiveTags: (t) => set({ activeTags: t }),
  setDetailOpen: (o) => set({ detailOpen: o }),
  setDataLoaded: (l) => set({ isDataLoaded: l }),
  setDeepAnalyzing: (v) => set({ isDeepAnalyzing: v }),
  setDeepAnalyzeProgress: (v) => set({ deepAnalyzeProgress: v }),
  updateProject: (id, updates) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      selectedProject:
        state.selectedProject?.id === id
          ? { ...state.selectedProject, ...updates }
          : state.selectedProject,
    })),

  // Graph settings setters
  setGraphLayout: (v) => set({ graphLayout: v }),
  setNodeSizeBy: (v) => set({ nodeSizeBy: v }),
  setColorBy: (v) => set({ colorBy: v }),
  setEdgeThreshold: (v) => set({ edgeThreshold: v }),
  setShowParticles: (v) => set({ showParticles: v }),
  setShowClusterBackgrounds: (v) => set({ showClusterBackgrounds: v }),
  setShowHealthRings: (v) => set({ showHealthRings: v }),
  setShowDependencyEdges: (v) => set({ showDependencyEdges: v }),
  setAnimationSpeed: (v) => set({ animationSpeed: v }),
  setShowEdgeLabels: (v) => set({ showEdgeLabels: v }),

  // Why immutable spread for connectionSources: zustand subscribers only
  // re-render when the reference changes, so we must replace the object.
  setRepulsion: (v) => set({ repulsion: v }),
  setLinkStrength: (v) => set({ linkStrength: v }),
  setLinkDistance: (v) => set({ linkDistance: v }),
  setDepLinkDistance: (v) => set({ depLinkDistance: v }),
  setDamping: (v) => set({ damping: v }),
  setCentering: (v) => set({ centering: v }),
  setNodeSizeBase: (v) => set({ nodeSizeBase: v }),
  setNodeSizeScale: (v) => set({ nodeSizeScale: v }),
  setMinSharedDeps: (v) => set({ minSharedDeps: v }),
  setConnectionSource: (k, v) =>
    set((state) => ({ connectionSources: { ...state.connectionSources, [k]: v } })),
  setShowGraphTweaksPanel: (v) => set({ showGraphTweaksPanel: v }),
  // Why a single reset: easier UX than 10 individual reset buttons; the
  // defaults are pinned to the previously-hardcoded constants so this also
  // doubles as a "restore original look" affordance.
  resetGraphTweaks: () =>
    set({
      repulsion: 3500,
      linkStrength: 0.004,
      linkDistance: 130,
      depLinkDistance: 100,
      damping: 0.92,
      centering: 0.008,
      nodeSizeBase: 10,
      nodeSizeScale: 1,
      minSharedDeps: 3,
      edgeThreshold: 2,
      animationSpeed: 1,
      connectionSources: {
        tag: true,
        dependency: true,
        framework: false,
        category: false,
        owner: false,
      },
    }),

  // Concept group setters
  toggleConceptGroup: (g) =>
    set((state) => ({
      activeConceptGroups: state.activeConceptGroups.includes(g)
        ? state.activeConceptGroups.filter((x) => x !== g)
        : [...state.activeConceptGroups, g],
    })),
  setActiveConceptGroups: (g) => set({ activeConceptGroups: g }),
  setPortfolioStatusFilter: (f) => set({ portfolioStatusFilter: f }),
}));
