import { FilesApp, filesAppForKind } from './files-registry';
import type { OfficeFile, OfficeOwnTemplate, OfficeSettings } from './office.service';
import type { StartHome, StartRecent, StartTemplate } from './files-bridge';

/** Where an app's start screen lives: the Start menu, the bottom bar and pins all open it. The Files screen (`/files`) stays the all-files view. */
export const filesStartPath = (a: Pick<FilesApp, 'route'>): string => `/files/${a.route}/start`;
/** The route id that means "this app, no file: show its own start screen". */
export const START_ID = 'start';
/** How many recent files an app's start screen lists. */
export const START_RECENT_MAX = 12;

/** A template the person may start from (built-in = the engine builds it with `cmd`; own = a lab file copied on use). */
export interface FilesTemplate { id: string; name: string; app: FilesApp; cmd?: { cmd: string; params: Record<string, unknown> }; own?: OfficeOwnTemplate }

/**
 * THE template list: each app's built-in templates (unless the lab hid them) followed by the lab's own. A lab template of the same name
 * replaces the built-in one (never two rows with one name). Used by the Files screen AND by every app's start screen, so they never differ.
 */
export function startTemplates(apps: readonly FilesApp[], settings: Pick<OfficeSettings, 'hiddenTemplates' | 'ownTemplates'> | null | undefined): FilesTemplate[] {
  const hidden = new Set(settings?.hiddenTemplates ?? []);
  const out: FilesTemplate[] = [];
  for (const a of apps) for (const t of a.templates) if (!hidden.has(t.id)) out.push({ id: t.id, name: t.name, app: a, cmd: t.cmd });
  for (const o of settings?.ownTemplates ?? []) {
    const a = filesAppForKind(o.kind);
    if (!a || !apps.includes(a)) continue;
    const same = out.findIndex(x => x.app.id === a.id && !x.own && x.name.trim().toLowerCase() === o.name.trim().toLowerCase());
    if (same >= 0) out.splice(same, 1);
    if (!out.some(x => x.own && x.app.id === a.id && x.name.trim().toLowerCase() === o.name.trim().toLowerCase())) out.push({ id: 'own:' + o.id, name: o.name, app: a, own: o });
  }
  return out;
}

/** The newest files of THIS app's kind (never another app's), without trashed ones. */
export function recentFor(app: FilesApp, files: readonly OfficeFile[], max = START_RECENT_MAX): StartRecent[] {
  return files
    .filter(f => f.kind === app.kind && !f.deletedAt)
    .slice()
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    .slice(0, max)
    .map(f => ({ id: f.id, name: f.name, updatedAt: f.updatedAt, updatedByName: f.updatedByName ?? null, containsPhi: f.containsPhi === true }));
}

/** What `<prefix>home` carries. No templates and no New when the person may not create (View only lab, phone view-only, role without edit). */
export function buildHome(app: FilesApp, files: readonly OfficeFile[], settings: OfficeSettings | null | undefined, o: { canCreate: boolean; placeName: string }): { home: StartHome; templates: FilesTemplate[] } {
  const templates = o.canCreate ? startTemplates([app], settings) : [];
  const out: StartTemplate[] = templates.map(t => ({ id: t.id, name: t.name, source: t.own ? 'lab' : 'builtin' }));
  return { home: { recent: recentFor(app, files), templates: out, canCreate: o.canCreate, canOpenDevice: true, placeName: o.placeName }, templates };
}
