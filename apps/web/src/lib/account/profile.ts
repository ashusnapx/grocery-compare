import { load, save } from '@/lib/storage';
import { accessToken, isSignedIn } from './oauth';
import type { AccountPlatform } from './providers';

/** The shopper's first name, read once from a signed-in app and kept in this browser only. */
interface Profile {
  name: string;
  from: AccountPlatform;
  at: number;
}

const KEY = 'account:profile';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ORDER: AccountPlatform[] = ['zepto', 'instamart'];

export function savedName(): string | null {
  const p = load<Profile | null>(KEY, null);
  return p && isSignedIn(p.from) ? p.name : null;
}

function keep(p: Profile | null) {
  save(KEY, p);
  window.dispatchEvent(new Event('jhola:profile'));
}

/** Asks the signed-in apps (Zepto first) for the shopper's name; forgets it once no app is signed in. */
export async function refreshName(force = false): Promise<string | null> {
  const saved = load<Profile | null>(KEY, null);
  if (saved && !force && isSignedIn(saved.from) && Date.now() - saved.at < MAX_AGE_MS) return saved.name;
  for (const id of ORDER) {
    if (!isSignedIn(id)) continue;
    const token = await accessToken(id);
    if (!token) continue;
    const res = await fetch('/api/account/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platformId: id, token }),
    }).catch(() => null);
    const name = res?.ok ? ((await res.json()) as { name: string | null }).name : null;
    if (name) {
      keep({ name, from: id, at: Date.now() });
      return name;
    }
  }
  if (!ORDER.some(isSignedIn)) {
    if (saved) keep(null);
    return null;
  }
  return saved?.name ?? null;
}
