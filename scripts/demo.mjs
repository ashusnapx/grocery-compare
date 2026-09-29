// Dev tool: drive a full comparison in a real browser and screenshot the result.
//   node scripts/demo.mjs <out-prefix> [width] [height]
import { chromium } from 'playwright';

const [, , out = 'demo', w = '1280', h = '900'] = process.argv;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: +w, height: +h } });
await context.addInitScript(() => {
  localStorage.setItem('jhola:location', JSON.stringify({ lat: 12.9352, lng: 77.6245, pincode: '560034', approximate: false, label: 'Koramangala, Bengaluru' }));
  localStorage.removeItem('jhola:rows');
  if (new URLSearchParams(location.search).has('dark') || (globalThis.__DARK__)) localStorage.setItem('theme', 'dark');
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(process.env.DARK ? 'http://localhost:3100/?dark' : 'http://localhost:3100', { waitUntil: 'networkidle' });
await page.getByTestId('sample-list').click();
await page.getByTestId('compare').click();
const t0 = Date.now();
await page.locator('[data-testid="plan-status"][data-final="true"]').waitFor({ timeout: 120_000 });
console.log(`final plan after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-full.png`, fullPage: true });
await page.locator('section:has(h2:text("Your plan"))').screenshot({ path: `${out}-results.png` });
await page.getByRole('tab', { name: /all prices/i }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}-grid.png`, fullPage: true });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
