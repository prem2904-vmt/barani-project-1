import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PatientRegisterComponent } from './patient-register.component';
import { PATIENT_REGISTER_ND_STYLES } from './patient-register.nd.styles';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderEntryService } from '../../../core/services/order-entry.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ThemeService } from '../../../core/services/theme.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';

/**
 * Patient registration — NEW DESIGN (PF-PATTERN §15: ONE single form, no
 * tabs, keyboard-first). Band = back · tenant · actions with ONE primary;
 * the pill = the patient's name only; every section is a card on the same
 * screen (3 / 2 / 1 columns); Enter walks the fields and submits on the
 * last; Title / Sex are keyboard-operable segments; errors are field-level;
 * opened from Order & Payments it returns there with the patient attached.
 */
import { WorkflowRendererComponent } from '../../../shared/components/workflow-renderer/workflow-renderer.component';

/** The seeded Micro World form (WorkflowSeeder.PatientRegistration). */
const CONFIG = {
  id: 'cfg', name: 'patient_registration', title: 'Patient Registration', module: 'lms',
  screenName: 'patient_registration', version: 1, status: 'published', globalConditions: [], actions: [],
  steps: [
    {
      id: 'st1', name: 'basic_info', title: 'Basic Info', type: 'entry', isRequired: true, canSkip: false, isStandard: true,
      fields: [
        { id: 'f0', name: 'title', title: 'Title', type: 'button_select', isStandard: true, isRequired: false, isEditable: true, storageKey: 'title', width: 'full',
          options: ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Master', 'Baby'].map(v => ({ value: v, label: v })) },
        { id: 'f1', name: 'first_name', title: 'First name', type: 'text', isStandard: true, isRequired: true, isEditable: true, storageKey: 'first_name', width: 'half' },
        { id: 'f2', name: 'fathers_name', title: 'Last name', type: 'text', isStandard: true, isRequired: true, isEditable: true, storageKey: 'fathers_name', width: 'half' },
        { id: 'f3', name: 'phone', title: 'Phone', type: 'phone', isStandard: true, isRequired: true, isEditable: true, storageKey: 'phone', width: 'half' },
        { id: 'f4', name: 'date_of_birth', title: 'Date of birth', type: 'date', isStandard: true, isRequired: false, isEditable: true, storageKey: 'date_of_birth', width: 'half' },
        { id: 'f5', name: 'sex', title: 'Sex', type: 'select', isStandard: true, isRequired: true, isEditable: true, storageKey: 'sex', width: 'half',
          options: ['Male', 'Female', 'Other'].map(v => ({ value: v, label: v })) },
        { id: 'f6', name: 'abha_id', title: 'ABHA ID', type: 'text', isStandard: true, isRequired: false, isEditable: true, storageKey: 'abha_id', width: 'half' },
        { id: 'f7', name: 'aadhaar_last4', title: 'Aadhaar (last 4)', type: 'text', isStandard: true, isRequired: false, isEditable: true, storageKey: 'aadhaar_last4', width: 'half' },
      ],
    },
    {
      id: 'st2', name: 'additional_info', title: 'Additional details', type: 'entry', isRequired: false, canSkip: true, isStandard: true,
      fields: [
        { id: 'f8', name: 'email', title: 'Email', type: 'email', isStandard: true, isRequired: false, isEditable: true, storageKey: 'email', width: 'half' },
        { id: 'f9', name: 'blood_group', title: 'Blood group', type: 'select', isStandard: true, isRequired: false, isEditable: true, storageKey: 'blood_group', width: 'half',
          options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(v => ({ value: v, label: v })) },
        { id: 'f10', name: 'occupation', title: 'Occupation', type: 'text', isStandard: false, isRequired: false, isEditable: true, storageKey: 'metadata.occupation', width: 'half' },
      ],
    },
  ],
};

const PATIENT = { id: 'p-1', displayName: 'Mr. Arun Kumar', mrn: 'AA0042', firstName: 'Arun', fathersName: 'Kumar', title: 'Mr.',
  sex: 'Male', phone: '+919876543210', dateOfBirth: '1990-05-15T00:00:00Z' };

function render(opts: { nd?: boolean; patientId?: string; post?: any; returnTo?: string; web?: boolean; tenantPhone?: string; config?: unknown; patient?: unknown } = {}) {
  (window as any).matchMedia = () => ({ matches: opts.web ?? false, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/workflows/patient_registration') return of({ configJson: JSON.stringify(opts.config ?? CONFIG), version: 3 });
      if (url.startsWith('/api/patients/')) return of({ patient: opts.patient ?? PATIENT, history: [] });
      return of([]);
    }),
    post: vi.fn(opts.post ?? (() => of({ id: 'p-new', displayName: 'Mr. Ravi Shankar', mrn: 'AA0100' }))),
    patch: vi.fn(() => of({ ...PATIENT })),
  };
  const router = { navigate: vi.fn(async () => true), navigateByUrl: vi.fn(async () => true), url: '/frontdesk/patients/new', events: of() };
  const orderEntry = { startNewOrder: vi.fn(async () => true) };
  const dialog = { confirm: vi.fn(async () => true) };
  const toasts = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  const q: Array<[string, string]> = [];
  if (opts.patientId) q.push(['patientId', opts.patientId]);
  if (opts.returnTo) q.push(['returnTo', opts.returnTo]);
  TestBed.configureTestingModule({
    imports: [PatientRegisterComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ApiService, useValue: api },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantId: 't1', tenantName: 'Micro World', permissions: [] }), hasPermission: () => true } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: { backTo: vi.fn(), back: vi.fn(), showBack: () => true } },
      { provide: OrderEntryService, useValue: orderEntry },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map(q) } } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => opts.nd ?? true } },
      { provide: TenantStateService, useValue: { tenant: () => (opts.tenantPhone ? { phone: opts.tenantPhone } : null) } },
    ],
  });
  const f = TestBed.createComponent(PatientRegisterComponent);
  f.detectChanges();
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const flush = async () => { await new Promise(r => setTimeout(r)); f.detectChanges(); };
  const type = (field: string, v: string) => {
    const input = el.querySelector<HTMLInputElement>(`[data-field="${field}"] input:not([type="number"])`)!;
    input.value = v;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  /** Title is a pf-select dropdown (c2d92a1b "title pf-select"): open the trigger, click the option in the listbox panel. */
  const openTitle = () => {
    document.body.querySelectorAll('.pf-dd__panel').forEach(n => n.remove());
    el.querySelector<HTMLButtonElement>('[data-field="title"] button.pf-dd__trigger')!.click();
    f.detectChanges();
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>('.pf-dd__panel [role="option"]'));
  };
  const titleOptions = () => {
    const opts = openTitle().map(o => o.textContent!.trim());
    el.querySelector<HTMLButtonElement>('[data-field="title"] button.pf-dd__trigger')!.click();   // toggle closed
    f.detectChanges();
    return opts;
  };
  const titleValue = () => el.querySelector('[data-field="title"] .pf-dd__value')?.textContent?.trim();
  const seg = (field: string, label: string) => {
    if (field === 'title') {
      openTitle().find(o => o.textContent!.trim() === label)!.click();
      f.detectChanges();
      return;
    }
    (Array.from(el.querySelectorAll<HTMLButtonElement>(`[data-field="${field}"] .pf-seg__item`)).find(b => b.textContent!.trim() === label))!.click();
    f.detectChanges();
  };
  const fillAll = () => {
    type('first_name', 'Ravi');
    type('fathers_name', 'Shankar');
    seg('sex', 'Male');
    type('phone', '9876543210');
  };
  const enter = (target: Element, extra: KeyboardEventInit = {}) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra }));
    f.detectChanges();
  };
  return { f, el, c: f.componentInstance as any, api, router, orderEntry, dialog, toasts, txt, flush, type, seg, fillAll, enter, titleOptions, titleValue };
}

describe('Patient registration — new design: ONE form', () => {

  it('band: back + ONE primary (Register patient); secondaries are ghosts; no page title', () => {
    const { el, txt } = render();
    const primaries = el.querySelectorAll('pf-hero-band .pf-hb__actions .pf-hb-btn--primary');
    expect(primaries.length).toBe(1);
    expect(txt(primaries[0])).toBe('Register patient');
    expect(el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary, .pf-btn-primary').length).toBe(1);
    const ghosts = Array.from(el.querySelectorAll('pf-hero-band .pf-hb-btn--ghost')).map(b => txt(b));
    expect(ghosts).toEqual(['Cancel', 'Save & Book test', 'Save & Book appointment']);
    expect(el.querySelector('pf-screen-header, h1')).toBeNull();
    const p = el.querySelector('.pf-reg-primary')!;
    expect(p.querySelector('svg')).not.toBeNull();
    expect(p.getAttribute('aria-label')).toBe('Register patient');
  });

  it('pill = the name chip ✎ … and the ABHA helpers at its right — no tabs, no fact chips', () => {
    const { el, txt } = render();
    const ctx = el.querySelector('pf-hero-band .pf-ctx')!;
    expect(txt(ctx.querySelector('.pf-reg-ctx__nametext'))).toBe('New patient');
    expect(Array.from(ctx.children).map(k => k.className.split(' ')[0])).toEqual(['pf-ctx__primary', 'pf-reg-ctx__abha']);
    const abha = Array.from(ctx.querySelectorAll('.pf-reg-ctx__abha button'));
    expect(abha.map(b => b.getAttribute('aria-label'))).toEqual(['Fill from ABHA', 'Create ABHA']);
    expect(abha.every(b => b.classList.contains('pf-btn--quiet') && !!b.querySelector('svg'))).toBe(true);
    expect(el.querySelector('[role="tablist"], [role="tab"], .pf-ctx__chip, .pf-reg-next')).toBeNull();
  });

  it('the pill is the STANDARD band-pill size (not full width): pf-hero-band [standardPill]', () => {
    const { el } = render();
    const pill = el.querySelector('pf-hero-band .pf-hb__search')!;
    expect(pill.classList.contains('pf-hb__search--ctx')).toBe(true);
    expect(pill.classList.contains('pf-hb__search--std')).toBe(true);
  });

  it('phones: the ABHA helpers are icons (labels kept for AT)', () => {
    const phone = PATIENT_REGISTER_ND_STYLES.slice(PATIENT_REGISTER_ND_STYLES.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.pf-reg-abha__t \{ position: absolute; width: 1px/);
    expect(phone).toMatch(/\.pf-reg-ctx__abha \.pf-btn--quiet \{ width: 40px/);
  });

  it('every section renders at once, as its own card with "N required"', () => {
    const { el, txt } = render();
    const cards = Array.from(el.querySelectorAll('.pf-wr-cards > .pf-wr-card.pf-card'));
    expect(cards.map(c => txt(c.querySelector('.pf-card__label')))).toEqual(['Patient identity', 'Contact & IDs', 'Additional details']);
    expect(cards.map(c => txt(c.querySelector('.pf-wr-card__note')))).toEqual(['3 required', '1 required', 'Optional']);
    for (const f of ['title', 'first_name', 'sex', 'date_of_birth', 'phone', 'abha_id', 'email', 'occupation']) {
      expect(el.querySelector(`[data-field="${f}"]`), f).not.toBeNull();
    }
  });

  it('the address / place field is shown in the Contact & IDs card, not under Patient identity (OPS-119)', () => {
    const cfg = JSON.parse(JSON.stringify(CONFIG));
    cfg.steps[1].fields.push({ id: 'f11', name: 'address', title: 'Address / place', type: 'text', isStandard: false, isRequired: false, isEditable: true, storageKey: 'metadata.address', width: 'full' });
    const { el } = render({ config: cfg });
    const cards = Array.from(el.querySelectorAll('.pf-wr-cards > .pf-wr-card.pf-card'));
    const inCard = (label: string) => cards.find(c => (c.querySelector('.pf-card__label')?.textContent ?? '').trim() === label)!;
    expect(inCard('Contact & IDs').querySelector('[data-field="address"]')).not.toBeNull();
    expect(inCard('Patient identity').querySelector('[data-field="address"]')).toBeNull();
    expect(inCard('Additional details').querySelector('[data-field="address"]')).toBeNull();
  });

  it('columns: 3 side by side from 1200px, 2 on tablets, 1 on phones; desktop fills without page scroll', () => {
    const css = ((WorkflowRendererComponent as any).ɵcmp.styles as string[]).join('\n').replace(/\s+/g, ' ');
    expect(css).toMatch(/\.pf-wr-cards\[[^\]]*\] ?\{ ?display: ?grid; ?grid-template-columns: ?minmax\(0, ?1fr\)/);
    expect(css).toMatch(/@media \(min-width: ?768px\) ?\{ ?\.pf-wr-cards\[[^\]]*\] ?\{ ?grid-template-columns: ?repeat\(2, ?minmax\(0, ?1fr\)\)/);
    expect(css).toMatch(/@media \(min-width: ?1200px\) ?\{ ?\.pf-wr-cards\[[^\]]*\] ?\{ ?grid-template-columns: ?repeat\(3, ?minmax\(0, ?1fr\)\)[^}]*height: ?100%/);
    expect(PATIENT_REGISTER_ND_STYLES).toMatch(/@media \(min-width: 1200px\)[^@]*\.pf-reg-body \{[^}]*overflow: hidden/);
  });

  it('tablet (2-column tier only): Additional details sits in the RIGHT column under Contact & IDs; desktop + phone untouched', () => {
    // Split every @media block of a stylesheet into { min, max, body } so the
    // test can ask "which placement rules apply at width W?".
    const blocks = (css: string) => {
      const out: Array<{ min: number; max: number; body: string }> = [];
      const re = /@media ([^{]+)\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        let depth = 1, i = re.lastIndex;
        for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
        const q = m[1];
        const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
        const max = Number(/max-width:\s*(\d+)px/.exec(q)?.[1] ?? Infinity);
        out.push({ min, max, body: css.slice(re.lastIndex, i - 1) });
      }
      return out;
    };
    const at = (w: number) => blocks(PATIENT_REGISTER_ND_STYLES).filter(b => w >= b.min && w <= b.max).map(b => b.body).join('\n');
    const placed = (w: number) => /data-step\$="__(identity|contact)"/.test(at(w));

    // Tablet widths (iPad portrait 768/820, iPad 11" landscape 1180): the
    // renderer is 2 columns there, and the cards are placed.
    for (const w of [768, 820, 1024, 1180, 1199]) {
      const css = at(w);
      expect(placed(w), `placed @${w}`).toBe(true);
      expect(css).toMatch(/\[data-step\$="__identity"\] \{ grid-column: 1; grid-row: 1 \/ span 2; \}/);
      expect(css).toMatch(/\[data-step\$="__contact"\] \{ grid-column: 2; grid-row: 1; \}/);
      // Additional details is NOT pinned: auto-placement drops it into the
      // one free cell — column 2, row 2 — directly under Contact & IDs.
      expect(css).toMatch(/grid-template-rows: auto 1fr/);
      expect(css).not.toMatch(/additional/i);
    }
    // Desktop (3 columns from 1200px, incl. iPad 13" landscape at 1366) and
    // phones (1 column below 768px) get NO placement rules at all.
    for (const w of [390, 640, 767, 1200, 1366, 1440, 1920]) expect(placed(w), `untouched @${w}`).toBe(false);
    // The tier matches the renderer's own 2-column breakpoints exactly.
    const r = ((WorkflowRendererComponent as any).ɵcmp.styles as string[]).join('\n').replace(/\s+/g, ' ');
    expect(r).toMatch(/@media \(min-width: ?768px\) ?\{ ?\.pf-wr-cards/);
    expect(r).toMatch(/@media \(min-width: ?1200px\) ?\{ ?\.pf-wr-cards[^{]*\{ ?grid-template-columns: ?repeat\(3/);
    // Placement only: the DOM (= focus, Tab and Enter order) is identity →
    // contact → additional, and the compiled rule reaches the renderer's cards.
    const { el, txt } = render();
    const cards = Array.from(el.querySelectorAll('.pf-reg-form .pf-wr-cards > .pf-wr-card'));
    expect(cards.map(c => c.getAttribute('data-step'))).toEqual(['st1__identity', 'st1__contact', 'st2']);
    expect(txt(cards[2].querySelector('.pf-card__label'))).toBe('Additional details');
    const compiled = ((PatientRegisterComponent as any).ɵcmp.styles as string[]).join('\n');
    expect(compiled).toMatch(/\.pf-reg-form\[[^\]]+\]\s+\.pf-wr-cards\s*>\s*\[data-step\$="?__contact"?\]/);
  });

  it('kit fields: pf-input, the amber required dot, tabular numbers; NO ABHA buttons in the card headers', () => {
    const { el } = render();
    const first = el.querySelector('[data-field="first_name"]')!;
    expect(first.querySelector('input.pf-input')).not.toBeNull();
    expect(first.querySelector('.pf-field__lbl .pf-dot-unpriced[aria-label="required"]')).not.toBeNull();
    expect(el.querySelector('[data-field="phone"] input[type="tel"].pf-num')).not.toBeNull();
    expect(el.querySelector('[data-field="abha_id"] input.pf-input.pf-num')).not.toBeNull();
    expect(el.querySelector('.nd-input')).toBeNull();   // the pre-kit input class is gone (pf-input IS the kit class now)
    expect(el.querySelector('.pf-wr-card .pf-card__head button')).toBeNull();
  });

  it('Date of birth is EMPTY by default (typed dd/mm/yyyy, no native date box) and no DOB is ever submitted', async () => {
    const r = render();
    const dob = r.el.querySelector<HTMLInputElement>('[data-field="date_of_birth"] input[data-pf-stop]')!;
    expect(dob.type).toBe('text');
    expect(dob.value).toBe('');
    expect(dob.placeholder).toBe('dd/mm/yyyy');
    expect(r.el.querySelector('[data-field="date_of_birth"] input.pf-di-date__native')!.getAttribute('tabindex')).toBe('-1');
    r.fillAll();
    (r.el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await r.flush();
    const body = (r.api.post.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(body['dateOfBirth']).toBeUndefined();
  });

  it('typing a DOB auto-inserts slashes and stores ISO; the age follows', () => {
    const { el, f } = render();
    const dob = el.querySelector<HTMLInputElement>('[data-field="date_of_birth"] input[data-pf-stop]')!;
    dob.value = '15051990';
    dob.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(dob.value).toBe('15/05/1990');
    const age = el.querySelector<HTMLInputElement>('[data-field="date_of_birth"] .pf-di-dob__age')!;
    expect(Number(age.value)).toBeGreaterThanOrEqual(35);
  });

  it('no number spinners: Age is a numeric TEXT box; number fields are spinner-free', () => {
    const { el } = render();
    const age = el.querySelector<HTMLInputElement>('[data-field="date_of_birth"] .pf-di-dob__age')!;
    expect(age.type).toBe('text');
    expect(age.getAttribute('inputmode')).toBe('numeric');
    expect(el.querySelector('input[type="number"]')).toBeNull();
  });

  it('the pill name follows what is typed — the FULL name', () => {
    const { el, txt, type } = render();
    type('first_name', 'Venkatasubramanian');
    type('fathers_name', 'Ramakrishnan Iyer');
    expect(txt(el.querySelector('.pf-reg-ctx__nametext'))).toBe('Venkatasubramanian Ramakrishnan Iyer');
  });

  it('palette + font hygiene: no monospace / green / teal, no native select / datalist, no emoji', () => {
    const { el } = render();
    expect(el.querySelector('select, datalist, code, .font-mono, .mono')).toBeNull();
    expect(el.querySelector('[class*="green"], [class*="emerald"], [class*="teal"]')).toBeNull();
    expect(/\p{Extended_Pictographic}/u.test(el.textContent ?? '')).toBe(false);
    expect(/monospace/i.test(el.innerHTML)).toBe(false);
  });
});

describe('Patient registration — keyboard-first', () => {

  it('First name has focus as soon as the form renders (web)', async () => {
    const { el, flush } = render({ web: true });
    await flush();
    expect(document.activeElement).toBe(el.querySelector('[data-field="first_name"] input'));
  });

  it('Enter moves to the next field in reading order, across the cards', () => {
    const { el, enter } = render();
    const first = el.querySelector<HTMLInputElement>('[data-field="first_name"] input')!;
    first.focus();
    enter(first);
    expect(document.activeElement).toBe(el.querySelector('[data-field="fathers_name"] input'));
    // …Sex's segment is a stop (its checked / first option)…
    enter(document.activeElement!);
    expect((document.activeElement as HTMLElement).closest('[data-field]')!.getAttribute('data-field')).toBe('sex');
    // …the DOB → the next CARD's first field (the phone number).
    const dob = el.querySelector<HTMLInputElement>('[data-field="date_of_birth"] input[type="date"]')!;
    dob.focus();
    enter(dob);
    expect(document.activeElement).toBe(el.querySelector('[data-field="phone"] input[type="tel"]'));
  });

  it('Enter on the LAST field submits (Register)', async () => {
    const { el, api, fillAll, enter, flush } = render();
    fillAll();
    const last = el.querySelector<HTMLInputElement>('[data-field="occupation"] input')!;
    last.focus();
    enter(last);
    await flush();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('Ctrl / ⌘ + Enter saves from anywhere', async () => {
    const { api, fillAll, flush } = render();
    fillAll();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    await flush();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('Title → Sex default (Mr. → Male, Ms. → Female), and a manual Sex wins', () => {
    const { el, seg } = render();
    const checked = (f: string) => el.querySelector(`[data-field="${f}"] [role="radio"][aria-checked="true"]`)?.textContent?.trim();
    seg('title', 'Mr.');
    expect(checked('sex')).toBe('Male');
    seg('title', 'Ms.');
    expect(checked('sex')).toBe('Female');
    seg('sex', 'Other');
    seg('title', 'Mr.');
    expect(checked('sex')).toBe('Other');
    expect(el.querySelector('button[class*="--on"]')).toBeNull();
  });

  it('Sex is keyboard-operable: F / M / O quick keys and arrows (a radio group with one Tab stop)', () => {
    const { el, f } = render();
    const group = el.querySelector<HTMLElement>('[data-field="sex"] [role="radiogroup"]')!;
    const key = (k: string) => { group.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); f.detectChanges(); };
    const checked = () => group.querySelector('[aria-checked="true"]')?.textContent?.trim();
    key('f');
    expect(checked()).toBe('Female');
    key('ArrowRight');
    expect(checked()).toBe('Other');
    key('m');
    expect(checked()).toBe('Male');
    expect(Array.from(group.querySelectorAll('[role="radio"]')).map(b => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });
});

describe('Patient registration — errors + behaviour kept', () => {

  it('Register with gaps: EACH invalid field is outlined with its message; focus goes to the first', async () => {
    const { el, api, txt, flush } = render();
    (el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await flush();
    expect(api.post).not.toHaveBeenCalled();
    const first = el.querySelector('[data-field="first_name"]')!;
    expect(first.querySelector('input.pf-input--error[aria-invalid="true"]')).not.toBeNull();
    expect(txt(first.querySelector('.pf-di-err'))).toBe('Required');
    expect(el.querySelector('[data-field="sex"] .pf-di-seg--error')).not.toBeNull();
    expect(el.querySelector('[data-field="phone"] .pf-di-phone--err')).not.toBeNull();
    expect(el.querySelector('[data-field="email"] .pf-di-err')).toBeNull();
    expect(document.activeElement).toBe(first.querySelector('input'));
    expect(el.querySelector('.pf-wr-err, [role="tablist"]')).toBeNull();
  });

  it('fixing a field clears ITS error only', async () => {
    const { el, type, flush } = render();
    (el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await flush();
    type('first_name', 'Ravi');
    expect(el.querySelector('[data-field="first_name"] .pf-di-err')).toBeNull();
    expect(el.querySelector('[data-field="fathers_name"] .pf-di-err')).not.toBeNull();
  });

  it('Register posts the patient and opens the profile (MRN is server-generated)', async () => {
    const r = render();
    r.fillAll();
    (r.el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await r.flush();
    expect(r.api.post).toHaveBeenCalledTimes(1);
    const [url, body] = r.api.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe('/api/patients/');
    expect(body).toMatchObject({ firstName: 'Ravi', fathersName: 'Shankar', sex: 'Male', phone: '+919876543210' });
    expect(body['mrn']).toBeUndefined();
    expect(r.router.navigate).toHaveBeenCalledWith(['/frontdesk/patients', 'p-new']);
  });

  it('Save & book test (not from an order) opens a new order for the patient', async () => {
    const r = render();
    r.fillAll();
    (r.el.querySelector('.pf-reg-order') as HTMLButtonElement).click();
    await r.flush();
    expect(r.orderEntry.startNewOrder).toHaveBeenCalledWith('p-new');
  });

  it('opened from Order & Payments: Register goes BACK to that order with the patient (cart resumes)', async () => {
    const r = render({ returnTo: 'order' });
    r.fillAll();
    (r.el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await r.flush();
    expect(r.router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'p-new', resume: 'registration' } });
    expect(r.orderEntry.startNewOrder).not.toHaveBeenCalled();
  });

  it('opened from Order & Payments: Cancel goes back to the order too', () => {
    const r = render({ returnTo: 'order' });
    (r.el.querySelector('.pf-reg-cancel') as HTMLButtonElement).click();
    expect(r.router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { resume: 'registration' } });
  });

  it('duplicate patient: confirm via DialogService, then retry with force (no other dialogs)', async () => {
    let n = 0;
    const r = render({ post: () => (++n === 1
      ? throwError(() => ({ error: { error: 'duplicate_patient', message: 'Ravi Shankar (9876543210) is already registered.' } }))
      : of({ id: 'p-new', displayName: 'Mr. Ravi Shankar' })) });
    r.fillAll();
    (r.el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await r.flush();
    await r.flush();
    expect(r.dialog.confirm).toHaveBeenCalledTimes(1);
    expect(r.api.post).toHaveBeenCalledTimes(2);
    expect((r.api.post.mock.calls[1] as unknown[])[1]).toMatchObject({ force: true });
  });

  it('the phone country code is +91 — Indian mobiles only, whatever the tenant\'s own number', () => {
    const { el } = render({ tenantPhone: '+44 20 7946 0000' });
    expect(el.querySelector('[data-field="phone"] .pf-dd__value')!.textContent!.trim()).toBe('+91');
  });

  it('edit mode: "Verify / create ABHA" rides in the pill', async () => {
    const { el, flush } = render({ patientId: 'p-1' });
    await flush();
    const b = el.querySelectorAll('pf-hero-band .pf-reg-ctx__abha button');
    expect(Array.from(b).map(x => x.getAttribute('aria-label'))).toEqual(['Verify / create ABHA']);
  });

  it('ABHA: Fill from ABHA opens the prefill; fetched details fill the form and the pill', async () => {
    const { el, f, c, flush, txt } = render();
    (el.querySelector('.pf-reg-abha') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('pf-abha-prefill')).not.toBeNull();
    c.applyAbhaPrefill({ firstName: 'Meena', lastName: 'Devi', gender: 'F', mobile: '9123456780', abhaNumber: '12345678901234' });
    f.detectChanges();
    await flush();
    await flush();
    expect(el.querySelector('pf-abha-prefill')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('[data-field="first_name"] input')!.value).toBe('Meena');
    expect(txt(el.querySelector('.pf-reg-ctx__nametext'))).toBe('Meena Devi');
  });

  it('edit mode: the pill shows the patient, primary = Save changes, a neutral save state', async () => {
    const { el, txt, flush, type } = render({ patientId: 'p-1' });
    await flush();
    expect(txt(el.querySelector('.pf-reg-ctx__nametext'))).toBe('Mr. Arun Kumar');
    expect(txt(el.querySelector('pf-hero-band .pf-hb-btn--primary'))).toBe('Save changes');
    expect(el.querySelector('.pf-reg-order')).toBeNull();
    expect(txt(el.querySelector('.pf-savestate'))).toBe('All changes saved');
    type('first_name', 'Arun K');
    expect(txt(el.querySelector('.pf-savestate'))).toBe('Unsaved changes');
  });

  it('phone rules: Cancel goes on phones; no tab styles remain', () => {
    const phone = PATIENT_REGISTER_ND_STYLES.slice(PATIENT_REGISTER_ND_STYLES.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.pf-reg-cancel\s*\{\s*display:\s*none/);
    expect(/pf-reg-tab|monospace|emerald|teal|green/i.test(PATIENT_REGISTER_ND_STYLES)).toBe(false);
  });

  it('classic design keeps the old page (screen header, no band)', () => {
    const { el } = render({ nd: false });
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelector('pf-screen-header')).not.toBeNull();
  });
});

/** The shipped form after the 2026-09-28 repair: "Baby of" after "Baby",
 *  guardian shown for Title = Baby / Baby of OR age < 18. */
const BABY_CONFIG = (() => {
  const c = JSON.parse(JSON.stringify(CONFIG));
  const basic = c.steps[0].fields;
  basic[0].options = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Master', 'Baby', 'Baby of'].map(v => ({ value: v, label: v }));
  const rules = [{ field: 'age', operator: 'lessThan', value: 18 }, { field: 'title', operator: 'equals', value: 'Baby' },
                 { field: 'title', operator: 'equals', value: 'Baby of' }];
  basic.push(
    { id: 'g1', name: 'guardian_name', title: 'Guardian name', type: 'text', isStandard: true, isRequired: false, isEditable: true,
      storageKey: 'guardian_name', width: 'half', showWhen: rules, showWhenLogic: 'OR' },
    { id: 'g2', name: 'guardian_phone', title: 'Guardian phone', type: 'phone', isStandard: true, isRequired: false, isEditable: true,
      storageKey: 'guardian_phone', width: 'half', showWhen: rules, showWhenLogic: 'OR' });
  return c;
})();

describe('Patient registration — Baby vs Baby of (2026-09-28)', () => {
  const label = (el: HTMLElement, f: string) =>
    (el.querySelector(`[data-field="${f}"] .pf-field__lbl`)?.textContent ?? '').replace(/\s+/g, ' ').replace('required', '').trim();
  /** The Title choices, read from the dropdown (Title is a pf-select; the other fields are still segmented). */
  const pills = (r: ReturnType<typeof render>) => r.titleOptions();
  const checked = (el: HTMLElement, f: string) =>
    f === 'title' ? el.querySelector('[data-field="title"] .pf-dd__value')?.textContent?.trim()
      : el.querySelector(`[data-field="${f}"] [role="radio"][aria-checked="true"]`)?.textContent?.trim();
  const post = (r: ReturnType<typeof render>) => (r.api.post.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];

  it('title options in order: Mr. / Mrs. / Ms. / Dr. / Master / Baby / Baby of', () => {
    expect(pills(render({ config: BABY_CONFIG }))).toEqual(['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Master', 'Baby', 'Baby of']);
  });

  it('a form still offering only "Baby" gets "Baby of" right after it (no duplicate when present)', () => {
    expect(pills(render())).toEqual(['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Master', 'Baby', 'Baby of']);
    TestBed.resetTestingModule();
    expect(pills(render({ config: BABY_CONFIG })).filter(p => p === 'Baby of').length).toBe(1);
  });

  it('a customised list without "Baby" is left exactly as the admin set it', () => {
    const c = JSON.parse(JSON.stringify(CONFIG));
    c.steps[0].fields[0].options = ['Mr.', 'Ms.', 'Kid'].map(v => ({ value: v, label: v }));
    expect(pills(render({ config: c }))).toEqual(['Mr.', 'Ms.', 'Kid']);
  });

  it('"Baby of": mother\'s name labels, subject "Baby of Priya Kumar", guardian asked once (mirrored), no auto-sex', async () => {
    const r = render({ config: BABY_CONFIG });
    r.seg('title', 'Baby of');
    expect(label(r.el, 'first_name')).toBe("Mother's first name");
    expect(label(r.el, 'fathers_name')).toBe("Mother's last name");
    expect(r.el.querySelector('[data-field="guardian_name"]')).toBeNull();
    expect(r.el.querySelector('[data-field="guardian_phone"]')).toBeNull();
    expect(checked(r.el, 'sex')).toBeUndefined();          // the BABY's sex — never derived
    r.type('first_name', 'Priya');
    r.type('fathers_name', 'Kumar');
    expect(r.txt(r.el.querySelector('.pf-reg-ctx__nametext'))).toBe('Baby of Priya Kumar');
    r.seg('sex', 'Female');
    r.type('phone', '9876543210');
    (r.el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await r.flush();
    expect(post(r)).toMatchObject({ title: 'Baby of', firstName: 'Priya', fathersName: 'Kumar', guardianName: 'Priya Kumar', sex: 'Female' });
    expect(r.txt(r.el.querySelector('.pf-reg-ctx__nametext'))).not.toMatch(/Baby Baby/);
  });

  it('"Baby": own-name entry — plain labels, subject "Baby Arjun Kumar", guardian visible, no mirroring, no auto-sex', async () => {
    const r = render({ config: BABY_CONFIG });
    r.seg('title', 'Baby');
    expect(label(r.el, 'first_name')).toBe('First name');
    expect(label(r.el, 'fathers_name')).toBe('Last name');
    expect(r.el.querySelector('[data-field="guardian_name"]')).not.toBeNull();
    expect(checked(r.el, 'sex')).toBeUndefined();
    r.type('first_name', 'Arjun');
    r.type('fathers_name', 'Kumar');
    expect(r.txt(r.el.querySelector('.pf-reg-ctx__nametext'))).toBe('Baby Arjun Kumar');
    r.seg('sex', 'Male');
    r.type('phone', '9876543210');
    (r.el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await r.flush();
    const body = post(r);
    expect(body).toMatchObject({ title: 'Baby', firstName: 'Arjun', fathersName: 'Kumar', sex: 'Male' });
    expect(body['guardianName']).toBeUndefined();
  });

  it('title pills: one row on desktop (tight pills), 44px tap targets on touch, rows of 4 in a narrow card', () => {
    const css = PATIENT_REGISTER_ND_STYLES.replace(/\s+/g, ' ');
    expect(css).toMatch(/\[data-field="title"\] \.pf-di-seg \.pf-seg__item \{ min-width: 44px; padding: 0 10px; white-space: nowrap; \}/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{ \.pf-reg-form ::ng-deep \[data-field="title"\] \.pf-di-seg \.pf-seg__item \{ min-height: 44px; \}/);
    expect(css).toMatch(/\[data-field="title"\] \{ container-type: inline-size; \}/);
    expect(css).toMatch(/@container \(max-width: 460px\) \{ \.pf-reg-form ::ng-deep \[data-field="title"\] \.pf-di-seg:not\(\.pf-di-seg--fill\) \{ display: grid; grid-template-columns: repeat\(4, 1fr\)/);
  });

  it('switching Baby of → Mr. restores the plain labels and the Mr. → Male default', () => {
    const r = render({ config: BABY_CONFIG });
    r.seg('title', 'Baby of');
    r.seg('title', 'Mr.');
    expect(label(r.el, 'first_name')).toBe('First name');
    expect(checked(r.el, 'sex')).toBe('Male');
  });

  // Drives onValuesChange directly (what the form emits on each pick).
  const pick = (c: any, field: 'title' | 'sex', v: string) => {
    c.onValuesChange({ ...c.values(), [`basic::${field}`]: v });
  };
  const sexOf = (c: any) => c.values()['basic::sex'];

  it('OPS-118: Mr. → Male, then Baby / Baby of / Dr. clears the AUTO sex (a baby can be any sex)', () => {
    for (const t of ['Baby', 'Baby of', 'Dr.']) {
      TestBed.resetTestingModule();
      const { c } = render({ config: BABY_CONFIG });
      c.values.set({ 'basic::title': '', 'basic::sex': '' });
      pick(c, 'title', 'Mr.');
      expect(sexOf(c)).toBe('Male');
      pick(c, 'title', t);
      expect(sexOf(c)).toBe('');
    }
  });

  it('OPS-118: Mr. → Male, then Mrs. re-derives Female; a manually picked sex survives a neutral title', () => {
    const { c } = render({ config: BABY_CONFIG });
    c.values.set({ 'basic::title': '', 'basic::sex': '' });
    pick(c, 'title', 'Mr.');
    pick(c, 'title', 'Mrs.');
    expect(sexOf(c)).toBe('Female');
    pick(c, 'title', 'Baby');
    expect(sexOf(c)).toBe('');
    pick(c, 'sex', 'Male');          // the user's own choice
    pick(c, 'title', 'Baby of');
    expect(sexOf(c)).toBe('Male');
  });

  it('edit mode: a "Baby of" patient loads with its pill on and the mother\'s-name labels', async () => {
    const r = render({ config: BABY_CONFIG, patientId: 'p-9',
      patient: { id: 'p-9', displayName: 'Baby of Priya Kumar', firstName: 'Priya', fathersName: 'Kumar', title: 'Baby of', sex: 'Female' } });
    await r.flush();
    expect(checked(r.el, 'title')).toBe('Baby of');
    expect(label(r.el, 'first_name')).toBe("Mother's first name");
    expect(r.txt(r.el.querySelector('.pf-reg-ctx__nametext'))).toBe('Baby of Priya Kumar');
  });
});
