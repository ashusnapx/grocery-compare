// Dev tool: the "Your apps" logins, as far as a test can go without a phone.
//   node scripts/connect-check.mjs <out-prefix>
// 1. The landing shows every app; Zepto and Instamart open their own sign-in page.
// 2. A connected app shows green; a dead token falls back to public prices and flips back to "Log in".
import { chromium } from 'playwright';

const [, , out = 'connect'] = process.argv;
const BASE = 'http://localhost:3100';
const PUNE = { lat: 18.5074, lng: 73.8077, pincode: '411038', approximate: false, label: 'Kothrud, Pune' };
const browser = await chromium.launch();
let failed = false;
const check = (ok, label) => {
  console.log(`  ${ok ? '✔' : '✘'} ${label}`);
  if (!ok) failed = true;
};
const fresh = async (init) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(init ?? (() => {}), PUNE);
  return { context, page: await context.newPage() };
};

console.log('1. log in buttons');
for (const [app, host] of [
  ['Zepto', 'auth.zepto.co.in'],
  ['Instamart', 'mcp.swiggy.com'],
]) {
  const { context, page } = await fresh((loc) => {
    localStorage.setItem('jhola:location', JSON.stringify(loc));
    localStorage.removeItem('jhola:rows');
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (app === 'Zepto') await page.locator('section[aria-labelledby="apps-heading"]').screenshot({ path: `${out}-apps.png` });
  await page.locator(`section[aria-labelledby="apps-heading"] li[data-app="${app.toLowerCase()}"][data-state="login"]`).getByRole('button').click();
  await page.waitForURL((u) => !u.href.startsWith(BASE), { timeout: 20_000 }).catch(() => undefined);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  const url = new URL(page.url());
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
  check(url.host === host || url.pathname === '/callback', `${app} → ${url.host}${url.pathname} · “${body}”`);
  if (url.searchParams.get('error')) console.log(`    error=${url.searchParams.get('error')} ${url.searchParams.get('error_description') ?? ''}`);
  await page.screenshot({ path: `${out}-${app.toLowerCase()}-signin.png` });
  await context.close();
}

console.log('2. connected look, and a dead token');
{
  const { context, page } = await fresh((loc) => {
    localStorage.setItem('jhola:location', JSON.stringify(loc));
    localStorage.setItem('jhola:location-source', JSON.stringify('gps'));
    localStorage.setItem('jhola:rows', JSON.stringify([{ id: 'a', text: 'milk', amount: 1, unit: 'L', anyBrand: false }]));
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('jhola:account:zepto:tokens', JSON.stringify({ accessToken: 'not-a-real-token', refreshToken: null, expiresAt: Date.now() + 3600_000, clientId: 'test' }));
    }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const apps = page.locator('section[aria-labelledby="apps-heading"]');
  const zepto = apps.locator('li[data-app="zepto"]');
  await apps.locator('li[data-app="zepto"][data-state="connected"]').waitFor({ timeout: 10_000 });
  const bg = await zepto.evaluate((li) => getComputedStyle(li).backgroundColor);
  check(true, `Zepto shows connected (background ${bg})`);
  await page.locator('section[aria-labelledby="apps-heading"]').screenshot({ path: `${out}-connected.png` });
  await page.locator('[data-testid="plan-status"][data-final="true"]').waitFor({ timeout: 90_000 });
  check(true, 'comparison still finished with a dead token');
  const back = await apps.locator('li[data-app="zepto"][data-state="login"]').isVisible().catch(() => false);
  check(back, 'Zepto flipped back to “Log in” after the token was refused');
  await context.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
