// Sets up Google Analytics 4 for jhola through the Admin API. Safe to re-run: it
// finds what already exists and only adds what's missing.
//
//   GA_TOKEN=<analytics.edit token> [GA_PROPERTY=<id>] node scripts/ga-setup.mjs [site-url] [account-id]
//
// With GA_PROPERTY (e.g. the one Firebase created when linking Analytics), that
// property is set up in place: renamed "jhola", India time, rupees, shopping.
//
// Prints the measurement ID (G-…) at the end.
const TOKEN = process.env.GA_TOKEN;
const PROJECT = process.env.GA_PROJECT;
const [, , siteUrl = 'https://jhola.app', accountArg] = process.argv;
if (!TOKEN) {
  console.error('GA_TOKEN is required (an access token with the analytics.edit scope).');
  process.exit(2);
}

const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta';
const ALPHA = 'https://analyticsadmin.googleapis.com/v1alpha';

async function api(method, url, body, attempt = 1) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(PROJECT ? { 'x-goog-user-project': PROJECT } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    if (attempt < 4) return new Promise((r) => setTimeout(r, attempt * 2000)).then(() => api(method, url, body, attempt + 1));
    throw e;
  }
  // Google's own hiccups (5xx, rate limits) are retried with a growing pause.
  if ((res.status >= 500 || res.status === 429) && attempt < 4) {
    await new Promise((r) => setTimeout(r, attempt * 3000));
    return api(method, url, body, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url.replace(/^https:\/\/[^/]+/, '')} → ${res.status} ${json.error?.message ?? ''}`);
  return json;
}

async function all(url, key) {
  const out = [];
  let page = '';
  do {
    const json = await api('GET', `${url}${url.includes('?') ? '&' : '?'}pageSize=200${page ? `&pageToken=${page}` : ''}`);
    out.push(...(json[key] ?? []));
    page = json.nextPageToken ?? '';
  } while (page);
  return out;
}

// --- account + property ---------------------------------------------------------
let P;
if (process.env.GA_PROPERTY) {
  P = `properties/${process.env.GA_PROPERTY}`;
  await api('PATCH', `${ADMIN}/${P}?updateMask=displayName,timeZone,currencyCode,industryCategory`, {
    displayName: 'jhola',
    timeZone: 'Asia/Kolkata',
    currencyCode: 'INR',
    industryCategory: 'SHOPPING',
  });
  console.log(`property: ${P} set to jhola · Asia/Kolkata · INR`);
} else {
  const summaries = await all(`${ADMIN}/accountSummaries`, 'accountSummaries');
  if (!summaries.length) {
    console.error('This login can see no Google Analytics account. Add it to your GA account (Admin → Account access management) as Editor, then re-run.');
    process.exit(3);
  }
  const account = accountArg ? summaries.find((a) => a.account === `accounts/${accountArg}`) : summaries[0];
  if (!account) throw new Error(`No access to accounts/${accountArg}`);
  console.log(`account: ${account.displayName} (${account.account})`);

  let property = (account.propertySummaries ?? []).find((p) => p.displayName === 'jhola');
  if (property) {
    console.log(`property: exists (${property.property})`);
  } else {
    const created = await api('POST', `${ADMIN}/properties`, {
      parent: account.account,
      displayName: 'jhola',
      timeZone: 'Asia/Kolkata',
      currencyCode: 'INR',
      industryCategory: 'SHOPPING',
      propertyType: 'PROPERTY_TYPE_ORDINARY',
    });
    property = { property: created.name };
    console.log(`property: created (${created.name})`);
  }
  P = property.property;
}

// --- web stream ---------------------------------------------------------------------
const streams = await all(`${ADMIN}/${P}/dataStreams`, 'dataStreams');
let stream = streams.find((s) => s.type === 'WEB_DATA_STREAM');
if (stream) {
  console.log(`web stream: exists (${stream.webStreamData?.measurementId})`);
} else {
  stream = await api('POST', `${ADMIN}/${P}/dataStreams`, { type: 'WEB_DATA_STREAM', displayName: 'jhola web', webStreamData: { defaultUri: siteUrl } });
  console.log(`web stream: created (${stream.webStreamData?.measurementId})`);
}

// --- retention: the longest a standard property keeps event data --------------------
await api('PATCH', `${ADMIN}/${P}/dataRetentionSettings?updateMask=eventDataRetention,resetUserDataOnNewActivity`, {
  eventDataRetention: 'FOURTEEN_MONTHS',
  resetUserDataOnNewActivity: true,
}).then(
  () => console.log('retention: 14 months'),
  (e) => console.log(`retention: skipped (${e.message})`),
);

// --- custom definitions: every parameter the app sends --------------------------------
const DIMENSIONS = [
  ['trigger', 'Compare trigger', 'EVENT', 'What started a comparison: button, returning_visitor, shared_link, paste, pin, stale_refresh…'],
  ['method', 'Method', 'EVENT', 'How: login/share method, add-to-list method, location method'],
  ['content_type', 'Content type', 'EVENT', 'What was shared: list or savings'],
  ['item', 'List item', 'EVENT', 'Grocery item (dictionary key, digits removed)'],
  ['app', 'App', 'EVENT', 'Grocery app of a pick, order hand-off or setting'],
  ['apps_in_plan', 'Apps in plan', 'EVENT', 'Apps the cheapest plan orders from, joined with +'],
  ['apps_blocked', 'Apps blocked', 'EVENT', 'Apps that refused the search, joined with +'],
  ['cheapest_single_app', 'Cheapest single app', 'EVENT', 'App that would carry the whole list cheapest on its own'],
  ['accounts', 'Accounts used', 'EVENT', 'Signed-in apps sent with a comparison'],
  ['location_source', 'Location source', 'EVENT', 'gps, network or manual'],
  ['approximate', 'Approximate location', 'EVENT', 'Whether the delivery point was approximate'],
  ['reason', 'Error reason', 'EVENT', 'Why a comparison failed'],
  ['brand_locked', 'Brand locked', 'EVENT', 'Whether an added item names a brand'],
  ['setting', 'Setting', 'EVENT', 'Which setting changed'],
  ['metric_name', 'Web vital', 'EVENT', 'LCP, INP, CLS, FCP or TTFB'],
  ['metric_rating', 'Web vital rating', 'EVENT', 'good, needs-improvement or poor'],
  ['accounts_connected', 'Accounts connected', 'USER', 'Apps the shopper is signed in to'],
  ['theme', 'Theme', 'USER', 'light or dark'],
  ['installed_app', 'Installed app', 'USER', 'Opened as an installed PWA'],
];
const METRICS = [
  ['item_count', 'Items compared', 'STANDARD'],
  ['items_found', 'Items found', 'STANDARD'],
  ['orders', 'Orders in plan', 'STANDARD'],
  ['fees', 'Fees in plan', 'CURRENCY'],
  ['savings', 'Savings', 'CURRENCY'],
  ['savings_pct', 'Savings percent', 'STANDARD'],
  ['apps_ok', 'Apps answered', 'STANDARD'],
  ['apps_unserviceable', 'Apps not delivering', 'STANDARD'],
  ['apps_account', 'Apps with own account prices', 'STANDARD'],
  ['duration_ms', 'Compare time', 'MILLISECONDS'],
  ['list_size', 'List size', 'STANDARD'],
  ['count', 'Items added', 'STANDARD'],
  ['price', 'Picked price', 'CURRENCY'],
  ['extra_cost', 'Extra cost of fewer orders', 'CURRENCY'],
  ['metric_value', 'Web vital value', 'STANDARD'],
];

const haveDims = new Set((await all(`${ADMIN}/${P}/customDimensions`, 'customDimensions')).map((d) => `${d.scope}:${d.parameterName}`));
for (const [parameterName, displayName, scope, description] of DIMENSIONS) {
  if (haveDims.has(`${scope}:${parameterName}`)) continue;
  await api('POST', `${ADMIN}/${P}/customDimensions`, { parameterName, displayName, scope, description }).then(
    () => console.log(`dimension: ${parameterName}`),
    (e) => console.log(`dimension: ${parameterName} skipped (${e.message})`),
  );
}
const haveMetrics = new Set((await all(`${ADMIN}/${P}/customMetrics`, 'customMetrics')).map((m) => m.parameterName));
for (const [parameterName, displayName, measurementUnit] of METRICS) {
  if (haveMetrics.has(parameterName)) continue;
  // Money metrics must say what kind of money they are; ours are prices, i.e. revenue-type data.
  const money = measurementUnit === 'CURRENCY' ? { restrictedMetricType: ['REVENUE_DATA'] } : {};
  await api('POST', `${ADMIN}/${P}/customMetrics`, { parameterName, displayName, measurementUnit, scope: 'EVENT', ...money }).then(
    () => console.log(`metric: ${parameterName}`),
    (e) => console.log(`metric: ${parameterName} skipped (${e.message})`),
  );
}

// --- key events: what counts as success ---------------------------------------------
const haveKeys = new Set((await all(`${ADMIN}/${P}/keyEvents`, 'keyEvents').catch(() => [])).map((k) => k.eventName));
for (const eventName of ['compare_complete', 'begin_checkout', 'login']) {
  if (haveKeys.has(eventName)) continue;
  await api('POST', `${ADMIN}/${P}/keyEvents`, { eventName, countingMethod: 'ONCE_PER_EVENT' }).then(
    () => console.log(`key event: ${eventName}`),
    (e) => console.log(`key event: ${eventName} skipped (${e.message})`),
  );
}

// Google signals stays off (the app also disables it in the tag).
await api('PATCH', `${ALPHA}/${P}/googleSignalsSettings?updateMask=state`, { state: 'GOOGLE_SIGNALS_DISABLED' }).then(
  () => console.log('google signals: off'),
  () => undefined,
);

console.log(`\nMEASUREMENT_ID=${stream.webStreamData?.measurementId}\nPROPERTY=${P}`);
