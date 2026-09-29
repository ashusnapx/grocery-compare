import { UNITS, type ListRow, type Unit } from '@gc/engine';
import { track } from './analytics';

/**
 * A shareable list lives in the URL fragment (#l=…). Browsers never send the
 * fragment to any server, so a shared list travels phone-to-phone without
 * touching ours.
 */
type Packed = [text: string, amount: number, unit: Unit, anyBrand: 0 | 1];

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeList(rows: ListRow[]): string {
  const packed: Packed[] = rows.map((r) => [r.text, r.amount, r.unit, r.anyBrand ? 1 : 0]);
  return toBase64Url(JSON.stringify(packed));
}

export function decodeList(fragment: string): Omit<ListRow, 'id'>[] | null {
  try {
    const data = JSON.parse(fromBase64Url(fragment)) as unknown;
    if (!Array.isArray(data)) return null;
    const rows = data
      .filter(
        (x): x is Packed =>
          Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number' && x[1] > 0 && (UNITS as string[]).includes(x[2] as string),
      )
      .slice(0, 60)
      .map(([text, amount, unit, anyBrand]) => ({ text: text.slice(0, 120), amount, unit, anyBrand: anyBrand === 1 }));
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

export function listLink(rows: ListRow[]): string {
  return `${window.location.origin}/#l=${encodeList(rows)}`;
}

/** The phone's share sheet where there is one, else the clipboard. */
export async function shareOrCopy(data: { title: string; text: string; url: string }): Promise<'shared' | 'copied' | 'failed'> {
  const result = await shareOrCopyOnce(data);
  if (result !== 'failed') {
    track('share', { method: result === 'shared' ? 'share_sheet' : 'copy_link', content_type: data.url.includes('#l=') ? 'list' : 'savings' });
  }
  return result;
}

async function shareOrCopyOnce(data: { title: string; text: string; url: string }): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share(data);
      return 'shared';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(`${data.text} ${data.url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
