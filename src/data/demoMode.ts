const STORAGE_KEY = 'ndrf_force_demo_mode';

/**
 * Presenter-controlled override for the demo-safety fallback. When armed, the app serves the
 * curated demo snapshot directly from the client bundle — zero network calls, so a dead venue
 * wifi or a rate-limited API can't affect it. Distinct from the *automatic* live→demo fallback
 * in mockApi.ts, which kicks in only when a live fetch actually fails/returns nothing; this is
 * a deliberate, deterministic pre-arm switch for when you already know conditions are risky.
 * Persisted in localStorage so it survives a page reload mid-demo.
 */
export function isDemoModeForced(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setDemoModeForced(forced: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(forced));
  } catch {
    // localStorage unavailable (private browsing, etc.) — override just won't persist
  }
}
