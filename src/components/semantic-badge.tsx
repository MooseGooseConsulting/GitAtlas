'use client';

import { getSemanticStatus, type SemanticStatusKey } from '@/lib/semantic-palette';
import { cn } from '@/lib/utils';

export function SemanticBadge({
  statusKey,
  size = 'sm',
  className,
}: {
  statusKey: SemanticStatusKey;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  const status = getSemanticStatus(statusKey);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-medium',
        size === 'xs' ? 'px-1 py-0 text-[9px]' : 'px-2 py-0.5 text-[10px]',
        status.className,
        className,
      )}
    >
      {status.label}
    </span>
  );
}
