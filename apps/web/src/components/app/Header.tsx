'use client';

import { MoonIcon, SunIcon, ToteSimpleIcon } from '@phosphor-icons/react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { SITE } from '@/lib/site';

export function Header() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';

  return (
    <header className="relative z-10 mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
      <a href="/" className="flex items-center gap-2" aria-label={`${SITE.name} home`}>
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent">
          <ToteSimpleIcon size={18} weight="bold" />
        </span>
        <span className="text-xl leading-none font-semibold tracking-tight">{SITE.name}</span>
        <span className="hidden rounded-full border border-line px-2 py-0.5 text-[0.7rem] font-medium text-muted sm:inline-block">beta</span>
      </a>
      <button
        type="button"
        onClick={() => setTheme(dark ? 'light' : 'dark')}
        className="btn-ghost size-9"
        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {mounted ? dark ? <SunIcon size={18} /> : <MoonIcon size={18} /> : <span className="size-[18px]" />}
      </button>
    </header>
  );
}
