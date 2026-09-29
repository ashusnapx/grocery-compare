import { ImageResponse } from 'next/og';
import { PLATFORMS } from '@gc/engine';
import { PAIRS, pairBySlug } from '@/lib/seo';
import { SITE } from '@/lib/site';

export const alt = 'Grocery app fees compared';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return PAIRS.map((p) => ({ pair: p.slug }));
}

/** The share card for one head-to-head page: "Blinkit vs Zepto". */
export default async function Image({ params }: { params: Promise<{ pair: string }> }) {
  const pair = pairBySlug((await params).pair);
  const a = pair?.a ?? { id: 'blinkit' as const, short: 'Blinkit' };
  const b = pair?.b ?? { id: 'zepto' as const, short: 'Zepto' };
  const dot = (color: string) => <div style={{ width: 34, height: 34, borderRadius: 999, background: color, marginRight: 18 }} />;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '70px 80px', background: '#fafafa', color: '#18181b' }}>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 600, color: '#15803d' }}>{SITE.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 44, fontSize: 96, fontWeight: 600, letterSpacing: -3 }}>
          {dot(PLATFORMS[a.id].color)}
          {a.short}
          <span style={{ margin: '0 28px', color: '#71717a' }}>vs</span>
          {dot(PLATFORMS[b.id].color)}
          {b.short}
        </div>
        <div style={{ marginTop: 34, fontSize: 38, color: '#52525b' }}>Delivery fees, free delivery & which is cheaper for your list</div>
      </div>
    ),
    size,
  );
}
