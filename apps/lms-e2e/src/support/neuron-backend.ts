import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Mock of prefrontal-mw `/api/office/*` (+ the beta flag + the tests list) for the Neuron screens suite. Fake, masked data only.
 * Install AFTER `installNegBackend` (later routes win; anything not ours is `fallback()`ed to it). The page code is real, the
 * spreadsheet engine is the REAL static build served at /neuron/ — only the HTTP API is faked.
 *
 * Knobs (reset with `resetOffice()`): `results` = how /results-workbook answers; `putStatus` = force the next PUT to fail;
 * `someoneElseSaved(id)` = a newer version appears on the server (the next PUT with the old If-Match is a 409).
 */
export const RESULTS_XLSX = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'neuron-results.xlsx'));
export const PK_HEAD = 'PK';

export interface StoredFile { id: string; name: string; version: number; bytes: Buffer; updatedAt: string; updatedByName: string }
export interface OfficeCall { method: string; path: string; ifMatch: string | null; name: string | null; kind: string | null; head: string | null; query: string; contentLength: number }

export type ResultsMode = 'ok' | 'truncated' | 'csv' | 'error';
export const office = {
  files: new Map<string, StoredFile>(),
  calls: [] as OfficeCall[],
  results: 'ok' as ResultsMode,
  putStatus: null as number | null,
  postStatus: null as number | null,
  seq: 0,
};

export function resetOffice(seed = true): void {
  office.files.clear(); office.calls = []; office.results = 'ok'; office.putStatus = null; office.postStatus = null; office.seq = 0;
  if (seed) {
    addFile('Glucose results.xlsx', 3);
    addFile('Monthly budget.xlsx', 1);
  }
}
export function addFile(name: string, version = 1): StoredFile {
  const id = `file-${++office.seq}`;
  const f: StoredFile = { id, name, version, bytes: RESULTS_XLSX, updatedAt: new Date(Date.now() - office.seq * 3600_000).toISOString(), updatedByName: 'Kavya Desk' };
  office.files.set(id, f);
  return f;
}
/** Another person saved: the server version moves on, so the browser's If-Match is stale. */
export function someoneElseSaved(id: string): void {
  const f = office.files.get(id)!;
  f.version += 1; f.updatedByName = 'Imran Lab';
}
export const calls = (method: string): OfficeCall[] => office.calls.filter(c => c.method === method);

const dto = (f: StoredFile) => ({ id: f.id, name: f.name, kind: 'sheet', sizeBytes: f.bytes.length, version: f.version, updatedAt: f.updatedAt, updatedByName: f.updatedByName });

/** Minimal multipart reader: the text fields and the first file part. */
export function parseMultipart(body: Buffer, contentType: string): { fields: Record<string, string>; file: Buffer | null; fileName: string | null } {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const out = { fields: {} as Record<string, string>, file: null as Buffer | null, fileName: null as string | null };
  if (!m) return out;
  const delim = Buffer.from('--' + (m[1] ?? m[2]));
  let pos = body.indexOf(delim);
  while (pos >= 0) {
    const next = body.indexOf(delim, pos + delim.length);
    if (next < 0) break;
    const part = body.subarray(pos + delim.length + 2, next - 2);
    const he = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, he).toString('latin1');
    const data = part.subarray(he + 4);
    const name = /name="([^"]+)"/.exec(head)?.[1];
    const fname = /filename="([^"]*)"/.exec(head)?.[1];
    if (fname !== undefined && name === 'file') { out.file = Buffer.from(data); out.fileName = fname; }
    else if (name) out.fields[name] = data.toString('utf8');
    pos = next;
  }
  return out;
}

export interface NeuronBackendOptions {
  /** Turn the beta on in this browser (pf.beta.neuron) and on the server. Off = a visitor who never ran pf.neuron(). */
  beta?: boolean;
  /** The server's own flag (default = beta). */
  serverFlag?: boolean;
}

export async function installNeuronBackend(page: Page, o: NeuronBackendOptions = {}): Promise<void> {
  const beta = o.beta !== false;
  if (beta) await page.addInitScript(() => { try { localStorage.setItem('pf.beta.neuron', '1'); } catch { /* storage blocked */ } });
  await page.route(/prefrontal\.health\/api\/(office|beta-features|tests)/, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    const cors = {
      'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'ETag, Content-Disposition, X-Truncated, X-Row-Count',
    };
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ok = (data: unknown) => json(200, { success: true, data });
    const bytes = (status: number, b: Buffer, extra: Record<string, string> = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/octet-stream', ...extra }, body: b });

    if (p === '/api/beta-features') return ok({ neuron: o.serverFlag ?? beta });
    if (p === '/api/tests' && m === 'GET') return ok([{ id: 't-glu', name: 'Glucose (Fasting)' }, { id: 't-urea', name: 'Blood Urea' }, { id: 't-cbc', name: 'Complete Blood Count' }]);
    if (!p.startsWith('/api/office/')) return route.fallback();

    const buf = req.postDataBuffer();
    const mp = buf ? parseMultipart(buf, req.headers()['content-type'] ?? '') : null;
    office.calls.push({
      method: m, path: p, ifMatch: req.headers()['if-match'] ?? null, name: mp?.fields['name'] ?? (m === 'PATCH' ? (JSON.parse(req.postData() || '{}').name ?? null) : null),
      kind: mp?.fields['kind'] ?? null, head: mp?.file ? mp.file.subarray(0, 2).toString('latin1') : null, query: url.search,
      contentLength: Number(req.headers()['content-length'] ?? 0),
    });

    if (p === '/api/office/files' && m === 'GET') return ok([...office.files.values()].map(dto));
    if (p === '/api/office/files' && m === 'POST') {
      if (office.postStatus) return json(office.postStatus, { success: false, error: 'server_error' });
      const f = addFile(mp?.fields['name'] || mp?.fileName || 'Untitled.xlsx', 1);
      f.bytes = mp?.file ?? f.bytes; f.updatedByName = 'Kavya Desk'; f.updatedAt = new Date().toISOString();
      return ok(dto(f));
    }
    if (p === '/api/office/results-workbook') {
      if (office.results === 'error') return json(500, { success: false, error: 'server_error' });
      if (office.results === 'csv') return bytes(200, Buffer.from('Patient,Test,Value\nP-0001,Glucose,92\n'), { 'content-type': 'text/csv' });
      return bytes(200, RESULTS_XLSX, {
        'content-disposition': 'attachment; filename="Glucose results.xlsx"',
        'x-row-count': office.results === 'truncated' ? '5000' : '3',
        ...(office.results === 'truncated' ? { 'x-truncated': 'true' } : {}),
      });
    }
    const one = /^\/api\/office\/files\/([^/]+)(\/content)?$/.exec(p);
    const f = one ? office.files.get(one[1]) : undefined;
    if (!one || !f) return json(404, { success: false, error: 'not_found' });
    if (one[2] && m === 'GET') return bytes(200, f.bytes, { etag: `"${f.version}"` });
    if (one[2] && m === 'PUT') {
      if (office.putStatus) { const s = office.putStatus; office.putStatus = null; return json(s, { success: false, error: 'server_error' }); }
      if (req.headers()['if-match'] !== `"${f.version}"`) return json(409, { success: false, error: 'version_conflict', message: 'Version conflict' });
      f.bytes = mp?.file ?? f.bytes; f.version += 1; f.updatedAt = new Date().toISOString(); f.updatedByName = 'Kavya Desk';
      return ok(dto(f));
    }
    if (m === 'PATCH') { f.name = JSON.parse(req.postData() || '{}').name ?? f.name; return ok(dto(f)); }
    if (m === 'DELETE') { office.files.delete(f.id); return ok({}); }
    return json(405, { success: false, error: 'method_not_allowed' });
  });
}
