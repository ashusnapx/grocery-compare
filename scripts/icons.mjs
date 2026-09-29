// Renders apps/web/src/app/icon.svg into the PNG icons the PWA manifest and iOS need.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('apps/web/src/app/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (size, path, pad = 0, bg = 'transparent') => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
  await page.screenshot({ path, omitBackground: bg === 'transparent' });
};
await render(192, 'apps/web/public/icons/icon-192.png');
await render(512, 'apps/web/public/icons/icon-512.png');
// Maskable: the safe zone is the inner 80%, on the brand green (so any mask shape stays one colour).
await render(512, 'apps/web/public/icons/maskable-512.png', 56, '#15803d');
await render(180, 'apps/web/src/app/apple-icon.png', 14, '#15803d');
await browser.close();
console.log('icons written');
