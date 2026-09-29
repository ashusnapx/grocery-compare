import { search } from 'india-pincode-search';
import { z } from 'zod';

export const runtime = 'nodejs';

/**
 * Pincode → coordinates, or coordinates → pincode.
 *
 * Quick-commerce apps pick a dark store from coordinates, JioMart and DMart
 * from a pincode, so a location needs both. A pincode alone gives the
 * pincode's centroid, which is flagged `approximate` so the UI can say so.
 *
 * Nominatim's policy allows about one request a second with an identifying
 * User-Agent; results are cached in memory (there is no database) because a
 * pincode's centroid does not move.
 *
 * `?auto=1` answers with the approximate place of the visitor's network, read
 * from the visitor-location headers the host adds (Vercel; Cloudflare with
 * visitor location headers on). No third party sees the visitor's IP.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = 'jhola/0.1 (grocery price comparison; https://github.com/ashusnapx)';
const cache = new Map<string, unknown>();

const ByPin = z.object({ pincode: z.string().regex(/^\d{6}$/) });
const ByCoords = z.object({ lat: z.coerce.number().min(6).max(38), lng: z.coerce.number().min(68).max(98) });

function tidy(office: string): string {
  return office.replace(/\s+(S\.O|H\.O|B\.O|G\.P\.O|S\.O\.)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function areaLabel(pincode: string): string | undefined {
  try {
    const hit = (search(pincode) ?? [])[0];
    if (!hit) return undefined;
    return `${tidy(hit.office)}, ${titleCase(hit.city || hit.district)}`;
  } catch {
    return undefined;
  }
}

function fromNetwork(h: Headers): { lat: number; lng: number; postal: string | null; city: string | null } | null {
  const country = h.get('x-vercel-ip-country') ?? h.get('cf-ipcountry');
  const lat = Number(h.get('x-vercel-ip-latitude') ?? h.get('cf-iplatitude'));
  const lng = Number(h.get('x-vercel-ip-longitude') ?? h.get('cf-iplongitude'));
  if (country !== 'IN' || !ByCoords.safeParse({ lat, lng }).success) return null;
  const postal = h.get('x-vercel-ip-postal-code') ?? h.get('cf-postal-code');
  const city = h.get('x-vercel-ip-city') ?? h.get('cf-ipcity');
  return { lat, lng, postal: postal && /^\d{6}$/.test(postal) ? postal : null, city: city ? decodeURIComponent(city) : null };
}

async function nominatim<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${NOMINATIM}${path}`, { signal, headers: { 'user-agent': UA, accept: 'application/json', 'accept-language': 'en' } });
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(6000)]);

  if (params.auto === '1') {
    const net = fromNetwork(request.headers);
    if (!net) return Response.json({ error: 'No network location' }, { status: 404 });
    let pincode = net.postal;
    if (!pincode) {
      try {
        const data = await nominatim<{ address?: { postcode?: string } }>(`/reverse?lat=${net.lat}&lon=${net.lng}&format=json&addressdetails=1&zoom=14`, signal);
        pincode = data.address?.postcode?.replace(/\s+/g, '') ?? null;
      } catch {
        pincode = null;
      }
    }
    if (!pincode || !/^\d{6}$/.test(pincode)) return Response.json({ error: 'No network location' }, { status: 404 });
    return Response.json({ lat: net.lat, lng: net.lng, pincode, approximate: true, label: net.city ? `near ${net.city}` : areaLabel(pincode) });
  }

  const pin = ByPin.safeParse(params);
  if (pin.success) {
    const { pincode } = pin.data;
    const key = `pin:${pincode}`;
    if (cache.has(key)) return Response.json(cache.get(key));
    try {
      const hits = await nominatim<{ lat: string; lon: string }[]>(
        `/search?postalcode=${pincode}&country=India&format=json&limit=1`,
        signal,
      );
      const first = hits[0];
      if (!first) return Response.json({ error: `Couldn’t find pincode ${pincode}` }, { status: 404 });
      const body = { lat: Number(first.lat), lng: Number(first.lon), pincode, approximate: true, label: areaLabel(pincode) };
      cache.set(key, body);
      return Response.json(body);
    } catch {
      return Response.json({ error: 'The map service is slow right now — try again in a moment' }, { status: 502 });
    }
  }

  const coords = ByCoords.safeParse(params);
  if (coords.success) {
    const { lat, lng } = coords.data;
    try {
      const data = await nominatim<{ address?: { postcode?: string; suburb?: string; neighbourhood?: string; city?: string; town?: string } }>(
        `/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`,
        signal,
      );
      const a = data.address ?? {};
      const pincode = a.postcode?.replace(/\s+/g, '');
      if (!pincode || !/^\d{6}$/.test(pincode)) {
        return Response.json({ error: 'That spot has no Indian pincode we can read' }, { status: 404 });
      }
      const area = a.suburb ?? a.neighbourhood;
      const city = a.city ?? a.town;
      return Response.json({
        lat,
        lng,
        pincode,
        approximate: false,
        label: [area, city].filter(Boolean).join(', ') || areaLabel(pincode),
      });
    } catch {
      return Response.json({ error: 'The map service is slow right now — try again in a moment' }, { status: 502 });
    }
  }

  return Response.json({ error: 'Send a 6-digit pincode, or lat and lng inside India' }, { status: 400 });
}
