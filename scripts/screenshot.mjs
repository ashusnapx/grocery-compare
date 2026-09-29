// Dev tool: screenshot a page and report console errors.
//   node scripts/screenshot.mjs <url> <out.png> [width] [height] [fullPage 1|0]
import { chromium } from 'playwright';

const [, , url, out, w = '1280', h = '900', full = '1'] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: full === '1' });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
