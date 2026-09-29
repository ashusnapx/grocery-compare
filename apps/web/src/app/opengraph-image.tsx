import { ImageResponse } from 'next/og';
import { SITE } from '@/lib/site';

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The card people see when a jhola link is shared on WhatsApp, X or Instagram. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '70px 80px',
          background: '#fafafa',
          color: '#18181b',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 44, fontWeight: 600 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="38" height="38" viewBox="14 14 36 36">
              <path d="M20 27h24l-2.5 21h-19z" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinejoin="round" />
              <path d="M25.5 27v-4a6.5 6.5 0 0 1 13 0v4" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
          {SITE.name}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 40, fontSize: 88, fontWeight: 600, letterSpacing: -3, lineHeight: 1.05 }}>
          Stop overpaying for aloo.
        </div>
        <div style={{ marginTop: 30, fontSize: 34, color: '#71717a', maxWidth: 900 }}>
          Your list → the cheapest split across Blinkit, Zepto, Instamart, JioMart, DMart &amp; BB Now. Every fee counted.
        </div>
        <div
          style={{
            position: 'absolute',
            right: 70,
            top: 70,
            background: '#f0fdf4',
            color: '#15803d',
            border: '2px solid #bbf7d0',
            borderRadius: 999,
            padding: '14px 26px',
            fontSize: 28,
            fontWeight: 600,
          }}
        >
          no login · no ads
        </div>
      </div>
    ),
    size,
  );
}
