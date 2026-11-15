import { FILES_APPS, FILES_NAME, bytesFit, extOf, extensionAllowed, filesApp, filesAppForKind, filesAppForNavId, filesAppForRoute, isFilesNavId, sniff, stemOf, withAppExtension } from './files-registry';
import { ALL_FILES_NAV_IDS, FILES_ICON, FILES_NAV, filesAppNav, filesNavItems } from './files-nav';

const u8 = (...b: number[]) => new Uint8Array(b).buffer as ArrayBuffer;
const PK = u8(0x50, 0x4b, 3, 4, 1), PDF = u8(0x25, 0x50, 0x44, 0x46, 0x2d, 49), PNG = u8(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10), JPG = u8(0xff, 0xd8, 0xff, 0xe0), TXT = u8(104, 105, 33, 33, 33);
const WEBP = u8(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);

describe('Files registry: adding an app is ONE entry', () => {
  it('the place is called Files (one constant) and the five apps are Neuron, Synapse, Axon, Myelin, Retina', () => {
    expect(FILES_NAME).toBe('Files');
    expect(FILES_APPS.map(a => a.name)).toEqual(['Neuron', 'Synapse', 'Axon', 'Myelin', 'Retina']);
    expect(FILES_APPS.map(a => a.kind)).toEqual(['sheet', 'doc', 'slides', 'pdf', 'image']);
  });

  it('every id, kind, route, bar id, prefix, global and engine folder is unique and consistent', () => {
    for (const key of ['id', 'kind', 'route', 'navId', 'prefix', 'global', 'enginePath', 'color'] as const) expect(new Set(FILES_APPS.map(a => a[key])).size, key).toBe(FILES_APPS.length);
    for (const a of FILES_APPS) {
      expect(a.prefix).toBe(`${a.id}:`);
      expect(a.global).toBe(a.id);
      expect(a.enginePath).toBe(`${a.id}-engine/`);
      expect(a.navId).toBe(`files-${a.id}`);
      expect(a.route).toBe(a.kind);
      expect(a.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(a.colorDark).toMatch(/^#[0-9a-f]{6}$/i);
      expect(a.logo.length).toBeGreaterThan(1);
      expect(a.logoSmall.length).toBeGreaterThan(0);
      expect(a.exts.length).toBeGreaterThan(0);
    }
  });

  it('the brand colours are the owner\'s', () => {
    const c = Object.fromEntries(FILES_APPS.map(a => [a.id, [a.color, a.colorDark]]));
    expect(c['neuron']).toEqual(['#0e8a5f', '#16a372']);
    expect(c['synapse']).toEqual(['#2563eb', '#3b7bf6']);
    expect(c['axon']).toEqual(['#d9480f', '#ef5a1c']);
    expect(c['myelin']).toEqual(['#b4235a', '#d6336c']);
    expect(c['retina']).toEqual(['#0f766e', '#14b8a6']);
  });

  it('no forbidden product word and no "AI" appears anywhere in the registry\'s text', () => {
    const text = JSON.stringify(FILES_APPS.map(a => ({ ...a, logo: undefined, logoSmall: undefined })));
    expect(text).not.toMatch(/gridcraft|wordcraft|deckcraft|pdfcraft|artcraft|storytold|prefrontal office/i);
    expect(text).not.toMatch(/\bAI\b/);
  });

  it('lookups by id, kind, route and bar id', () => {
    expect(filesApp('axon')?.kind).toBe('slides');
    expect(filesAppForKind('pdf')?.name).toBe('Myelin');
    expect(filesAppForRoute('image')?.name).toBe('Retina');
    expect(filesAppForNavId('files-synapse')?.id).toBe('synapse');
    expect(filesApp('nope')).toBeUndefined();
    expect(isFilesNavId('files')).toBe(true);
    expect(isFilesNavId('files-retina')).toBe(true);
    expect(isFilesNavId('lab')).toBe(false);
  });

  it('extensions: each app takes its own types only; names get the app\'s extension', () => {
    const [neuron, synapse, , myelin, retina] = FILES_APPS;
    expect(extOf('QC.XLSX')).toBe('xlsx'); expect(extOf('noext')).toBe('');
    expect(extensionAllowed(neuron, 'a.xlsx')).toBe(true);
    expect(extensionAllowed(neuron, 'a.docx')).toBe(false);
    expect(extensionAllowed(retina, 'a.jpeg')).toBe(true);
    expect(extensionAllowed(myelin, 'a.png')).toBe(false);
    expect(withAppExtension(synapse, 'Letter')).toBe('Letter.docx');
    expect(withAppExtension(synapse, 'Letter.docx')).toBe('Letter.docx');
    expect(withAppExtension(synapse, 'Letter.xlsx')).toBe('Letter.xlsx.docx');
    expect(withAppExtension(synapse, '')).toBe('Untitled document.docx');
    expect(stemOf('a.b.xlsx')).toBe('a.b');
  });

  it('magic bytes decide, never the name', () => {
    const [neuron, synapse, axon, myelin, retina] = FILES_APPS;
    expect([sniff(PK), sniff(PDF), sniff(PNG), sniff(JPG), sniff(WEBP), sniff(TXT), sniff(null)]).toEqual(['zip', 'pdf', 'png', 'jpg', 'webp', 'other', 'other']);
    for (const a of [neuron, synapse, axon]) { expect(bytesFit(a, PK)).toBe(true); expect(bytesFit(a, PDF)).toBe(false); expect(bytesFit(a, PNG)).toBe(false); }
    expect(bytesFit(myelin, PDF)).toBe(true); expect(bytesFit(myelin, PK)).toBe(false); expect(bytesFit(myelin, TXT)).toBe(false);
    for (const img of [PNG, JPG, WEBP]) expect(bytesFit(retina, img)).toBe(true);
    expect(bytesFit(retina, PDF)).toBe(false);
  });
});

describe('Files nav items', () => {
  it('Files itself is a plain stroked folder, the apps carry their logo and "Neuron · sheets" wording for the Start menu only', () => {
    expect(FILES_NAV).toMatchObject({ id: 'files', label: 'Files', href: '/files', iconPath: FILES_ICON });
    expect(FILES_NAV.logo).toBeUndefined();
    const n = filesAppNav(FILES_APPS[0]);
    expect(n).toMatchObject({ id: 'files-neuron', label: 'Neuron', menuLabel: 'Neuron · sheets', logo: 'neuron', href: '/files?type=sheet' });
    expect(filesAppNav(FILES_APPS[3]).menuLabel).toBe('Myelin · PDFs');
    expect(filesAppNav(FILES_APPS[4]).menuLabel).toBe('Retina · images');
    expect(ALL_FILES_NAV_IDS).toEqual(['files', 'files-neuron', 'files-synapse', 'files-axon', 'files-myelin', 'files-retina']);
  });

  it('nothing is offered while Files is unavailable or no app opens; otherwise Files + exactly the allowed apps', () => {
    const acc = (available: boolean, ids: string[]) => ({ available: () => available, apps: () => FILES_APPS.filter(a => ids.includes(a.id)) });
    expect(filesNavItems(acc(false, ["neuron"]) as never)).toEqual([]);
    expect(filesNavItems(acc(true, []) as never)).toEqual([]);
    expect(filesNavItems(acc(true, ["synapse", "retina"]) as never).map(i => i.id)).toEqual(['files', 'files-synapse', 'files-retina']);
  });

  it('each template command uses the names the engines really have (probed on the shipped builds)', () => {
    const cmds = Object.fromEntries(FILES_APPS.flatMap(a => a.templates.map(t => [t.id, t.cmd!.params])));
    expect(cmds['synapse:letter']).toEqual({ template: 'letterhead' });
    expect(cmds['synapse:sop']).toEqual({ template: 'sop' });
    expect(cmds['axon:case']).toEqual({ template: 'Case presentation' });
    expect(cmds['axon:review']).toEqual({ template: 'Monthly quality review' });
    expect(cmds['neuron:qc']).toEqual({ sample: 'qc' });
  });

  it('Myelin needs control=1; Retina keeps its project files (.pcraft / .retina) as they are, judged by the extension', () => {
    const [, , , myelin, retina] = FILES_APPS;
    expect(myelin.frameParams).toEqual({ control: '1' });
    expect(extensionAllowed(retina, 'Case.pcraft')).toBe(true);
    expect(extensionAllowed(retina, 'Case.retina')).toBe(true);
    const junk = u8(123, 34, 108, 97);                                 // not a picture
    expect(bytesFit(retina, junk)).toBe(false);
    expect(bytesFit(retina, junk, 'Case.pcraft')).toBe(true);
    expect(bytesFit(retina, junk, 'Case.png')).toBe(false);
    expect(bytesFit(retina, new ArrayBuffer(0), 'Case.pcraft')).toBe(false);
    expect(bytesFit(FILES_APPS[0], junk, 'Case.pcraft')).toBe(false);   // only Retina has project files
  });
});
