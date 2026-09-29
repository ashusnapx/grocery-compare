import { ImageResponse } from 'next/og';
import { PLATFORMS } from '@gc/engine';
import { APPS } from '@/lib/seo';
import { SITE } from '@/lib/site';

export const alt = 'Grocery delivery fees in India, app by app';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The share card for the fee table. */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '70px 80px', background: '#fafafa', color: '#18181b' }}>
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 600, color: '#15803d' }}>{SITE.name}</div>
        <div style={{ display: 'flex', marginTop: 40, fontSize: 84, fontWeight: 600, letterSpacing: -3, lineHeight: 1.05 }}>Grocery delivery fees, app by app</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 44 }}>
          {APPS.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '2px solid #e4e4e7', borderRadius: 999, padding: '10px 22px', fontSize: 30, background: '#ffffff' }}>
              <div style={{ width: 20, height: 20, borderRadius: 999, background: PLATFORMS[a.id].color }} />
              {a.short}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
