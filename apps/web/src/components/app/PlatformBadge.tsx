import { PLATFORMS, type PlatformId } from '@gc/engine';

/** Text colour that stays readable on each brand colour. */
const INK: Record<PlatformId, string> = {
  blinkit: '#141414',
  zepto: '#ffffff',
  instamart: '#141414',
  jiomart: '#ffffff',
  dmart: '#ffffff',
  bigbasket: '#141414',
};

/** An app's name with its brand colour as a small dot. */
const SIZES = {
  sm: { text: 'text-xs font-medium', dot: 'size-1.5' },
  md: { text: 'text-sm font-medium', dot: 'size-2' },
  lg: { text: 'text-base font-semibold', dot: 'size-2.5' },
};

export function PlatformBadge({ id, className = '', size = 'md' }: { id: PlatformId; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const meta = PLATFORMS[id];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${SIZES[size].text} ${className}`}>
      <span className={`shrink-0 rounded-full ${SIZES[size].dot}`} style={{ background: meta.color }} aria-hidden />
      {meta.name}
    </span>
  );
}

export function platformInk(id: PlatformId): string {
  return INK[id];
}
