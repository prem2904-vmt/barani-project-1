import type { NavItem } from '../../layout/nav-items';
import { FILES_APPS, FILES_NAME, FILES_NAV_ID, FilesApp } from './files-registry';
import { filesStartPath } from './files-start';
import type { FilesAccessService } from './files-access.service';

/** A plain stroked folder: the bar icon of the Files screen itself (never a branded mark). */
export const FILES_ICON: string[] = ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'];

export const FILES_NAV: NavItem = { id: FILES_NAV_ID, label: FILES_NAME, href: '/files', exact: true, iconPath: FILES_ICON };
/** The apps read "Neuron · sheets" on the Start menu's plain list (same row style as every other screen). */
const PLAIN: Record<string, string> = { sheet: 'sheets', doc: 'documents', slides: 'slides', pdf: 'PDFs', image: 'images' };

/** An app's Start-menu / bar item: its logo, its name, and ITS OWN start screen (`/files/<kind>/start`: New, templates, Recent, Open). */
export const filesAppNav = (a: FilesApp): NavItem => ({ id: a.navId, label: a.name, menuLabel: `${a.name} · ${PLAIN[a.kind] ?? a.nounPlural}`, href: filesStartPath(a), iconPath: FILES_ICON, logo: a.id });

/**
 * Everything Files adds to the Start menu as pinnable items: the Files screen and one item per app this person may open. Pins never grant
 * access: an app that is off for the lab, or not allowed for the role, is simply not in this list (so a pin to it is dropped silently by
 * nav-pins). View only labs get the same items (they can open and copy).
 */
export function filesNavItems(access: Pick<FilesAccessService, 'available' | 'apps'>): NavItem[] {
  if (!access.available()) return [];
  const apps = access.apps();
  if (!apps.length) return [];
  return [FILES_NAV, ...apps.map(filesAppNav)];
}
export const ALL_FILES_NAV_IDS: readonly string[] = [FILES_NAV_ID, ...FILES_APPS.map(a => a.navId)];

/** Words that find a Files item in the Start menu search (besides its name): "sheets" and "office" find Neuron and Files, "pdf" finds Myelin… */
export const FILES_SEARCH_WORDS: Readonly<Record<string, readonly string[]>> = {
  files: ['files', 'office', 'all files', 'documents', 'trash'],
  'files-neuron': ['sheet', 'sheets', 'spreadsheet', 'excel', 'office', 'xlsx', 'results log'],
  'files-synapse': ['document', 'documents', 'word', 'docs', 'letter', 'office', 'docx', 'sop'],
  'files-axon': ['slide', 'slides', 'presentation', 'powerpoint', 'deck', 'office', 'pptx'],
  'files-myelin': ['pdf', 'pdfs', 'sign', 'fill', 'merge', 'redact'],
  'files-retina': ['image', 'images', 'photo', 'photos', 'picture', 'png', 'jpg', 'annotate'],
};
