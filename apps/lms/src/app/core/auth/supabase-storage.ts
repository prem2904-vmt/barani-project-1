import { environment } from '../../../environments/environment';

/**
 * Supabase persists auth state under keys like `sb-<project-ref>-auth-token`
 * (localStorage) and in IndexedDB databases whose names start with `supabase`.
 * If the UI is pointed at a different project than the one a user signed into
 * previously, the lib will still try to refresh that stale token on boot and
 * hang — which is exactly what was freezing the login button.
 *
 * These helpers defensively wipe anything that isn't our current project so
 * signIn always starts from a clean slate when we detect trouble.
 */

function currentProjectRef(): string {
  try {
    return new URL(environment.auth.supabaseUrl).hostname.split('.')[0];
  } catch {
    return '';
  }
}

/** True if any localStorage key looks like a Supabase auth token from a different project. */
export function hasStaleSupabaseSession(): boolean {
  const me = currentProjectRef();
  if (!me) return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // Supabase v2 key shape: sb-<ref>-auth-token[.N]
      const m = /^sb-([^-]+)-auth-token/.exec(k);
      if (m && m[1] !== me) return true;
    }
  } catch { /* privacy-mode storage throws */ }
  return false;
}

/** Remove every Supabase-owned entry in localStorage, regardless of project. */
export function purgeSupabaseLocalStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('sb-') || k.startsWith('supabase.'))) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/** Best-effort drop every IndexedDB DB whose name starts with "supabase". */
export async function purgeSupabaseIndexedDb(): Promise<void> {
  try {
    // indexedDB.databases() is supported in Chromium/WebKit; Firefox returns []
    const anyIdb = indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> };
    if (!anyIdb.databases) return;
    const dbs = await anyIdb.databases();
    await Promise.all(
      dbs
        .filter(d => d.name && d.name.toLowerCase().startsWith('supabase'))
        .map(d => new Promise<void>(resolve => {
          const req = indexedDB.deleteDatabase(d.name!);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        }))
    );
  } catch { /* ignore */ }
}

export async function purgeSupabaseStorage(): Promise<void> {
  purgeSupabaseLocalStorage();
  await purgeSupabaseIndexedDb();
}
