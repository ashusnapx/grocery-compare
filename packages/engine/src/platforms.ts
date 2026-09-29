import type { PlatformId } from './types';

export interface PlatformMeta {
  id: PlatformId;
  name: string;
  /** 'quick' = minutes from a dark store; 'slotted' = scheduled delivery. */
  delivery: 'quick' | 'slotted';
  /** Brand colour, used for the order card accent. */
  color: string;
  homepage: string;
  /** How the platform picks a store: from coordinates or from a pincode. */
  locatesBy: 'coordinates' | 'pincode';
}

export const PLATFORMS: Record<PlatformId, PlatformMeta> = {
  blinkit: { id: 'blinkit', name: 'Blinkit', delivery: 'quick', color: '#f8cb46', homepage: 'https://blinkit.com', locatesBy: 'coordinates' },
  zepto: { id: 'zepto', name: 'Zepto', delivery: 'quick', color: '#5a1e8c', homepage: 'https://www.zepto.com', locatesBy: 'coordinates' },
  instamart: { id: 'instamart', name: 'Instamart', delivery: 'quick', color: '#fc8019', homepage: 'https://www.swiggy.com/instamart', locatesBy: 'coordinates' },
  jiomart: { id: 'jiomart', name: 'JioMart', delivery: 'quick', color: '#0078ad', homepage: 'https://www.jiomart.com', locatesBy: 'pincode' },
  dmart: { id: 'dmart', name: 'DMart Ready', delivery: 'slotted', color: '#0a8a3c', homepage: 'https://www.dmart.in', locatesBy: 'pincode' },
  bigbasket: { id: 'bigbasket', name: 'BB Now', delivery: 'quick', color: '#84c225', homepage: 'https://www.bigbasket.com', locatesBy: 'coordinates' },
};

/** Fan-out order, which is also the order apps appear in progress rows. */
export const PLATFORM_IDS: PlatformId[] = ['blinkit', 'zepto', 'instamart', 'jiomart', 'dmart', 'bigbasket'];

export function isPlatformId(s: string): s is PlatformId {
  return (PLATFORM_IDS as string[]).includes(s);
}
