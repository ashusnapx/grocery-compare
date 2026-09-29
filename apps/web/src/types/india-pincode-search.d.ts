/**
 * The package ships no types. Declared to the shape actually returned, verified
 * against the real dataset rather than its README.
 */
declare module 'india-pincode-search' {
  export interface PincodeRecord {
    state: string;
    city: string;
    district: string;
    village: string;
    office: string;
    pincode: string;
  }
  /** Matches on either a pincode or an area name. Returns [] for no match. */
  export function search(query: string): PincodeRecord[];
}
