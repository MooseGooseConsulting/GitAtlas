'use client';

import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

function currentIsDark(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.classList.contains('dark');
}

// Minimal light/dark toggle. The root layout defaults to `dark`; toggling
// the `dark` class on <html> switches the paired semantic-palette classes.
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(currentIsDark);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      className="h-7 gap-1 text-xs border-border/20 text-muted-foreground/50 hover:text-foreground/70 hover:border-border/40 transition-all px-2"
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
      <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>
    </Button>
  );
}
