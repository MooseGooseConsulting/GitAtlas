'use client';

import {
  clearActivityRange,
  removeAdvancedFilter,
  type AdvancedFilterState,
} from '@/components/advanced-filters';

interface CockpitActiveFiltersProps {
  filters: AdvancedFilterState;
  activeConceptGroups: string[];
  onFiltersChange: (filters: AdvancedFilterState) => void;
  onConceptGroupsChange: (groups: string[]) => void;
}

export function CockpitActiveFilters({
  filters,
  activeConceptGroups,
  onFiltersChange,
  onConceptGroupsChange,
}: CockpitActiveFiltersProps) {
  const hasActiveFilters =
    filters.selectedLanguages.length > 0 ||
    filters.selectedCategories.length > 0 ||
    filters.selectedFrameworks.length > 0 ||
    filters.activityRangeDays[0] > 0 ||
    filters.activityRangeDays[1] < 365 ||
    filters.minStars > 0 ||
    filters.onlyAnalyzed ||
    filters.onlyNotArchived ||
    activeConceptGroups.length > 0;

  if (!hasActiveFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 max-w-[32rem]" aria-label="Active filters">
      {filters.selectedLanguages.map(language => (
        <button
          key={language}
          onClick={() => onFiltersChange(removeAdvancedFilter(filters, 'selectedLanguages', language))}
          className="rounded-full border border-border/20 px-2 py-0.5 text-[9px] text-foreground/60 hover:text-foreground"
          aria-label={`Remove language filter ${language}`}
        >
          {language} ×
        </button>
      ))}
      {filters.selectedCategories.map(category => (
        <button
          key={category}
          onClick={() => onFiltersChange(removeAdvancedFilter(filters, 'selectedCategories', category))}
          className="rounded-full border border-border/20 px-2 py-0.5 text-[9px] text-foreground/60 hover:text-foreground capitalize"
          aria-label={`Remove category filter ${category}`}
        >
          {category} ×
        </button>
      ))}
      {filters.selectedFrameworks.map(framework => (
        <button
          key={framework}
          onClick={() => onFiltersChange(removeAdvancedFilter(filters, 'selectedFrameworks', framework))}
          className="rounded-full border border-border/20 px-2 py-0.5 text-[9px] text-foreground/60 hover:text-foreground"
          aria-label={`Remove framework filter ${framework}`}
        >
          {framework} ×
        </button>
      ))}
      {(filters.activityRangeDays[0] > 0 || filters.activityRangeDays[1] < 365) && (
        <button
          onClick={() => onFiltersChange(clearActivityRange(filters))}
          className="rounded-full border border-border/20 px-2 py-0.5 text-[9px] text-foreground/60"
          aria-label="Remove activity range filter"
        >
          {filters.activityRangeDays[0]}–{filters.activityRangeDays[1]} days ×
        </button>
      )}
      {filters.minStars > 0 && (
        <button
          onClick={() => onFiltersChange({ ...filters, minStars: 0 })}
          className="rounded-full border border-border/20 px-2 py-0.5 text-[9px] text-foreground/60"
          aria-label="Remove minimum stars filter"
        >
          {filters.minStars}+ stars ×
        </button>
      )}
      {filters.onlyAnalyzed && (
        <button
          onClick={() => onFiltersChange({ ...filters, onlyAnalyzed: false })}
          className="rounded-full border border-border/20 px-2 py-0.5 text-[9px] text-foreground/60"
          aria-label="Remove analyzed filter"
        >
          Analyzed ×
        </button>
      )}
      {filters.onlyNotArchived && (
        <button
          onClick={() => onFiltersChange({ ...filters, onlyNotArchived: false })}
          className="rounded-full border border-border/20 px-2 py-0.5 text-[9px] text-foreground/60"
          aria-label="Remove archived filter"
        >
          Not archived ×
        </button>
      )}
      {activeConceptGroups.map(group => (
        <button
          key={group}
          onClick={() => onConceptGroupsChange(activeConceptGroups.filter(value => value !== group))}
          className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[9px] text-emerald-400"
          aria-label={`Remove concept filter ${group}`}
        >
          {group} ×
        </button>
      ))}
    </div>
  );
}
