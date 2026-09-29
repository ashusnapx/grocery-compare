'use client';

import { useState } from 'react';

const SIZES = {
  sm: { box: 'size-8', emoji: 'text-sm' },
  md: { box: 'size-9', emoji: 'text-base' },
  lg: { box: 'size-11', emoji: 'text-lg' },
};

/**
 * The product's own photo, from the app it's bought on. Without one (or when
 * it doesn't load) the item's emoji on a soft circle stands in.
 */
export function ProductThumb({
  src,
  emoji,
  size = 'lg',
  className = '',
}: {
  src: string | null | undefined;
  emoji: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // Remembers which photo failed, so a new photo for the same line gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const s = SIZES[size];
  if (!src || failed === src) {
    return (
      <span className={`grid ${s.box} shrink-0 place-items-center rounded-full bg-soft ${s.emoji} ${className}`} aria-hidden>
        {emoji}
      </span>
    );
  }
  return (
    <span className={`grid ${s.box} shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white ${className}`} aria-hidden>
      {/* Photos come from each app's own CDN (hosts vary per app), so a plain img rather than next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} className="size-full object-contain p-0.5" />
    </span>
  );
}
