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
 * Patient registration — NEW DESIGN (ND-PATTERN §14 + "Patient
 * registration"). Band = back · tenant · actions with ONE primary; the pill
 * = the patient's name + the form's section tabs only; one section card at a
 * time; kit fields (neutral segmented Title / Sex, amber required dot);
 * violet + neutrals only, Noto (no monospace). Behaviour is unchanged:
 * validation across every section, duplicate confirm, return-to-order.
 */

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

function render(opts: { nd?: boolean; patientId?: string; post?: any } = {}) {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/workflows/patient_registration') return of({ configJson: JSON.stringify(CONFIG), version: 3 });
      if (url.startsWith('/api/patients/')) return of({ patient: PATIENT, history: [] });
      return of([]);
    }),
    post: vi.fn(opts.post ?? (() => of({ id: 'p-new', displayName: 'Mr. Ravi Shankar', mrn: 'AA0100' }))),
    patch: vi.fn(() => of({ ...PATIENT })),
  };
  const router = { navigate: vi.fn(async () => true), navigateByUrl: vi.fn(async () => true), url: '/frontdesk/patients/new', events: of() };
  const orderEntry = { startNewOrder: vi.fn(async () => true) };
  const dialog = { confirm: vi.fn(async () => true) };
  const toasts = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
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
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map(opts.patientId ? [['patientId', opts.patientId]] : []) } } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => opts.nd ?? true } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
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
  const tab = (label: string) => {
    const t = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(b => txt(b) === label)!;
    t.click();
    f.detectChanges();
  };
  return { f, el, c: f.componentInstance as any, api, router, orderEntry, dialog, toasts, txt, flush, type, tab };
}

describe('Patient registration — new design: band + pill', () => {
  it('band: back + ONE primary (Register patient) in the band actions; secondaries are ghosts; no page title', () => {
    const { el, txt } = render();
    const band = el.querySelector('pf-hero-band')!;
    expect(band).not.toBeNull();
    const primaries = el.querySelectorAll('pf-hero-band .pf-hb__actions .pf-hb-btn--primary');
    expect(primaries.length).toBe(1);
    expect(txt(primaries[0])).toBe('Register patient');
    // …and nowhere else on the page (no form footer primary).
    expect(el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary, .pf-btn-primary').length).toBe(1);
    const ghosts = Array.from(el.querySelectorAll('pf-hero-band .pf-hb-btn--ghost')).map(b => txt(b));
    expect(ghosts).toEqual(['Cancel', 'Save & book test', 'Save & book appointment']);
    expect(el.querySelector('pf-screen-header, h1')).toBeNull();
  });

  it('the primary carries an SVG + aria-label, so on phones it is an icon at the top of the band', () => {
    const { el } = render();
    const p = el.querySelector('.pf-reg-primary')!;
    expect(p.querySelector('svg')).not.toBeNull();
    expect(p.getAttribute('aria-label')).toBe('Register patient');
  });

  it('pill = ONLY the subject name ("New patient") + the form sections as tabs — no fact chips', () => {
    const { el, txt } = render();
    const ctx = el.querySelector('pf-hero-band .nd-ctx')!;
    expect(txt(ctx.querySelector('.pf-reg-ctx__nametext'))).toBe('New patient');
    expect(ctx.querySelector('.nd-ctx__primary .nd-ctx__edit[aria-label="Edit name"]')).not.toBeNull();
    expect(ctx.querySelectorAll('.nd-ctx__chip').length).toBe(0);
    const tabs = Array.from(ctx.querySelectorAll('[role="tablist"] [role="tab"]')).map(t => txt(t));
    expect(tabs).toEqual(['Identity', 'Contact & IDs', 'Additional details']);
    expect(ctx.querySelector('.pf-reg-tabs__ind')).not.toBeNull();
    // The pill has nothing but the name and the tabs.
    const kids = Array.from(ctx.children).map(k => k.className.split(' ')[0]);
    expect(kids).toEqual(['nd-ctx__primary', 'pf-reg-ctx__div', 'pf-reg-tabs']);
    expect(el.querySelectorAll('[role="tablist"]').length).toBe(1);
  });

  it('the pill name follows what is typed — the FULL name, never cut', () => {
    const { el, txt, type } = render();
    type('first_name', 'Venkatasubramanian');
    type('fathers_name', 'Ramakrishnan Iyer');
    expect(txt(el.querySelector('.pf-reg-ctx__nametext'))).toBe('Venkatasubramanian Ramakrishnan Iyer');
  });

  it('edit mode: the pill shows the patient, primary = Save changes, a neutral save state', async () => {
    const { el, txt, flush, type } = render({ patientId: 'p-1' });
    await flush();
    expect(txt(el.querySelector('.pf-reg-ctx__nametext'))).toBe('Mr. Arun Kumar');
    const primaries = el.querySelectorAll('pf-hero-band .pf-hb-btn--primary');
    expect(primaries.length).toBe(1);
    expect(txt(primaries[0])).toBe('Save changes');
    expect(el.querySelector('.pf-reg-order')).toBeNull();
    expect(txt(el.querySelector('.nd-savestate'))).toBe('All changes saved');
    type('first_name', 'Arun K');
    expect(txt(el.querySelector('.nd-savestate'))).toBe('Unsaved changes');
    expect(el.querySelector('.nd-savestate__dot')).not.toBeNull();
  });
});

describe('Patient registration — new design: sections + fields', () => {
  it('ONE section card at a time (violet icon chip + UPPERCASE label); a tab switches it', () => {
    const { el, txt, tab } = render();
    const card = () => el.querySelector('#pf-reg-sec')!;
    expect(card().classList.contains('nd-card')).toBe(true);
    expect(card().querySelector('.nd-card__head .nd-card__icon svg')).not.toBeNull();
    expect(txt(card().querySelector('.nd-card__label'))).toBe('Patient identity');
    expect(el.querySelector('[data-field="first_name"]')).not.toBeNull();
    expect(el.querySelector('[data-field="phone"]')).toBeNull();
    tab('Contact & IDs');
    expect(txt(card().querySelector('.nd-card__label'))).toBe('Contact & IDs');
    expect(el.querySelector('[data-field="phone"]')).not.toBeNull();
    expect(el.querySelector('[data-field="first_name"]')).toBeNull();
    expect(el.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain('Contact');
  });

  it('kit fields: nd-input, the amber required dot, tabular numbers for phone / IDs', () => {
    const { el, tab } = render();
    const first = el.querySelector('[data-field="first_name"]')!;
    expect(first.querySelector('input.nd-input')).not.toBeNull();
    expect(first.querySelector('.nd-field__lbl .nd-dot-unpriced[aria-label="required"]')).not.toBeNull();
    expect(el.querySelector('[data-field="date_of_birth"] input[type="date"].nd-input')).not.toBeNull();
    tab('Contact & IDs');
    expect(el.querySelector('[data-field="phone"] input[type="tel"].nd-num')).not.toBeNull();
    expect(el.querySelector('[data-field="abha_id"] input.nd-input.nd-num')).not.toBeNull();
    expect(el.querySelector('.pf-input')).toBeNull();
  });

  it('Title and Sex are neutral segmented controls (aria-pressed, never an --on class); Mr. fills Sex', () => {
    const { el, f } = render();
    const title = el.querySelector('[data-field="title"] .nd-seg')!;
    expect(title).not.toBeNull();
    const mr = Array.from(title.querySelectorAll<HTMLButtonElement>('.nd-seg__item')).find(b => b.textContent!.trim() === 'Mr.')!;
    mr.click();
    f.detectChanges();
    expect(mr.getAttribute('aria-pressed')).toBe('true');
    const sex = el.querySelector('[data-field="sex"] .nd-seg')!;
    const male = Array.from(sex.querySelectorAll('.nd-seg__item')).find(b => b.textContent!.trim() === 'Male')!;
    expect(male.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('button[class*="--on"]')).toBeNull();
  });

  it('tab dots: a ring until the section is complete, then violet', () => {
    const { el, f, type } = render();
    const dot = () => el.querySelector('[role="tab"][data-step="st1__identity"] .pf-reg-tab__dot')!;
    expect(dot().classList.contains('pf-reg-tab__dot--ok')).toBe(false);
    type('first_name', 'Ravi');
    type('fathers_name', 'Shankar');
    (Array.from(el.querySelectorAll<HTMLButtonElement>('[data-field="sex"] .nd-seg__item')).find(b => b.textContent!.trim() === 'Male'))!.click();
    f.detectChanges();
    expect(dot().classList.contains('pf-reg-tab__dot--ok')).toBe(true);
  });

  it('palette + font hygiene: no monospace / green / teal, no native select / datalist, no emoji', () => {
    const { el, tab } = render();
    for (const t of ['Identity', 'Contact & IDs', 'Additional details']) {
      tab(t);
      expect(el.querySelector('select, datalist, code, .font-mono, .mono')).toBeNull();
      expect(el.querySelector('[class*="green"], [class*="emerald"], [class*="teal"]')).toBeNull();
      expect(/\p{Extended_Pictographic}/u.test(el.textContent ?? '')).toBe(false);
      expect(/monospace/i.test(el.innerHTML)).toBe(false);
    }
  });
});

describe('Patient registration — new design: behaviour kept', () => {
  it('Register with a missing required field opens THAT section with the message; nothing is posted', () => {
    const { el, f, api, txt, tab } = render();
    tab('Additional details');
    (el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    f.detectChanges();
    expect(api.post).not.toHaveBeenCalled();
    expect(txt(el.querySelector('[role="tab"][aria-selected="true"]'))).toBe('Identity');
    expect(txt(el.querySelector('.pf-wr-err'))).toBe('First name: Required');
    expect(el.querySelector('.pf-wr-err')!.getAttribute('role')).toBe('alert');
  });

  it('validation walks every section: a missing phone opens Contact & IDs', () => {
    const { el, f, api, txt, type } = render();
    type('first_name', 'Ravi');
    type('fathers_name', 'Shankar');
    (Array.from(el.querySelectorAll<HTMLButtonElement>('[data-field="sex"] .nd-seg__item')).find(b => b.textContent!.trim() === 'Male'))!.click();
    f.detectChanges();
    (el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    f.detectChanges();
    expect(api.post).not.toHaveBeenCalled();
    expect(txt(el.querySelector('[role="tab"][aria-selected="true"]'))).toBe('Contact & IDs');
    expect(txt(el.querySelector('.pf-wr-err'))).toBe('Phone: Required');
  });

  async function fillAll(r: ReturnType<typeof render>) {
    r.type('first_name', 'Ravi');
    r.type('fathers_name', 'Shankar');
    (Array.from(r.el.querySelectorAll<HTMLButtonElement>('[data-field="sex"] .nd-seg__item')).find(b => b.textContent!.trim() === 'Male'))!.click();
    r.f.detectChanges();
    r.tab('Contact & IDs');
    r.type('phone', '9876543210');
  }

  it('Register posts the patient and opens the profile (MRN is server-generated)', async () => {
    const r = render();
    await fillAll(r);
    (r.el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await r.flush();
    expect(r.api.post).toHaveBeenCalledTimes(1);
    const [url, body] = r.api.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe('/api/patients/');
    expect(body).toMatchObject({ firstName: 'Ravi', fathersName: 'Shankar', sex: 'Male', phone: '+919876543210' });
    expect(body['mrn']).toBeUndefined();
    expect(r.router.navigate).toHaveBeenCalledWith(['/frontdesk/patients', 'p-new']);
  });

  it('Save & book test returns to Order & Payments with the new patient attached', async () => {
    const r = render();
    await fillAll(r);
    (r.el.querySelector('.pf-reg-order') as HTMLButtonElement).click();
    await r.flush();
    expect(r.orderEntry.startNewOrder).toHaveBeenCalledWith('p-new');
  });

  it('duplicate patient: confirm via DialogService, then retry with force', async () => {
    let n = 0;
    const r = render({ post: () => (++n === 1
      ? throwError(() => ({ error: { error: 'duplicate_patient', message: 'Ravi Shankar (9876543210) is already registered.' } }))
      : of({ id: 'p-new', displayName: 'Mr. Ravi Shankar' })) });
    await fillAll(r);
    (r.el.querySelector('.pf-reg-primary') as HTMLButtonElement).click();
    await r.flush();
    await r.flush();
    expect(r.dialog.confirm).toHaveBeenCalledTimes(1);
    expect(r.api.post).toHaveBeenCalledTimes(2);
    expect((r.api.post.mock.calls[1] as unknown[])[1]).toMatchObject({ force: true });
  });

  it('ABHA: Fill from ABHA opens the prefill; fetched details fill the form', async () => {
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
});

describe('Patient registration — phones + classic', () => {
  it('phone rules: Cancel goes, the tabs stack under the name and scroll, 40px+ tab targets', () => {
    const phone = PATIENT_REGISTER_ND_STYLES.slice(PATIENT_REGISTER_ND_STYLES.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.pf-reg-cancel\s*\{\s*display:\s*none/);
    expect(phone).toMatch(/\.pf-reg-ctx__name\s*\{[^}]*flex:\s*1 1 100%/);
    expect(phone).toMatch(/\.pf-reg-tab\s*\{\s*height:\s*40px/);
    expect(PATIENT_REGISTER_ND_STYLES).toMatch(/\.pf-reg-tabs\s*\{[^}]*overflow-x:\s*auto/);
    // No palette leaks in the styles either.
    expect(/monospace|#10b981|emerald|teal|green/i.test(PATIENT_REGISTER_ND_STYLES)).toBe(false);
  });

  it('classic design keeps the old page (screen header, no band)', () => {
    const { el } = render({ nd: false });
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelector('pf-screen-header')).not.toBeNull();
  });
});
