import type { PlatformId } from '@gc/engine';
import type { PlatformAdapter } from './types';
import blinkit from './blinkit';
import zepto from './zepto';
import instamart from './instamart';
import jiomart from './jiomart';
import dmart from './dmart';
import bigbasket from './bigbasket';

/**
 * Static imports on purpose: a broken adapter surfaces at startup rather than
 * on the one request that happened to need it.
 */
export const ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  blinkit,
  zepto,
  instamart,
  jiomart,
  dmart,
  bigbasket,
};

// A key that disagrees with the adapter's own id would label every row as the
// wrong platform — a confidently wrong price with no symptom anywhere else.
for (const [id, adapter] of Object.entries(ADAPTERS)) {
  if (adapter.id !== id) throw new Error(`Adapter registry key "${id}" holds adapter "${adapter.id}"`);
}
