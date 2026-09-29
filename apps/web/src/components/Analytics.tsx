'use client';

import Script from 'next/script';
import { useReportWebVitals } from 'next/web-vitals';
import { useEffect } from 'react';
import { isSignedIn } from '@/lib/account/oauth';
import { GA_ID, OPT_OUT_KEY, setUserProperties, TEST_KEY, track } from '@/lib/analytics';

// One report per metric per page (React may register the reporter twice in development).
const reported = new Set<string>();

/**
 * The Google tag, plus what is worth knowing about every visit: how fast the
 * page felt (Core Web Vitals) and a few non-identifying user properties.
 */
export function Analytics() {
  useReportWebVitals((metric) => {
    if (reported.has(metric.name)) return;
    reported.add(metric.name);
    track('web_vitals', {
      metric_name: metric.name,
      metric_value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
      metric_rating: metric.rating,
      metric_id: metric.id,
      non_interaction: true,
    });
  });

  useEffect(() => {
    const describe = () => {
      const accounts = (['zepto', 'instamart'] as const).filter(isSignedIn);
      setUserProperties({
        accounts_connected: accounts.length ? accounts.join('+') : 'none',
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        installed_app: window.matchMedia('(display-mode: standalone)').matches,
      });
    };
    // The tag loads after hydration; describe the visit once it is there, and again when logins change.
    const timer = window.setInterval(() => {
      if (!window.gtag) return;
      window.clearInterval(timer);
      describe();
    }, 500);
    window.addEventListener('jhola:accounts', describe);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('jhola:accounts', describe);
    };
  }, []);

  if (!GA_ID) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
var off = false, debug = false;
try {
  off = localStorage.getItem('${OPT_OUT_KEY}') === '1' || (navigator.webdriver === true && localStorage.getItem('${TEST_KEY}') !== '1');
  debug = /[?&]ga_debug=1/.test(location.search) || localStorage.getItem('jhola:ga-debug') === '1';
} catch (e) { off = navigator.webdriver === true; }
if (off) window['ga-disable-${GA_ID}'] = true;
var config = { allow_google_signals: false, allow_ad_personalization_signals: false };
if (debug) config.debug_mode = true;
gtag('js', new Date());
gtag('config', '${GA_ID}', config);`}
      </Script>
    </>
  );
}
