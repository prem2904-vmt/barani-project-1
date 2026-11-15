import type { Page } from '@playwright/test';
import { RESULTS_XLSX, parseMultipart } from './neuron-backend';
import { neg } from './neg-backend';

/**
 * Mock of prefrontal-mw `/api/office/*` for the Files screens suite (fake, masked data only). Install AFTER installNegBackend (anything not ours
 * falls back to it). The page code is real; only the HTTP API is faked. Knobs live on `fb` (reset with resetFiles()):
 *   full        the lab is entitled to Full Files (module-config files: true) - false = View only
 *   apps        per-app { enabled, canRead, canWrite } as the server would answer for the signed-in person
 *   flaggedExportDenied   device-export of a flagged file answers 403 phi_export_denied
 */
export interface FbFile { id: string; name: string; kind: string; sizeBytes: number; version: number; updatedAt: string; updatedByName: string; ownerId?: string; containsPhi?: boolean; phiSources?: unknown[]; sharedAccess?: string; deletedAt?: string; bytes?: Buffer }
export interface FbCall { method: string; path: string; body: unknown; ifMatch: string | null; head: string | null; query: string }
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const DOCX_BYTES = (() => { const b = Buffer.from(RESULTS_XLSX); return b; })();   // any zip; the engines are not asked to render it in these specs

export const fb = {
  files: new Map<string, FbFile>(),
  trash: new Map<string, FbFile>(),
  shares: new Map<string, { id: string; principalType: string; principalId: string; name: string; detail?: string; access: string }[]>(),
  calls: [] as FbCall[],
  full: true,
  apps: {} as Record<string, { enabled: boolean; canRead: boolean; canWrite: boolean }>,
  editOnPhones: false,
  trashDays: 30,
  flaggedExportDenied: false,
  hideExtraBeta: false,
  seq: 0,
};
export function resetFiles(o: { full?: boolean; empty?: boolean } = {}): void {
  fb.files.clear(); fb.trash.clear(); fb.shares.clear(); fb.calls = []; fb.seq = 0; fb.full = o.full !== false; fb.editOnPhones = false; fb.trashDays = 30; fb.flaggedExportDenied = false; (fb as unknown as { navDefaults?: unknown }).navDefaults = {};
  const on = { enabled: true, canRead: true, canWrite: true };
  fb.apps = { sheet: { ...on }, doc: { ...on }, slides: { ...on }, pdf: { ...on }, image: { ...on } };
  neg.modules = { ...(neg.modules as object), files: fb.full } as never;
  if (o.empty) return;
  add('Results 9 to 15 Nov 2026.xlsx', 'sheet', 5 * 1024, 1, 'Lakshmi Admin', { containsPhi: true, phiSources: [{ source: 'results', at: ago(2), byName: 'Lakshmi Admin' }] });
  add('Sample rejection SOP.docx', 'doc', 48 * 1024, 4, 'Dr Priya Raman');
  add('Monthly quality review.pptx', 'slides', 2.1 * 1024 * 1024, 20, 'Dr Arun Kumar');
  add('QC log, November.xlsx', 'sheet', 12 * 1024, 50, 'Karthik Tech', { sharedAccess: 'edit', ownerId: 'someone-else' });
  add('Referral letter, Dr Mehta with a long name that has to wrap onto a second line on a phone.docx', 'doc', 22 * 1024, 70, 'Lakshmi Admin');
  add('Partner report.pdf', 'pdf', 90 * 1024, 90, 'Lakshmi Admin', { bytes: PDF_BYTES });
  add('Wound photo.png', 'image', 300 * 1024, 100, 'Karthik Tech');
}
export function add(name: string, kind: string, size: number, hoursAgo: number, by: string, extra: Partial<FbFile> = {}): FbFile {
  const id = `file-${++fb.seq}`;
  const f: FbFile = { id, name, kind, sizeBytes: Math.round(size), version: 1, updatedAt: ago(hoursAgo), updatedByName: by, ownerId: 'me', ...extra };
  fb.files.set(id, f);
  return f;
}
export const callsOf = (method: string, re?: RegExp): FbCall[] => fb.calls.filter(c => c.method === method && (!re || re.test(c.path)));

const dto = (f: FbFile) => { const { bytes: _b, ...rest } = f; void _b; return rest; };

export async function installFilesBackend(page: Page, o: { beta?: boolean } = {}): Promise<void> {
  const beta = o.beta !== false;
  if (beta) await page.addInitScript(() => { try { localStorage.setItem('pf.beta.neuron', '1'); } catch { /* blocked */ } });
  await page.route(/prefrontal\.health\/api\/(office|beta-features|tests|tenants\/nav-defaults|roles)/, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const url = new URL(req.url()); const p = url.pathname; const m = req.method();
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'ETag, Content-Disposition' };
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ok = (data: unknown) => json(200, { success: true, data });
    if (p === '/api/beta-features') return ok({ neuron: beta });
    if (p === '/api/tests' && m === 'GET') return ok([{ id: 't-glu', name: 'Glucose (Fasting)' }, { id: 't-urea', name: 'Blood Urea' }]);
    if (p === '/api/roles/' || p === '/api/roles') return ok([{ id: 'r1', name: 'Admin' }, { id: 'r2', name: 'Doctor' }, { id: 'r3', name: 'Lab in-charge' }, { id: 'r4', name: 'Technician' }]);
    if (p === '/api/tenants/nav-defaults') return ok({ roles: (fb as unknown as { navDefaults?: unknown }).navDefaults ?? {} });
    if (!p.startsWith('/api/office/')) return route.fallback();
    const buf = req.postDataBuffer();
    let body: unknown = null;
    const ct = req.headers()['content-type'] ?? '';
    const mp = buf && ct.includes('multipart') ? parseMultipart(buf, ct) : null;
    if (!mp) { try { body = req.postData() ? JSON.parse(req.postData()!) : null; } catch { body = null; } } else body = { ...mp.fields, fileName: mp.fileName };
    fb.calls.push({ method: m, path: p, body, ifMatch: req.headers()['if-match'] ?? null, head: mp?.file ? mp.file.subarray(0, 2).toString('latin1') : null, query: url.search });
    const ro = (): Promise<void> | null => (!fb.full && m !== 'GET' ? json(403, { success: false, error: 'module_readonly', message: 'Files are view only for your organization.' }) : null);

    if (p === '/api/office/settings' && m === 'GET') {
      return ok({
        settings: { apps: { sheet: { enabled: fb.apps['sheet'].enabled, editRoles: ['Admin', 'Lab in-charge', 'Technician'] }, doc: { enabled: fb.apps['doc'].enabled, editRoles: [] }, slides: { enabled: fb.apps['slides'].enabled, editRoles: ['Admin', 'Doctor'] }, pdf: { enabled: fb.apps['pdf'].enabled, editRoles: [] }, image: { enabled: fb.apps['image'].enabled, editRoles: [] } },
          editOnPhones: fb.editOnPhones, trashDays: fb.trashDays, patientNames: true, ownTemplates: [{ id: 'o1', kind: 'doc', name: "Letter on the lab's letterhead", fileId: 'file-2' }], hiddenTemplates: [] },
        access: { apps: Object.fromEntries(Object.entries(fb.apps).map(([k, v]) => [k, { enabled: v.enabled, canRead: v.canRead, canWrite: fb.full && v.canWrite }])), editOnPhones: fb.editOnPhones, trashDays: fb.trashDays, patientNames: true, canManage: true, full: fb.full },
      });
    }
    if (p === '/api/office/settings' && m === 'PUT') { const d = ro(); if (d) return d; return ok({ settings: body, access: { full: true, apps: {} } }); }
    if (p === '/api/office/storage') return ok({ totalBytes: 1.2 * 1024 ** 3, byKind: [{ kind: 'sheet', count: 412, bytes: 1 }, { kind: 'doc', count: 96, bytes: 1 }, { kind: 'slides', count: 18, bytes: 1 }, { kind: 'pdf', count: 7, bytes: 1 }, { kind: 'image', count: 41, bytes: 1 }], trashCount: fb.trash.size, trashBytes: 0 });
    if (p === '/api/office/share-targets') return ok([{ type: 'user', id: 'u2', name: 'Imran Lab' }, { type: 'role', id: 'r4', name: 'All Technicians', detail: 'Role · 6 people' }]);
    if (p === '/api/office/files' && m === 'GET') {
      const kind = url.searchParams.get('kind');
      if (url.searchParams.get('trash') === 'true') return ok([...fb.trash.values()].map(dto));
      if (url.searchParams.get('shared') === 'true') return ok([...fb.files.values()].filter(f => f.sharedAccess).map(dto));
      const enabled = Object.entries(fb.apps).filter(([, v]) => v.enabled && v.canRead).map(([k]) => k);
      if (kind && !fb.apps[kind]?.enabled) return json(403, { success: false, error: 'app_off', message: 'off' });
      return ok([...fb.files.values()].filter(f => enabled.includes(f.kind) && (!kind || f.kind === kind)).map(dto));
    }
    if (p === '/api/office/files' && m === 'POST') {
      const d = ro(); if (d) return d;
      const kind = (mp?.fields['kind'] ?? 'sheet');
      if (!fb.apps[kind]?.canWrite) return json(403, { success: false, error: 'forbidden', message: 'x' });
      const f = add(mp?.fields['name'] || 'Untitled', kind, mp?.file?.length ?? 100, 0, 'Kavya Desk', { bytes: mp?.file ?? undefined });
      if (mp?.fields['phiSource']) { f.containsPhi = true; f.phiSources = [{ source: mp.fields['phiSource'], at: ago(0), byName: 'Kavya Desk' }]; }
      return json(201, { success: true, data: dto(f) });
    }
    const sh = /^\/api\/office\/files\/([^/]+)\/shares(?:\/([^/]+))?$/.exec(p);
    if (sh) {
      const f = fb.files.get(sh[1]); if (!f) return json(404, { success: false, error: 'not_found' });
      const list = fb.shares.get(f.id) ?? [];
      if (m === 'GET') return ok({ ownerId: 'me', ownerName: 'Karthik Tech', isOwner: true, canManage: true, shares: list });
      const d = ro(); if (d) return d;
      if (m === 'PUT') { const b = body as { type: string; principalId: string; access: string }; const named = b.type === 'role' ? { name: 'All Technicians', detail: 'Role · 6 people' } : { name: 'Imran Lab' }; const row = { id: `sh-${list.length + 1}`, principalType: b.type, principalId: b.principalId, access: b.access, ...named }; fb.shares.set(f.id, [...list.filter(x => x.principalId !== b.principalId), row]); return ok(row); }
      if (m === 'DELETE') { fb.shares.set(f.id, list.filter(x => x.id !== sh[2])); return route.fulfill({ status: 204, headers: cors }); }
    }
    const one = /^\/api\/office\/files\/([^/]+)(\/content|\/restore|\/phi|\/copy|\/device-export)?$/.exec(p);
    const f = one ? (fb.files.get(one[1]) ?? fb.trash.get(one[1])) : undefined;
    if (!one || !f) return json(404, { success: false, error: 'not_found' });
    const sub = one[2];
    if (sub === '/content' && m === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/octet-stream', etag: `"${f.version}"` }, body: f.bytes ?? (f.kind === 'pdf' ? PDF_BYTES : RESULTS_XLSX) });
    if (sub === '/device-export') {
      if (f.containsPhi && fb.flaggedExportDenied) return json(403, { success: false, error: 'phi_export_denied', message: 'x' });
      return ok({ allowed: true, flagged: !!f.containsPhi });
    }
    const d = ro(); if (d) return d;
    if (sub === '/content' && m === 'PUT') { f.version += 1; f.bytes = mp?.file ?? f.bytes; f.updatedAt = ago(0); return ok(dto(f)); }
    if (sub === '/restore') { fb.trash.delete(f.id); fb.files.set(f.id, { ...f, deletedAt: undefined }); return ok(dto(f)); }
    if (sub === '/phi') { f.containsPhi = true; return ok(dto(f)); }
    if (m === 'PATCH') { f.name = (body as { name?: string }).name ?? f.name; return ok(dto(f)); }
    if (m === 'DELETE') { fb.files.delete(f.id); fb.trash.set(f.id, { ...f, deletedAt: ago(1) }); return route.fulfill({ status: 204, headers: cors }); }
    return json(405, { success: false, error: 'method_not_allowed' });
  });
}
