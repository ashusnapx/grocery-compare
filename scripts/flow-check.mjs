// Dev tool: the fewest-taps flows, end to end in a real browser.
//   node scripts/flow-check.mjs <out-prefix>
// A. New visitor opens a shared list with location already allowed (Kolkata):
//    the place is found and prices load without a single tap.
// B. Returning visitor (list + place saved, Pune): prices load on arrival, no scroll jump.
// C. Pasting a list into the add box adds every item and compares at once.
import { chromium } from 'playwright';

const [, , out = 'flow'] = process.argv;
const BASE = 'http://localhost:3100';
const b64url = (s) => Buffer.from(s).toString('base64url');
const finalPlan = (page) => page.locator('[data-testid="plan-status"][data-final="true"]').waitFor({ timeout: 90_000 });
const statuses = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-platform-status]')].map((e) => `${e.getAttribute('data-platform')}:${e.getAttribute('data-platform-status')}`));

const browser = await chromium.launch();
let failed = false;
const check = (ok, label) => {
  console.log(`  ${ok ? '✔' : '✘'} ${label}`);
  if (!ok) failed = true;
};

// --- A -------------------------------------------------------------------------------------------
{
  console.log('A. shared list, new visitor in Kolkata (GPS allowed)');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 22.5867, longitude: 88.4171 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const list = [['milk', 1, 'L', 0], ['eggs', 12, 'pcs', 0], ['atta', 5, 'kg', 0]];
  const t0 = Date.now();
  await page.goto(`${BASE}/#l=${b64url(JSON.stringify(list))}`, { waitUntil: 'domcontentloaded' });
  await finalPlan(page);
  const place = await page.getByTestId('location').innerText();
  check(/\b7\d{5}\b/.test(place), `location found without asking: “${place.replace(/\s+/g, ' ')}”`);
  check(true, `final plan with zero taps after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const total = await page.locator('section:has(h2:text("Your plan"))').innerText();
  console.log(`  plan: ${total.replace(/\s+/g, ' ').match(/₹[\d,.]+/g)?.slice(0, 3).join(' · ') ?? '(no prices)'}`);
  await page.screenshot({ path: `${out}-A-kolkata.png`, fullPage: true });
  await context.close();
}

// --- B -------------------------------------------------------------------------------------------
{
  console.log('B. returning visitor in Pune');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('jhola:location', JSON.stringify({ lat: 18.5074, lng: 73.8077, pincode: '411038', approximate: false, label: 'Kothrud, Pune' }));
    localStorage.setItem('jhola:location-source', JSON.stringify('gps'));
    localStorage.setItem(
      'jhola:rows',
      JSON.stringify([
        { id: 'a', text: 'Amul butter', amount: 500, unit: 'g', anyBrand: false },
        { id: 'b', text: 'toor dal', amount: 1, unit: 'kg', anyBrand: false },
      ]),
    );
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await finalPlan(page);
  check(true, 'prices loaded on arrival');
  check((await page.evaluate(() => scrollY)) < 50, 'page did not jump to the results');
  await context.close();
}

// --- C -------------------------------------------------------------------------------------------
{
  console.log('C. paste a list into the add box (Hyderabad)');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('jhola:location', JSON.stringify({ lat: 17.4483, lng: 78.3915, pincode: '500081', approximate: false, label: 'Madhapur, Hyderabad' }));
    localStorage.removeItem('jhola:rows');
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const box = page.getByRole('textbox', { name: 'Add an item' });
  await box.click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'milk 2 L\nbread\neggs 12, tomato 1 kg');
    document.querySelector('input[aria-label="Add an item"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const rows = page.locator('[data-testid="list-rows"] > li');
  await page.waitForTimeout(500);
  check((await rows.count()) === 4, `pasted list became ${await rows.count()} rows`);
  await finalPlan(page);
  check(true, 'compared right after the paste');
  await context.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
