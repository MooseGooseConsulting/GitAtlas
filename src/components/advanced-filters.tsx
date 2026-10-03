'use client';

import { Project, CATEGORY_COLORS, LANGUAGE_COLORS } from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Filter, X, Check } from 'lucide-react';
import { useMemo } from 'react';

// Exported types for use by cockpit-dashboard
export interface AdvancedFilterState {
  selectedLanguages: string[];
  selectedCategories: string[];
  selectedFrameworks: string[];
  activityRangeDays: [number, number];
  minStars: number;
  onlyAnalyzed: boolean;
  onlyNotArchived: boolean;
}

export const DEFAULT_FILTERS: AdvancedFilterState = {
  selectedLanguages: [],
  selectedCategories: [],
  selectedFrameworks: [],
  activityRangeDays: [0, 365],
  minStars: 0,
  onlyAnalyzed: false,
  onlyNotArchived: false,
};

export function applyAdvancedFilters(projects: Project[], filters: AdvancedFilterState, now = Date.now()): Project[] {
  return projects.filter(p => {
    if (filters.selectedLanguages.length > 0 && (!p.language || !filters.selectedLanguages.includes(p.language))) return false;
    if (filters.selectedCategories.length > 0 && (!p.category || !filters.selectedCategories.includes(p.category))) return false;
    if (filters.selectedFrameworks.length > 0 &&
      !filters.selectedFrameworks.some(framework => Boolean(p.codeSignature?.frameworks.includes(framework)))) return false;
    const [minAge, maxAge] = filters.activityRangeDays;
    if (minAge > 0 || maxAge < 365) {
      if (!p.pushedAt) return false;
      const pushedAt = new Date(p.pushedAt).getTime();
      if (!Number.isFinite(pushedAt)) return false;
      const ageDays = Math.max(0, (now - pushedAt) / (24 * 60 * 60 * 1000));
      if (ageDays < minAge || ageDays > maxAge) return false;
    }
    if (filters.minStars > 0 && p.stargazersCount < filters.minStars) return false;
    if (filters.onlyAnalyzed && !p.deepAnalyzedAt) return false;
    if (filters.onlyNotArchived && p.isArchived) return false;
    return true;
  });
}

export function countAdvancedFilters(filters: AdvancedFilterState): number {
  return Number(filters.selectedLanguages.length > 0) +
    Number(filters.selectedCategories.length > 0) +
    Number(filters.selectedFrameworks.length > 0) +
    Number(filters.activityRangeDays[0] > 0 || filters.activityRangeDays[1] < 365) +
    Number(filters.minStars > 0) +
    Number(filters.onlyAnalyzed) +
    Number(filters.onlyNotArchived);
}

export function removeAdvancedFilter(filters: AdvancedFilterState, key: 'selectedLanguages' | 'selectedCategories' | 'selectedFrameworks', value: string): AdvancedFilterState {
  return { ...filters, [key]: filters[key].filter(item => item !== value) };
}

export function clearActivityRange(filters: AdvancedFilterState): AdvancedFilterState {
  return { ...filters, activityRangeDays: DEFAULT_FILTERS.activityRangeDays };
}

interface AdvancedFiltersProps {
  projects: Project[];
  filters: AdvancedFilterState;
  onChange: (filters: AdvancedFilterState) => void;
}

export function AdvancedFilters({ projects, filters, onChange }: AdvancedFiltersProps) {
  const { selectedLanguages, selectedCategories, selectedFrameworks, activityRangeDays, minStars, onlyAnalyzed, onlyNotArchived } = filters;
  const update = (updates: Partial<AdvancedFilterState>) => onChange({ ...filters, ...updates });

  // Compute available languages and categories
  const languages = useMemo(() => {
    const map = new Map<string, number>();
    projects.forEach(p => { if (p.language) map.set(p.language, (map.get(p.language) || 0) + 1); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    projects.forEach(p => { if (p.category) map.set(p.category, (map.get(p.category) || 0) + 1); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects]);

  const frameworks = useMemo(() => {
    const map = new Map<string, number>();
    projects.forEach(p => {
      (p.codeSignature?.frameworks || []).forEach(fw => {
        map.set(fw, (map.get(fw) || 0) + 1);
      });
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [projects]);

  const activeFilterCount = countAdvancedFilters(filters);

  const toggleLanguage = (lang: string) => {
    update({ selectedLanguages: selectedLanguages.includes(lang) ? selectedLanguages.filter(l => l !== lang) : [...selectedLanguages, lang] });
  };

  const toggleCategory = (cat: string) => {
    update({ selectedCategories: selectedCategories.includes(cat) ? selectedCategories.filter(c => c !== cat) : [...selectedCategories, cat] });
  };

  const resetFilters = () => {
    onChange(DEFAULT_FILTERS);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-7 gap-1 text-xs transition-all ${
            activeFilterCount > 0
              ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5'
              : 'border-border/20 text-muted-foreground hover:text-foreground'
          }`}
          title="Advanced Filters — Filter by language, category, frameworks, and more"
        >
          <Filter className="w-3 h-3" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="outline" className="ml-0.5 text-[8px] px-1 py-0 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-card/95 backdrop-blur-xl border-border/30" align="end">
        <div className="p-3 border-b border-border/15">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-foreground/80">Advanced Filters</h3>
            {activeFilterCount > 0 && (
              <button
                onClick={resetFilters}
                className="text-[9px] text-muted-foreground/40 hover:text-foreground/60 flex items-center gap-0.5"
              >
                <X className="w-2.5 h-2.5" /> Reset All
              </button>
            )}
          </div>
        </div>

        <ScrollArea className="h-[400px]">
          <div className="p-3 space-y-4">

            {/* Language filter */}
            <div>
              <h4 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">Language</h4>
              <div className="space-y-0.5">
                {languages.map(([lang, count]) => (
                  <button
                    key={lang}
                    onClick={() => toggleLanguage(lang)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-all ${
                      selectedLanguages.includes(lang)
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'text-foreground/60 hover:bg-card/40'
                    }`}
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: LANGUAGE_COLORS[lang] || '#8b8b8b' }} />
                    <span className="flex-1 text-left">{lang}</span>
                    <span className="text-muted-foreground/30">{count}</span>
                    {selectedLanguages.includes(lang) && <Check className="w-2.5 h-2.5 text-emerald-400" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-border/20 to-transparent" />

            {/* Category filter */}
            <div>
              <h4 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">Category</h4>
              <div className="space-y-0.5">
                {categories.map(([cat, count]) => (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-all ${
                      selectedCategories.includes(cat)
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'text-foreground/60 hover:bg-card/40'
                    }`}
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat] || '#64748b' }} />
                    <span className="flex-1 text-left capitalize">{cat}</span>
                    <span className="text-muted-foreground/30">{count}</span>
                    {selectedCategories.includes(cat) && <Check className="w-2.5 h-2.5 text-emerald-400" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-border/20 to-transparent" />

            {/* Framework filter */}
            {frameworks.length > 0 && (
              <>
                <div>
                  <h4 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">Frameworks Detected</h4>
                  <div className="flex flex-wrap gap-1">
                    {frameworks.map(([fw, count]) => (
                      <button
                        key={fw}
                        onClick={() => {
                          // Add framework to search query
                          update({ selectedFrameworks: selectedFrameworks.includes(fw) ? selectedFrameworks.filter(item => item !== fw) : [...selectedFrameworks, fw] });
                        }}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border transition-all ${selectedFrameworks.includes(fw) ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-card/30 border-border/15 text-foreground/50 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/20'}`}
                      >
                        {fw}
                        <span className="text-muted-foreground/30">×{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-px bg-gradient-to-r from-transparent via-border/20 to-transparent" />
              </>
            )}

            {/* Activity age range */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Days Since Push</h4>
                <span className="text-[10px] text-emerald-400 font-mono">{activityRangeDays[0]}-{activityRangeDays[1]} days</span>
              </div>
              <Slider
                value={activityRangeDays}
                onValueChange={([min, max]) => update({ activityRangeDays: [min, max] })}
                min={0}
                max={365}
                step={1}
                className="w-full"
              />
            </div>

            {/* Stars filter */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Minimum Stars</h4>
                <span className="text-[10px] text-emerald-400 font-mono">{minStars}</span>
              </div>
              <Slider
                value={[minStars]}
                onValueChange={([v]) => update({ minStars: v })}
                min={0}
                max={50}
                step={1}
                className="w-full"
              />
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-border/20 to-transparent" />

            {/* Toggles */}
            <div className="space-y-2">
              <button
                onClick={() => update({ onlyAnalyzed: !onlyAnalyzed })}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] transition-all ${
                  onlyAnalyzed ? 'bg-emerald-500/10 text-emerald-400' : 'text-foreground/60 hover:bg-card/40'
                }`}
              >
                <div className={`w-3 h-3 rounded border ${onlyAnalyzed ? 'bg-emerald-500 border-emerald-500' : 'border-border/30'} flex items-center justify-center`}>
                  {onlyAnalyzed && <Check className="w-2 h-2 text-white" />}
                </div>
                Only Deep-Analyzed
              </button>

              <button
                onClick={() => update({ onlyNotArchived: !onlyNotArchived })}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] transition-all ${
                  onlyNotArchived ? 'bg-emerald-500/10 text-emerald-400' : 'text-foreground/60 hover:bg-card/40'
                }`}
              >
                <div className={`w-3 h-3 rounded border ${onlyNotArchived ? 'bg-emerald-500 border-emerald-500' : 'border-border/30'} flex items-center justify-center`}>
                  {onlyNotArchived && <Check className="w-2 h-2 text-white" />}
                </div>
                Exclude Archived
              </button>
            </div>

          </div>
        </ScrollArea>

        <div className="p-3 border-t border-border/15 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilters}
            className="flex-1 h-7 text-xs border-border/20"
          >
            Reset
          </Button>
          <span className="flex-1 text-center text-[10px] text-muted-foreground/50">Filters apply as you select them</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

