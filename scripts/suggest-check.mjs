// Dev tool: type into the add box on a phone and a desktop viewport, check the
// live product list stays on screen, pick a product, and screenshot each step.
//   node scripts/suggest-check.mjs <out-prefix> [query]
import { chromium, devices } from 'playwright';

const [, , out = 'suggest', query = 'amul butter'] = process.argv;
const MUMBAI = { lat: 19.1364, lng: 72.8296, pincode: '400053', approximate: false, label: 'Andheri West, Mumbai' };
const SAMPLE = ['Toor dal 1 kg', 'Milk 2 L', 'Eggs 12', 'Tata salt 1 kg', 'Maggi 4 pack'].map((text, i) => ({
  id: `seed-${i}`,
  text: text.replace(/ \d.*$/, ''),
  amount: Number(text.match(/(\d+)/)?.[1] ?? 1),
  unit: text.includes(' kg') ? 'kg' : text.includes(' L') ? 'L' : text.includes('pack') ? 'pack' : 'pcs',
  anyBrand: false,
}));

const browser = await chromium.launch();
let failed = false;
for (const [name, options] of [
  ['phone', { ...devices['iPhone 13'] }],
  ['desktop', { viewport: { width: 1280, height: 800 } }],
]) {
  const context = await browser.newContext(options);
  await context.addInitScript(
    ([loc, rows]) => {
      localStorage.setItem('jhola:location', JSON.stringify(loc));
      localStorage.setItem('jhola:rows', JSON.stringify(rows));
    },
    [MUMBAI, SAMPLE],
  );
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('http://localhost:3100', { waitUntil: 'networkidle' });

  const box = page.getByRole('textbox', { name: 'Add an item' });
  await box.scrollIntoViewIfNeeded();
  await box.click();
  await box.pressSequentially(query, { delay: 60 });
  const list = page.getByRole('listbox');
  await list.getByRole('option').first().waitFor({ timeout: 20_000 });
  await page.getByText('Real products near you').waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('[role=listbox] img').length > 0, null, { timeout: 20_000 });
  await page.waitForTimeout(900); // smooth scroll settles

  const fit = await page.evaluate(() => {
    const lb = document.querySelector('[role=listbox]').getBoundingClientRect();
    const vv = window.visualViewport;
    return { top: Math.round(lb.top), bottom: Math.round(lb.bottom), viewport: Math.round(vv ? vv.offsetTop + vv.height : innerHeight) };
  });
  const onScreen = fit.top >= 0 && fit.bottom <= fit.viewport;
  if (!onScreen) failed = true;
  const options_ = await list.getByRole('option').allInnerTexts();
  console.log(`${name}: list ${fit.top}–${fit.bottom}px of ${fit.viewport}px → ${onScreen ? 'on screen ✔' : 'OFF SCREEN ✘'}`);
  console.log(`  first options: ${options_.slice(0, 3).map((t) => t.replace(/\s+/g, ' ').slice(0, 70)).join(' | ')}`);
  await page.screenshot({ path: `${out}-${name}-open.png` });

  await list.getByRole('option').first().click();
  await page.waitForTimeout(700);
  const listRows = page.locator('[data-testid="list-rows"] > li');
  const added = await listRows.last().evaluate((li) => ({
    text: li.querySelector('input[aria-label="Item"]')?.value,
    img: !!li.querySelector('img'),
    amount: li.querySelector('input[aria-label="Quantity"]')?.value,
    unit: li.querySelector('select')?.value,
  }));
  console.log(`  picked → row "${added.text}" ${added.amount} ${added.unit} ${added.img ? 'with photo ✔' : 'no photo ✘'}`);
  if (!added.img) failed = true;
  await listRows.last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}-${name}-picked.png` });
  console.log(errors.length ? `  console errors:\n  ${errors.join('\n  ')}` : '  no console errors');
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
