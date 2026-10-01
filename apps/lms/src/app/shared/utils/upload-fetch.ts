/**
 * Private uploads (server: GET /api/uploads/file, signed /uploads URLs).
 *
 * Files under "/uploads/…" (report logos / signature scans, result
 * attachments, partner reports, chat files, plate photos) are no longer served
 * anonymously. Inside the app they are fetched WITH the session (bearer) via
 * the authenticated, tenant-scoped endpoint; the patient's public report page
 * gets short-lived signed URLs from its verify call instead.
 *
 * Plain functions here so the framework-free PDF renderers (report-pdf.ts,
 * invoice-pdf.ts) can use them: UploadsService registers the authenticated
 * fetcher at app start (see app.config.ts).
 */

/** A stored, UNSIGNED upload path — needs the session (or a signature). */
export function isPrivateUploadPath(url: string | null | undefined): url is string {
  return !!url && url.startsWith('/uploads/') && !/[?&]sig=/.test(url);
}

/** OPD's own authenticated file endpoints (consult media, a walk-in's
 *  prescription) — a DIFFERENT url shape from "/uploads/…" (the endpoint
 *  IS the path, already carrying its own query string), but the SAME rule:
 *  never a bare `fetch()`, always through the app's authenticated fetcher
 *  (the X-PF-OPD / auth interceptors only run on HttpClient requests). */
export function isOpdMediaPath(url: string | null | undefined): url is string {
  if (!url) return false;
  const path = url.split('?')[0];
  return /^\/api\/opd\/consult\/[^/]+\/media\/file$/.test(path)
    || /^\/api\/opd\/pharmacy\/counter\/[^/]+\/prescription\/file$/.test(path);
}

/** A patient document's authenticated file endpoint
 *  (`/api/patients/{id}/documents/{docId}/file`) — logic audit: documents were
 *  presigned links that worked without the session. */
export function isPatientDocumentPath(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^\/api\/patients\/[^/]+\/documents\/[^/]+\/file$/.test(url.split('?')[0]);
}

/** An API endpoint that IS the file (fetched directly, with the session). */
export function isApiFileEndpoint(url: string | null | undefined): url is string {
  return isOpdMediaPath(url) || isPatientDocumentPath(url);
}

/** Any path that must go through the authenticated fetcher — never a bare `fetch()`. */
export function isAuthedApiFilePath(url: string | null | undefined): url is string {
  return isPrivateUploadPath(url) || isApiFileEndpoint(url);
}

/** A stored reference to one of OUR uploads, as its "/uploads/…" path. Older
 *  rows (e.g. a tenant logo) may hold the resolved absolute link on the API
 *  host ("https://api…/uploads/…"), which the server now refuses unsigned —
 *  map it back to the path so it goes through the session like the rest.
 *  Anything else (other hosts, signed links, data:/blob:) is returned as is. */
export function uploadPathOf(url: string, apiBase: string): string {
  if (!url || !/^https?:\/\//i.test(url) || !/^https?:\/\//i.test(apiBase || '')) return url;
  try {
    const u = new URL(url);
    if (u.origin !== new URL(apiBase).origin || !u.pathname.startsWith('/uploads/') || u.searchParams.has('sig')) return url;
    return u.pathname;
  } catch {
    return url;
  }
}

/** Resolve a server-relative URL against the API origin; absolute, data: and
 *  blob: URLs pass through. */
export function absoluteApiUrl(url: string, apiBase: string): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${apiBase.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

type UploadFetcher = (path: string) => Promise<Blob | null>;
let authedFetcher: UploadFetcher | null = null;

/** Called once by UploadsService with its HttpClient-backed fetcher. */
export function registerUploadFetcher(f: UploadFetcher | null): void {
  authedFetcher = f;
}

/**
 * Bytes of an asset URL as a Blob, or null on any failure.
 *  - `signed[url]` (public report page) wins: fetched anonymously;
 *  - an unsigned "/uploads/…" path goes through the authenticated fetcher;
 *  - anything else (absolute / data: / already-signed) is fetched as is.
 */
export async function fetchAssetBlob(
  url: string, apiBase: string, signed?: Record<string, string> | null,
): Promise<Blob | null> {
  try {
    // (An absolute link to our /uploads is signed under its stored path.)
    const path = uploadPathOf(url, apiBase);
    const viaSigned = signed?.[url] ?? signed?.[path];
    if (viaSigned) {
      const r = await fetch(absoluteApiUrl(viaSigned, apiBase), { mode: 'cors' });
      return r.ok ? await r.blob() : null;
    }
    if (isPrivateUploadPath(path)) return authedFetcher ? await authedFetcher(path) : null;
    const r = await fetch(absoluteApiUrl(url, apiBase), { mode: 'cors' });
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}
