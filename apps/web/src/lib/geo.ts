import type { GeoLocation } from '@gc/engine';

/**
 * Where to deliver, found with as few questions as possible: GPS when the
 * browser already allows it, else the approximate place the network reports
 * (no prompt), and GPS is asked for only when a comparison needs it.
 */
export type LocationSource = 'gps' | 'manual' | 'network';

export async function locate(params: Record<string, string>): Promise<GeoLocation> {
  const res = await fetch(`/api/locate?${new URLSearchParams(params)}`);
  const body = (await res.json()) as GeoLocation & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? 'Could not find that location');
  return body;
}

/** The phone's position, or null when unsupported, denied or too slow. */
function currentPosition(timeoutMs: number): Promise<GeolocationPosition | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 });
  });
}

export async function gpsLocation(timeoutMs = 10_000): Promise<GeoLocation | null> {
  const pos = await currentPosition(timeoutMs);
  if (!pos) return null;
  return locate({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) }).catch(() => null);
}

/** True only when GPS would be answered without a prompt. */
export async function gpsAllowed(): Promise<boolean> {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted';
  } catch {
    return false;
  }
}

/** The approximate place the network reports (hosting adds it to each request); null when unknown. */
export function networkLocation(): Promise<GeoLocation | null> {
  return locate({ auto: '1' }).catch(() => null);
}
