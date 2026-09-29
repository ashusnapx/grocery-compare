// Dev tool: what a search engine sees on each public page.
//   node scripts/seo-check.mjs [base-url]
const BASE = process.argv[2] ?? 'http://localhost:3100';
const PAGES = ['/', '/fees', '/compare/blinkit-vs-zepto', '/compare/zepto-vs-instamart', '/privacy', '/callback', '/connect'];
let failed = false;
const bad = (m) => { console.log(`  ✘ ${m}`); failed = true; };
const meta = (html, attr, key) => html.match(new RegExp(`<meta[^>]+${attr}="${key}"[^>]+content="([^"]*)"`, 'i'))?.[1] ?? html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attr}="${key}"`, 'i'))?.[1] ?? null;
for (const path of PAGES) {
  const res = await fetch(BASE + path);
  const html = await res.text();
  const head = html.split('</head>')[0];
  const title = head.match(/<title>([^<]*)<\/title>/)?.[1];
  const desc = meta(head, 'name', 'description');
  const canonical = head.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/)?.[1] ?? null;
  const robots = meta(head, 'name', 'robots');
  const ogImage = meta(head, 'property', 'og:image');
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => { try { return JSON.parse(m[1]); } catch { return 'INVALID'; } });
  const types = ld.flatMap((d) => (d === 'INVALID' ? ['INVALID JSON'] : d['@graph'] ? d['@graph'].map((g) => g['@type']) : [d['@type']]));
  console.log(`${path}  [${res.status}]\n  title (${title?.length ?? 0}): ${title}\n  description (${desc?.length ?? 0}): ${desc?.slice(0, 110)}…\n  canonical: ${canonical} · robots: ${robots} · og:image: ${ogImage ? 'yes' : 'no'} · h1: ${h1} · JSON-LD: ${types.join(', ') || 'none'}`);
  const indexable = !['/callback', '/connect'].includes(path);
  if (res.status !== 200) bad('not 200');
  if (!title) bad('no title');
  if (indexable) {
    if (!desc || desc.length < 70 || desc.length > 320) bad('description missing or off-length');
    if (!canonical) bad('no canonical');
    if (h1 !== 1) bad(`expected exactly one <h1>, found ${h1}`);
    if (robots && /noindex/.test(robots)) bad('noindex on a public page');
    if (types.includes('INVALID JSON')) bad('invalid JSON-LD');
  } else if (!robots || !/noindex/.test(robots)) bad('utility page is indexable');
}
const nf = await fetch(`${BASE}/compare/foo-vs-bar`);
console.log(`/compare/foo-vs-bar → ${nf.status}`); if (nf.status !== 404) bad('unknown pair should 404');
const og = await fetch(`${BASE}/compare/blinkit-vs-zepto/opengraph-image`);
console.log(`pair share image → ${og.status} ${og.headers.get('content-type')} ${(await og.arrayBuffer()).byteLength} bytes`); if (og.status !== 200) bad('share image failed');
const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
console.log(`sitemap: ${(sm.match(/<loc>/g) ?? []).length} URLs`);
console.log(`robots.txt:\n${(await (await fetch(`${BASE}/robots.txt`)).text()).trim().replace(/^/gm, '  ')}`);
process.exit(failed ? 1 : 0);
