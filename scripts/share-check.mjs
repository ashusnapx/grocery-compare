// Dev tool: open a shared-list link and confirm the list loads from the URL fragment.
//   node scripts/share-check.mjs <out.png>
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const rows = [
  ['toor dal', 1, 'kg', 0],
  ['amul butter', 500, 'g', 1],
  ['pyaz', 2, 'kg', 0],
];
const fragment = Buffer.from(JSON.stringify(rows)).toString('base64url');
await page.goto(`http://localhost:3100/#l=${fragment}`, { waitUntil: 'networkidle' });
await page.getByText(/Loaded a shared list/).waitFor({ timeout: 10_000 });
const items = await page.locator('input[aria-label="Item"]').evaluateAll((els) => els.map((e) => e.value));
console.log('loaded rows:', items, '| url after load:', page.url());
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await browser.close();
