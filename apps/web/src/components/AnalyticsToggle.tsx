'use client';

import { useEffect, useState } from 'react';
import { analyticsOff, setAnalyticsOff } from '@/lib/analytics';

/** Analytics on or off for this browser. */
export function AnalyticsToggle() {
  const [off, setOff] = useState<boolean | null>(null);
  useEffect(() => setOff(analyticsOff()), []);
  if (off === null) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setAnalyticsOff(!off);
        setOff(!off);
      }}
      aria-pressed={!off}
      className={`press mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${off ? 'border-line bg-card hover:bg-soft' : 'border-good-line bg-good-soft text-good'}`}
    >
      Analytics: {off ? 'off' : 'on'} — tap to turn {off ? 'on' : 'off'}
    </button>
  );
}
