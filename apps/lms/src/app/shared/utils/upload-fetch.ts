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
    const viaSigned = signed?.[url];
    if (viaSigned) {
      const r = await fetch(absoluteApiUrl(viaSigned, apiBase), { mode: 'cors' });
      return r.ok ? await r.blob() : null;
    }
    if (isPrivateUploadPath(url)) return authedFetcher ? await authedFetcher(url) : null;
    const r = await fetch(absoluteApiUrl(url, apiBase), { mode: 'cors' });
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}
