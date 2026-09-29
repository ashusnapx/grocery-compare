// Dev tool: use the app like a shopper and list every Google Analytics event it sends.
//   node scripts/ga-check.mjs            (counted as real traffic: shows in Realtime)
//   GA_DEBUG=1 node scripts/ga-check.mjs (debug mode: DebugView only, kept out of reports)
import { chromium } from 'playwright';

const BASE = 'http://localhost:3100';
const browser = await chromium.launch();
// Google drops "HeadlessChrome" as bot traffic; present as ordinary desktop Chrome so the visit counts.
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
});
await context.addInitScript(() => {
  localStorage.setItem('jhola:ga-test', '1'); // automated browsers aren't counted unless they ask
  localStorage.setItem('jhola:location', JSON.stringify({ lat: 17.4483, lng: 78.3915, pincode: '500081', approximate: false, label: 'Madhapur, Hyderabad' }));
  localStorage.setItem('jhola:location-source', JSON.stringify('manual'));
  localStorage.removeItem('jhola:rows');
});
const page = await context.newPage();
const hits = [];
page.on('request', (req) => {
  const url = req.url();
  if (!/google-analytics\.com\/g\/collect/.test(url)) return;
  // One request can carry several events: the query string holds the first, the body the rest.
  const lines = [new URL(url).search.slice(1), ...(req.postData() ?? '').split('\n')].filter(Boolean);
  for (const line of lines) {
    const q = new URLSearchParams(line);
    const tid = new URL(url).searchParams.get('tid');
    const en = q.get('en');
    if (!en) continue;
    const params = [...q.entries()].filter(([k]) => /^(ep|epn|up)\./.test(k)).map(([k, v]) => `${k.replace(/^(ep|epn|up)\./, '')}=${v}`);
    hits.push({ tid, en, params });
  }
});

await page.goto(process.env.GA_DEBUG ? `${BASE}/?ga_debug=1` : BASE, { waitUntil: 'networkidle' });
await page.getByTestId('sample-list').click();
const box = page.getByRole('textbox', { name: 'Add an item' });
await box.click();
await box.pressSequentially('amul butter', { delay: 50 });
await page.getByRole('listbox').getByRole('option').first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(1500);
await page.getByRole('listbox').getByRole('option').first().click();
await page.getByTestId('compare').click();
await page.locator('[data-testid="plan-status"][data-final="true"]').waitFor({ timeout: 90_000 });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Order on/ }).first().click();
await page.waitForTimeout(3000);
await page.keyboard.press('Escape');
await page.waitForTimeout(4000);

const ids = [...new Set(hits.map((h) => h.tid))];
console.log(`measurement IDs used: ${ids.join(', ') || 'none'}`);
for (const h of hits) console.log(`• ${h.en}${h.params.length ? `  {${h.params.join(', ')}}` : ''}`);
await browser.close();
process.exit(hits.length ? 0 : 1);
