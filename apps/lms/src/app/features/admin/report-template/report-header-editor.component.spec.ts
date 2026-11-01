import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReportHeaderEditorComponent } from './report-header-editor.component';
import { DialogService } from '../../../core/services/dialog.service';
import { HttpClient } from '@angular/common/http';
import { PlatformService } from '../../../core/services/platform.service';
import { ReportTemplate } from '../../../shared/models/report.model';
import { MARGIN_X, MM, PAGE, addBackground, readHeaderLayout, setItem, writeHeaderLayout } from '../../../shared/utils/report-header-layout';

/**
 * Report designer — letterhead editor interactions: the outlines come from
 * the same layout the PDF is drawn with; clicking one selects it; arrow keys
 * nudge it (and stop on a guide); reset forgets the element; text edits turn
 * the edited layout on; old templates stay untouched until the lab edits.
 */
const BASE: ReportTemplate = {
  id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate | Caring | Instant',
  address: '14 Gandhi Road, Chennai 600017', phone: '+91 98400 12345', email: 'lab@microworld.in',
  website: 'www.microworld.in', logoUrl: '', nablAccredited: false, headerPreset: 'classic', logoPosition: 'left',
  logoSize: 'md', topAccentBar: true, primaryColor: '#1B3A6B', accentColor: '#0066CC',
  showPatientName: true, showAge: true, showRefDoctor: true, showOrderId: true, showAbhaId: false, showQrCode: true,
  showCollectionDate: true, showReportDate: true, showMethod: false, showInstrument: false, groupByDepartment: false,
  showCriticalFlag: true, showPathologistName: true, showSignature: true, showPoweredBy: true,
  disclaimer: 'Test results should be correlated clinically.', footerText: '',
} as ReportTemplate;

function make(t: Partial<ReportTemplate> = {}, region: 'header' | 'footer' = 'header') {
  const dialog = { confirm: vi.fn(async () => true), choose: vi.fn(async () => 'fresh') };
  TestBed.configureTestingModule({ providers: [
    { provide: DialogService, useValue: dialog },
    { provide: HttpClient, useValue: {} },
    { provide: PlatformService, useValue: { getApiUrl: () => '' } },
  ] });
  const f = TestBed.createComponent(ReportHeaderEditorComponent);
  let tpl: ReportTemplate = { ...BASE, ...t };
  const patches: Array<Partial<ReportTemplate>> = [];
  f.componentRef.setInput('template', tpl);
  f.componentRef.setInput('region', region);
  const c = f.componentInstance;
  // Behave like the parent: apply each patch and feed the template back.
  c.patch.subscribe(p => { patches.push(p); tpl = { ...tpl, ...p }; f.componentRef.setInput('template', tpl); });
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const boxes = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.pf-rhe-box'));
  const boxFor = (label: string) => boxes().find(b => (b.getAttribute('aria-label') ?? '').startsWith(label))!;
  const cfg = () => readHeaderLayout(tpl);
  const item = (id: string) => c.layout().items.find(i => i.id === id)!;
  return { f, c, el, boxes, boxFor, patches, cfg, item, dialog, tpl: () => tpl };
}

/** Pointer events for the drag handlers (jsdom has no PointerEvent ctor). */
function ptr(target: HTMLElement, x: number, y: number) {
  return { button: 0, clientX: x, clientY: y, pointerId: 1, altKey: false, currentTarget: target, target,
    stopPropagation() {}, preventDefault() {} } as unknown as PointerEvent;
}
function fire(target: HTMLElement, type: string, x: number, y: number, altKey = false) {
  const e = new Event(type) as Event & { clientX: number; clientY: number; altKey: boolean };
  e.clientX = x; e.clientY = y; e.altKey = altKey;
  target.dispatchEvent(e);
}
/** A small header image (a logo-sized background) at 120 mm, 10 mm. */
const withImage = () => {
  const cfg = addBackground(null, '/uploads/t/logo.png', 'img', 'header');
  cfg.backgrounds![0] = { ...cfg.backgrounds![0], scale: 20, x: 120, y: 10 };
  return { metadata: writeHeaderLayout(BASE, cfg) };
};

describe('Report designer — smart guides (one shared snap engine)', () => {
  it('dragging a text element near an image lines its left edge up with the image, with a guide', () => {
    const p = make(withImage());
    const img = p.c.layout().backgrounds[0].box;
    const it = p.item('address');
    const el = p.boxFor('Address');
    const s = p.c.scale();
    p.c.select('address');
    p.c.onBoxPointerDown(ptr(el, 0, 0), it);
    const dx = (img.x + 1.2 - it.box.x) * s;                // 1.2 pt short of the image's left edge
    fire(el, 'pointermove', dx, 0);
    expect(p.c.smart().lines.some(l => l.axis === 'v' && Math.abs(l.pos - img.x) < 0.01)).toBe(true);
    fire(el, 'pointerup', dx, 0);
    expect(p.item('address').box.x).toBeCloseTo(img.x, 1);
    expect(p.c.smart().lines).toEqual([]);                    // guides go when the drag ends
  });

  it('snaps on the y axis too: an element\'s top to the image\'s top', () => {
    const p = make(withImage());
    const img = p.c.layout().backgrounds[0].box;
    const it = p.item('address');
    const el = p.boxFor('Address');
    const s = p.c.scale();
    p.c.select('address');
    p.c.onBoxPointerDown(ptr(el, 0, 0), it);
    const dx = (img.x - 80 - it.box.x) * s, dy = (img.y + 0.2 - it.box.y) * s;
    fire(el, 'pointermove', dx, dy);
    expect(p.c.smart().lines.some(l => l.axis === 'h' && Math.abs(l.pos - img.y) < 0.01)).toBe(true);
    fire(el, 'pointerup', dx, dy);
    expect(p.item('address').box.y).toBeCloseTo(img.y, 1);
  });

  it('the image itself snaps to a text element (images are movers as well as targets)', () => {
    const p = make(withImage());
    const bg = p.c.layout().backgrounds[0];
    const name = p.item('name');
    const el = p.el.querySelector<HTMLElement>('.pf-rhe-box--bgimg')!;
    const s = p.c.scale();
    p.c.select('bg:img');
    p.c.onBgPointerDown(ptr(el, 0, 0), bg);
    const dy = (name.box.y + 0.2 - bg.box.y) * s;
    fire(el, 'pointermove', 0, dy);
    fire(el, 'pointerup', 0, dy);
    expect(p.c.layout().backgrounds[0].box.y).toBeCloseTo(name.box.y, 1);
  });

  it('hold Alt (Option) while dragging: no snapping, no guides', () => {
    const p = make(withImage());
    const img = p.c.layout().backgrounds[0].box;
    const it = p.item('address');
    const el = p.boxFor('Address');
    const s = p.c.scale();
    p.c.select('address');
    p.c.onBoxPointerDown(ptr(el, 0, 0), it);
    const dx = (img.x + 1.2 - it.box.x) * s;
    fire(el, 'pointermove', dx, 0, true);
    expect(p.c.smart().lines).toEqual([]);
    fire(el, 'pointerup', dx, 0, true);
    expect(p.item('address').box.x).toBeCloseTo(img.x + 1.2, 1);
  });

  it('an arrow nudge stops on the image\'s edge', () => {
    const p = make(withImage());
    const img = p.c.layout().backgrounds[0].box;
    p.c.select('address');
    const w = p.item('address').box.w;
    // Put the address's right edge 1 mm short of the image's left edge, then nudge 5 mm right.
    p.c.setOverride({ x: (img.x - w - 1 * MM) / MM });
    p.c.step.set(5);
    p.c.nudge(5, 0);
    expect(p.item('address').box.x + w).toBeCloseTo(img.x, 1);
  });

  it('the hint tells people about Alt', () => {
    const p = make();
    p.c.select('address'); p.f.detectChanges();
    expect(p.el.textContent).toContain('hold Alt (Option) while dragging');
  });
});

describe('Report designer — letterhead editor', () => {
  it('outlines every letterhead element from the resolved layout', () => {
    const p = make();
    const labels = p.boxes().map(b => b.getAttribute('aria-label'));
    for (const l of ['Logo', 'Lab name', 'Tagline', 'Phone', 'Email', 'Address', 'Accent bar', 'Website']) {
      expect(labels.some(x => x?.startsWith(l))).toBe(true);
    }
    // The outline sits where the element prints (pt × scale).
    const addr = p.item('address');
    const b = p.boxFor('Address');
    const s = p.c.scale();
    expect(parseFloat(b.style.left)).toBeCloseTo(addr.box.x * s - 2 - (Math.max(addr.box.w * s, 10) - addr.box.w * s) / 2, 1);
  });

  it('clicking an element on the page selects it and opens its controls', () => {
    const p = make();
    p.boxFor('Address').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    p.f.detectChanges();
    expect(p.c.selected()).toBe('address');
    expect(p.boxFor('Address').classList.contains('pf-rhe-box--sel')).toBe(true);
    expect(p.el.querySelector('.pf-rhe-side .pf-card__label')?.textContent).toContain('Address');
    expect(p.el.querySelector('textarea')).not.toBeNull();       // multi-line address
    expect(p.el.textContent).toContain('Under the lab name');
  });

  it('an untouched template stays untouched until something is edited', () => {
    const p = make();
    expect(p.cfg()).toBeNull();
    p.c.select('address');
    p.f.detectChanges();
    expect(p.patches).toEqual([]);
  });

  it('arrow keys nudge the selected element by the step (Shift = 5 mm)', () => {
    // The footer disclaimer: nothing below it to stop on, so every step is whole.
    const p = make({}, 'footer');
    p.c.select('disclaimer');
    const y0 = p.item('disclaimer').y;
    const page = p.el.querySelector<HTMLElement>('.pf-rhe-page')!;
    page.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(p.item('disclaimer').y - y0).toBeCloseTo(1 * MM, 1);
    page.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    expect(p.item('disclaimer').y - y0).toBeCloseTo(6 * MM, 1);
    expect(p.cfg()!.items['disclaimer'].y).toBeCloseTo((y0 + 6 * MM) / MM, 1);
  });

  it('a nudge across the left margin stops on it', () => {
    const p = make();
    p.c.select('address');
    p.c.step.set(5);
    const left0 = p.item('address').box.x;           // on the margin already (Classic)
    expect(left0).toBeCloseTo(MARGIN_X, 3);
    p.c.nudge(3, 0);                                   // move right first
    p.c.nudge(-5, 0);                                  // back across the margin → stops on it
    expect(p.item('address').box.x).toBeCloseTo(MARGIN_X, 1);   // stored to 0.01 mm
    expect(p.c.smart().lines.some(l => l.axis === 'v' && Math.abs(l.pos - MARGIN_X) < 0.01)).toBe(true);
  });

  it('alignment re-anchors to that edge; the exact mm field moves it', () => {
    const p = make();
    p.c.select('address');
    p.c.setAlign('right');
    const it = p.item('address');
    expect(it.box.x + it.box.w).toBeCloseTo(PAGE.w - MARGIN_X, 2);
    p.c.setH('10');                                     // 10 mm in from the right margin
    const moved = p.item('address');
    expect(PAGE.w - MARGIN_X - (moved.box.x + moved.box.w)).toBeCloseTo(10 * MM, 1);
    p.c.setV('20');
    expect(p.item('address').box.y).toBeCloseTo(20 * MM, 1);
  });

  it('size slider sets logo height in mm and font size in pt', () => {
    const p = make();
    p.c.select('logo');
    p.c.setSize(18);
    expect(p.item('logo').h).toBeCloseTo(18 * MM, 3);
    p.c.select('name');
    p.c.setSize(99);                                    // clamped to the slider max
    expect(p.item('name').size).toBe(36);
  });

  it('reset forgets only that element; reset-all asks first and clears the layout', async () => {
    const p = make();
    p.c.select('phone'); p.c.nudge(0, 2);
    p.c.select('email'); p.c.nudge(0, 2);
    p.c.select('phone'); p.c.resetSelected();
    expect(p.cfg()!.items['phone']).toBeUndefined();
    expect(p.cfg()!.items['email']).toBeTruthy();
    await p.c.resetAll();
    expect(p.dialog.confirm).toHaveBeenCalled();
    expect(p.cfg()).toBeNull();
  });

  it('typing the address turns the edited layout on and keeps the line breaks', () => {
    const p = make();
    p.c.setText('address', 'Line one\nLine two');
    expect(p.cfg()).toEqual({ v: 1, items: {} });
    expect(p.item('address').lines).toEqual(['Line one', 'Line two']);
  });

  it('shows a warning with a one-click fix when text runs past the margin', () => {
    const long = 'Reg. No. TN/1234 · GSTIN 33ABCDE1234F1Z5 · Registered office: 14 Gandhi Road, T. Nagar, Chennai 600017, Tamil Nadu, India · CIN U85100TN2019PTC123456';
    const p = make({ footerText: long }, 'footer');
    p.c.select('footerText');
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-rhe-issues')?.textContent).toContain('past the right margin');
    p.el.querySelector<HTMLButtonElement>('.pf-rhe-fix')!.click();
    expect(p.c.issuesFor('footerText').some(i => i.kind === 'overflow')).toBe(false);
    expect(p.item('footerText').lines!.length).toBeGreaterThan(1);
  });

  it('hiding an element keeps it listed (and outlined as hidden) but it stops printing', () => {
    const p = make();
    const email = p.c.entries().find(e => e.id === 'email')!;
    p.c.toggleEntry(email);
    p.f.detectChanges();
    expect(p.item('email').hidden).toBe(true);
    expect(p.boxFor('Email').classList.contains('pf-rhe-box--hidden')).toBe(true);
    expect(p.c.entries().find(e => e.id === 'email')!.state).toBe('hidden');
  });

  it('a field joined into one line can move to its own line (Banner)', () => {
    const p = make({ headerPreset: 'banner' });
    expect(p.c.entries().find(e => e.id === 'address')!.state).toBe('joined');
    p.c.moveToOwnLine('address');
    expect(p.item('address')).toBeTruthy();
    expect(p.item('contact').fields).toEqual(['phone', 'email']);
    expect(p.c.selected()).toBe('address');
  });

  it('Banner: the band has the same print switch — off hides it, the name turns dark, on brings it back', () => {
    const p = make({ headerPreset: 'banner' });
    const sw = () => Array.from(p.el.querySelectorAll<HTMLButtonElement>('.pf-rhe-li__sw'))
      .find(b => b.getAttribute('aria-label') === 'Print Banner')!;
    expect(sw()).toBeTruthy();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(p.el.querySelector('.pf-rhe-thumb--nobanner')).toBeNull();
    sw().click();
    p.f.detectChanges();
    expect(p.cfg()!.items['banner']?.hidden).toBe(true);
    expect(p.item('banner').hidden).toBe(true);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(p.c.entries().find(e => e.id === 'banner')!.value).toContain('dark ink');
    expect(p.item('name').color).not.toBe('#ffffff');
    // The style picker's Banner thumbnail shows the band off too.
    expect(p.el.querySelector('.pf-rhe-thumb--banner.pf-rhe-thumb--nobanner')).not.toBeNull();
    // Its own card has the switch as well (it was suppressed for the band).
    p.c.select('banner');
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-rhe-side .pf-toggle[aria-label="Print Banner"]')).not.toBeNull();
    (p.el.querySelector('.pf-rhe-side .pf-toggle[aria-label="Print Banner"]') as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.item('banner').hidden).toBeFalsy();
    expect(p.item('name').color).toBe('#ffffff');
  });

  it('switching style with moved elements asks whether to keep the positions', async () => {
    const p = make({ metadata: writeHeaderLayout(BASE, setItem(null, 'address', { x: 50, y: 30, size: 9 })) });
    await p.c.setPreset('centered');
    expect(p.dialog.choose).toHaveBeenCalled();
    expect(p.tpl().headerPreset).toBe('centered');
    expect(p.cfg()!.items['address']).toEqual({ size: 9 });   // positions dropped, size kept
  });

  it('free text lines can be added and edited', () => {
    const p = make();
    p.c.addLine();
    const id = p.c.selected()!;
    expect(id.startsWith('line:')).toBe(true);
    p.c.setLineText(id, 'GSTIN 33ABCDE1234F1Z5');
    expect(p.item(id).text).toBe('GSTIN 33ABCDE1234F1Z5');
  });

  // ── background images ──
  const BGURL = '/uploads/00000000-0000-0000-0000-000000000001/bg.jpg';
  const pick = (file: File) => ({ target: { files: [file], value: 'x' } } as unknown as Event);

  it('background upload: refuses SVG / GIF / oversized files with a clear message, uploads nothing', async () => {
    const p = make();
    const up = vi.spyOn(p.c as never as { uploadBlob: () => Promise<string> }, 'uploadBlob');
    await p.c.onBgPick(pick(new File(['<svg/>'], 'art.svg', { type: 'image/svg+xml' })));
    expect(p.c.bgError()).toMatch(/SVG/);
    await p.c.onBgPick(pick(new File(['x'], 'a.gif', { type: 'image/gif' })));
    expect(p.c.bgError()).toMatch(/PNG, JPG or WebP/);
    const big = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 20 * 1048576 });
    await p.c.onBgPick(pick(big));
    expect(p.c.bgError()).toMatch(/20\.0 MB — pick one under 15 MB/);
    expect(up).not.toHaveBeenCalled();
    expect(p.cfg()).toBeNull();
  });

  it('background upload: shrinks, uploads privately, adds a full-page background and selects it', async () => {
    const p = make();
    const c = p.c as never as { shrinkImage: () => Promise<unknown>; uploadBlob: () => Promise<string> };
    vi.spyOn(c, 'shrinkImage').mockResolvedValue({ blob: new Blob(['j']), ext: 'jpg' });
    const up = vi.spyOn(c, 'uploadBlob').mockResolvedValue(BGURL);
    await p.c.onBgPick(pick(new File(['x'], 'letterhead.jpg', { type: 'image/jpeg' })));
    expect(up).toHaveBeenCalledWith(expect.any(Blob), 'background.jpg');
    expect(p.cfg()!.backgrounds).toEqual([expect.objectContaining({ url: BGURL, area: 'page', fit: 'cover', opacity: 1, pages: 'first' })]);
    expect(p.c.selected()).toBe('bg:' + p.cfg()!.backgrounds![0].id);
    p.f.detectChanges();
    expect(p.el.textContent).toContain('Also print on letterhead paper');
    expect(p.el.querySelector('.pf-rhe-box--bgimg.pf-rhe-box--sel')).not.toBeNull();
  });

  it('background upload: an image still over 5 MB after shrinking is refused', async () => {
    const p = make();
    const c = p.c as never as { shrinkImage: () => Promise<unknown>; uploadBlob: () => Promise<string> };
    const blob = new Blob(['x']); Object.defineProperty(blob, 'size', { value: 6 * 1048576 });
    vi.spyOn(c, 'shrinkImage').mockResolvedValue({ blob, ext: 'png' });
    const up = vi.spyOn(c, 'uploadBlob');
    await p.c.onBgPick(pick(new File(['x'], 'a.png', { type: 'image/png' })));
    expect(p.c.bgError()).toMatch(/6\.0 MB/);
    expect(up).not.toHaveBeenCalled();
  });

  it('background: opacity / pages / letterhead-paper switch / nudge / remove', async () => {
    const p = make({ metadata: writeHeaderLayout(BASE, addBackground(null, BGURL, 'b1')) });
    p.c.select('bg:b1');
    p.c.setBgOpacity('b1', 20);
    p.c.patchBg('b1', { pages: 'all', onLetterhead: true });
    expect(p.cfg()!.backgrounds![0]).toEqual(expect.objectContaining({ opacity: 0.2, pages: 'all', onLetterhead: true }));
    const x0 = p.c.layout().backgrounds[0].rect.x;
    const page = p.el.querySelector<HTMLElement>('.pf-rhe-page')!;
    page.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(p.c.layout().backgrounds[0].rect.x - x0).toBeCloseTo(1 * MM, 1);
    expect(p.c.layout().backgrounds[0].moved).toBe(true);
    await p.c.removeBg('b1');
    expect(p.dialog.confirm).toHaveBeenCalled();
    expect(p.cfg()!.backgrounds).toBeUndefined();
    expect(p.c.selected()).toBeNull();
  });
});
