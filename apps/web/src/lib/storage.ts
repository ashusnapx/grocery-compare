/**
 * Everything the app remembers lives in the user's browser — there is no
 * database. Storage can be unavailable (private mode, blocked site data), so
 * every access is guarded and the app works without it.
 */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`jhola:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`jhola:${key}`, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the session still works, it just won't be remembered.
  }
}
