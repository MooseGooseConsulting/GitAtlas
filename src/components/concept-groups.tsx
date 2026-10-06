'use client';

import { useAtlasStore } from '@/lib/store';
import { Project, CATEGORY_COLORS } from '@/lib/types';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

export interface ConceptGroup {
  id: string;
  icon: string;
  label: string;
  description: string;
  keywords: string[];
  special?: 'phoenix' | 'firebird' | 'rising-star' | 'power-couple' | 'lone-wolf' | 'ecosystem'; // Special computed groups
}

const CONCEPT_GROUPS: ConceptGroup[] = [
  {
    id: 'ai',
    icon: '🧠',
    label: 'AI & Intelligence',
    description: 'LLM, AI, ML, and agent projects',
    keywords: ['ai', 'llm', 'openai', 'anthropic', 'langchain', 'mcp', 'ml', 'neural', 'gpt', 'chatbot', 'embedding', 'prompt'],
  },
  {
    id: 'devtools',
    icon: '🛠',
    label: 'Developer Tools',
    description: 'CLI tools, dev utilities, automation',
    keywords: ['cli', 'tool', 'automation', 'developer', 'utility', 'script', 'command', 'terminal', 'shell'],
  },
  {
    id: 'web',
    icon: '🌐',
    label: 'Web & Frontend',
    description: 'Web apps, frontend, UI frameworks',
    keywords: ['web', 'frontend', 'react', 'nextjs', 'next.js', 'ui', 'dashboard', 'component', 'tailwind', 'html', 'css'],
  },
  {
    id: 'data',
    icon: '📊',
    label: 'Data & Processing',
    description: 'Data pipelines, processing, storage',
    keywords: ['data', 'pipeline', 'etl', 'processing', 'database', 'storage', 'analytics', 'csv', 'json'],
  },
  {
    id: 'infra',
    icon: '🏗',
    label: 'Infrastructure',
    description: 'DevOps, config, deployment, infra',
    keywords: ['infra', 'config', 'deploy', 'docker', 'kubernetes', 'devops', 'ci', 'cd', 'terraform', 'ansible'],
  },
  {
    id: 'creative',
    icon: '🎨',
    label: 'Creative & Media',
    description: 'Image gen, creative tools, media processing',
    keywords: ['image', 'creative', 'media', 'art', 'video', 'audio', 'comfy', 'stable-diffusion', 'generation'],
  },
  {
    id: 'security',
    icon: '🔒',
    label: 'Security & Monitoring',
    description: 'Security tools, monitoring, alerting',
    keywords: ['security', 'monitor', 'alert', 'watch', 'guard', 'scan', 'audit', 'vulnerability'],
  },
  {
    id: 'memory',
    icon: '🧩',
    label: 'Memory & Ingestion',
    description: 'Data ingestion, memory systems, RAG',
    keywords: ['memory', 'ingestion', 'rag', 'embedding', 'vector', 'retrieval', 'knowledge', 'context'],
  },
  {
    id: 'phoenix',
    icon: '🦅',
    label: 'Phoenix Projects',
    description: 'Flagship projects — most starred or actively developed',
    keywords: [],
    special: 'phoenix',
  },
  {
    id: 'firebird',
    icon: '🔥🦅',
    label: 'Firebird Projects',
    description: 'Hot projects that rose from the ashes — archived then reactivated or recently updated after long dormancy',
    keywords: [],
    special: 'firebird',
  },
  {
    id: 'rising-star',
    icon: '⭐📈',
    label: 'Rising Stars',
    description: 'Gaining traction — recently created with active development',
    keywords: [],
    special: 'rising-star',
  },
  {
    id: 'power-couple',
    icon: '🤝💎',
    label: 'Power Couples',
    description: 'Projects that share the most dependencies with each other',
    keywords: [],
    special: 'power-couple',
  },
  {
    id: 'lone-wolf',
    icon: '🐺',
    label: 'Lone Wolves',
    description: 'Standalone projects with no shared dependencies or tags',
    keywords: [],
    special: 'lone-wolf',
  },
  {
    id: 'ecosystem',
    icon: '🌿🌐',
    label: 'Ecosystem Hubs',
    description: 'Projects that connect the most other projects together',
    keywords: [],
    special: 'ecosystem',
  },
];

function matchesConceptGroup(project: Project, group: ConceptGroup): boolean {
  if (group.special === 'phoenix') {
    // Phoenix = flagship projects: ≥5 stars or pushed in last 7 days with ≥1 star
    const hasStars = project.stargazersCount >= 5;
    const recentlyActive = project.pushedAt
      ? (Date.now() - new Date(project.pushedAt).getTime() < 7 * 24 * 60 * 60 * 1000) && project.stargazersCount >= 1
      : false;
    return hasStars || recentlyActive;
  }

  // Firebird: Was archived OR had no push for 6+ months, then got a push in the last 30 days
  if (group.special === 'firebird') {
    if (!project.pushedAt) return false;
    const daysSincePush = (Date.now() - new Date(project.pushedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recentlyPushed = daysSincePush < 30;
    const wasDormant = project.isArchived || (project.githubCreatedAt && (Date.now() - new Date(project.githubCreatedAt).getTime() > 180 * 24 * 60 * 60 * 1000));
    return recentlyPushed && wasDormant;
  }

  // Rising Star: Created in last 90 days with pushes in last 30 days
  if (group.special === 'rising-star') {
    if (!project.pushedAt || !project.githubCreatedAt) return false;
    const daysSinceCreation = (Date.now() - new Date(project.githubCreatedAt).getTime()) / (1000 * 60 * 60 * 24);
    const daysSincePush = (Date.now() - new Date(project.pushedAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceCreation < 90 && daysSincePush < 30;
  }

  // Power Couple: Heuristic — projects with many shared deps and high star count
  if (group.special === 'power-couple') {
    const runtimeDeps = project.dependencies?.runtime?.length || 0;
    const devDeps = project.dependencies?.dev?.length || 0;
    const hasManySharedDeps = (runtimeDeps + devDeps) >= 4;
    const hasPartners = project.similarProjects && project.similarProjects.length >= 2;
    return hasManySharedDeps || !!hasPartners;
  }

  // Lone Wolf: No shared tags/deps with other projects (few edges)
  if (group.special === 'lone-wolf') {
    // Use a simple heuristic: projects with 0 stars, no deep analysis deps, and generic tags
    const hasDeps = project.dependencies && ((project.dependencies.runtime?.length || 0) + (project.dependencies.dev?.length || 0)) > 0;
    const hasSpecificTags = project.tags.some(t => !['tool', 'library', 'application', 'experiment'].includes(t));
    return !hasDeps && !hasSpecificTags;
  }

  // Ecosystem Hub: Projects with many connections
  if (group.special === 'ecosystem') {
    return (project.dependencies?.runtime?.length || 0) >= 5 || project.stargazersCount >= 3;
  }

  const searchText = [
    project.name,
    project.description,
    project.summary,
    project.deepSummary,
    project.language,
    ...project.tags,
    ...project.topics,
    ...(project.codeSignature?.frameworks || []),
    ...(project.codeSignature?.patterns || []),
    project.codeSignature?.architecture || '',
    ...(project.dependencies?.runtime || []),
  ].filter(Boolean).join(' ').toLowerCase();

  return group.keywords.some(kw => searchText.includes(kw));
}

export function ConceptGroups() {
  const { projects, activeConceptGroups, toggleConceptGroup, setActiveConceptGroups } = useAtlasStore();

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of CONCEPT_GROUPS) {
      const count = projects.filter(p => matchesConceptGroup(p, group)).length;
      counts.set(group.id, count);
    }
    return counts;
  }, [projects]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1">
          <span>🧭</span> Concepts
          <span className="text-[9px] text-muted-foreground/30 normal-case">({CONCEPT_GROUPS.length})</span>
        </h3>
        {activeConceptGroups.length > 0 && (
          <button
            onClick={() => setActiveConceptGroups([])}
            className="text-[10px] text-muted-foreground/40 hover:text-foreground flex items-center gap-0.5"
          >
            <X className="w-2.5 h-2.5" /> Clear
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {CONCEPT_GROUPS.map(group => {
          const count = groupCounts.get(group.id) || 0;
          const isActive = activeConceptGroups.includes(group.id);

          return (
            <motion.button
              key={group.id}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => toggleConceptGroup(group.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[10px] transition-all ${
                isActive
                  ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.08)]'
                  : 'bg-card/20 border border-transparent text-foreground/60 hover:bg-card/40 hover:border-border/20'
              }`}
              title={group.description}
            >
              <span className="text-sm shrink-0">{group.icon}</span>
              <span className="flex-1 text-left truncate">{group.label}</span>
              <span className={`text-[9px] shrink-0 ${isActive ? 'text-emerald-400/70' : 'text-muted-foreground/30'}`}>
                {count}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// Export for use in filtering logic
export { CONCEPT_GROUPS, matchesConceptGroup };

export function getConceptGroupById(groupId: string): ConceptGroup | undefined {
  return CONCEPT_GROUPS.find(group => group.id === groupId);
}

// Utility for cockpit-dashboard to get projects matching one or more groups
export function getProjectsForGroup(projects: Project[], groupId: string): Project[] {
  const group = getConceptGroupById(groupId);
  if (!group) return [];
  return projects.filter(p => matchesConceptGroup(p, group));
}

// Concept selections combine with OR semantics; the caller intersects this
// set with search and advanced filters.
export function filterProjectsByConceptGroups(projects: Project[], groupIds: string[]): Project[] {
  if (groupIds.length === 0) return projects;
  const matchingIds = new Set<string>();
  for (const groupId of groupIds) {
    for (const project of getProjectsForGroup(projects, groupId)) {
      matchingIds.add(project.id);
    }
  }
  return projects.filter(project => matchingIds.has(project.id));
}
