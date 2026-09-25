import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { renderBandPage } from '../admin-band.spec-helpers';
import { WorkflowBuilderComponent } from './workflow-builder.component';
import { FieldEditorComponent } from './field-editor.component';
import { ConditionBuilderComponent } from './condition-builder.component';
import { TestBed } from '@angular/core/testing';

/**
 * Workflow editors — ND-PATTERN "Editors (single-record pages)": the band is
 * back · tenant · ONE primary; the pill is the CONTEXT BAR (record name +
 * neutral chips); the steps rail is a tabs row; stacked nd-cards; slate
 * switches; no mono / green / native controls / glyph icons.
 */
const cfg = {
  title: 'Patient registration',
  steps: [
    { id: 's1', name: 'identity', title: 'Identity', type: 'entry', isRequired: true, canSkip: false, afterStep: {},
      fields: [
        { id: 'f1', name: 'first_name', title: 'First name', type: 'text', storageKey: 'first_name', isStandard: true, isRequired: true },
        { id: 'f2', name: 'blood_group', title: 'Blood group', type: 'select', storageKey: 'metadata.blood_group', isStandard: false,
          options: [{ value: 'A+', label: 'A+' }] },
      ] },
    { id: 's2', name: 'contact', title: 'Contact', type: 'entry', isRequired: false, canSkip: true, afterStep: {}, fields: [] },
  ],
};
const record = { screenName: 'patient_register', status: 'published', version: 4, configJson: JSON.stringify(cfg) };
const route = (params: Record<string, string>) => ({
  provide: ActivatedRoute,
  useValue: { paramMap: of(convertToParamMap(params)), snapshot: { paramMap: convertToParamMap(params) } },
});
const getFor = (u: string) => (u === '/api/workflows/patient_register' ? record : []);
const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
const hygiene = (el: HTMLElement) => {
  expect(el.querySelector('select, datalist, code, .font-mono, pf-chip, pf-toggle, input[type=checkbox]')).toBeNull();
  expect(/[✕✓✔⠿↑↓●]/.test(el.textContent ?? '')).toBe(false);
  expect(el.innerHTML).not.toMatch(/emerald|#34d399|#10b981|amber-text/);
};

describe('Workflow screen editor — new design', () => {
  const make = () => {
    const p = renderBandPage(WorkflowBuilderComponent, { getFor, providers: [route({ screen: 'patient_register' })] });
    p.f.detectChanges();
    return p;
  };

  it('band: ONE primary (Publish), Save draft secondary; old header classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    const prim = p.el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary');
    expect(prim.length).toBe(1);
    expect(txt(prim[0])).toContain('Publish');
    expect(p.el.querySelector('pf-hero-band .pf-wfe-draft.pf-hb-btn--ghost')).not.toBeNull();
    expect(p.el.querySelector('.pf-builder-hdr')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.el.querySelector('pf-hero-band .nd-savestate')).not.toBeNull();
  });

  it('context bar: the workflow title + form / version / status / steps chips (key in tabular Noto)', () => {
    const p = make();
    const ctx = p.el.querySelector('pf-hero-band .nd-ctx')!;
    expect(txt(ctx.querySelector('.nd-ctx__primary'))).toBe('Patient registration');
    expect(ctx.querySelector('.nd-ctx__chip[data-k="Form"] .nd-num')?.textContent).toBe('patient_register');
    expect(txt(ctx.querySelector('.nd-ctx__chip[data-k="Version"]'))).toContain('v4');
    expect(txt(ctx.querySelector('.nd-ctx__chip[data-k="Steps"]'))).toBe('2 steps');
  });

  it('steps are a tabs row (no rail); a tab switches the step cards', async () => {
    const p = make();
    expect(p.el.querySelector('.pf-wfe-rail')).toBeNull();
    const tabs = p.el.querySelectorAll('[role="tablist"].nd-tabs [role="tab"]');
    expect(tabs.length).toBe(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    (tabs[1] as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.el.querySelector('[role="tab"][data-step="s2"]')!.getAttribute('aria-selected')).toBe('true');
    await p.f.whenStable();
    expect(p.el.querySelector<HTMLInputElement>('.pf-wfe-detail input.nd-input')!.value).toBe('Contact');
  });

  it('step cards: slate switches, fields as kit rows with text row actions on web / icons on touch', () => {
    const p = make();
    expect(p.el.querySelectorAll('.pf-wfe-detail .nd-card').length).toBe(4);
    const sw = p.el.querySelectorAll('.pf-wfe-detail .nd-toggle[role="switch"]');
    expect(sw.length).toBe(2);
    expect(sw[0].getAttribute('aria-checked')).toBe('true');
    const rows = p.el.querySelectorAll('.pf-field-item.nd-row');
    expect(rows.length).toBe(2);
    expect(rows[1].querySelector('.nd-num')?.textContent).toBe('metadata.blood_group');
    // The spec harness has no fine pointer → touch → icon row actions.
    expect(rows[0].querySelector('.nd-rowact.nd-rowact--icon')).not.toBeNull();
    hygiene(p.el);
  });

  it('phones: Preview / History / Reset live in a More menu', () => {
    const p = make();
    const more = p.el.querySelector<HTMLButtonElement>('.pf-wfe-morebtn')!;
    more.click();
    p.f.detectChanges();
    const items = Array.from(p.el.querySelectorAll('.pf-wfe-menu [role="menuitem"]')).map(txt);
    expect(items).toEqual(['Preview', 'Version history', 'Reload from server']);
    (p.el.querySelector('.pf-wfe-menu [role="menuitem"]') as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-preview-modal')).not.toBeNull();
  });
});

describe('Workflow list — current rules', () => {
  it('neutral status chip (violet check for published), Edit is a row action, no primaries', () => {
    const p = renderBandPage(WorkflowBuilderComponent, {
      getFor: (u) => (u === '/api/workflows/' ? [record, { ...record, screenName: 'order_create', status: 'draft' }] : []),
    });
    expect(p.el.querySelectorAll('.pf-hb-btn--primary, pf-touch-btn .v-primary').length).toBe(0);
    const chips = p.el.querySelectorAll('.pf-wf-status.nd-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].querySelector('svg')).not.toBeNull();
    expect(p.el.querySelectorAll('.pf-wf-edit.nd-rowact').length).toBe(2);
    hygiene(p.el);
  });
});

describe('Field editor — new design', () => {
  const make = (params: Record<string, string>) => {
    const p = renderBandPage(FieldEditorComponent, { getFor, providers: [route(params)] });
    p.f.detectChanges();
    return p;
  };

  it('edit: band with ONE primary "Save changes"; context bar = field label + form / step / type / key', () => {
    const p = make({ screen: 'patient_register', stepId: 's1', fieldId: 'f2' });
    const prim = p.el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary');
    expect(prim.length).toBe(1);
    expect(txt(prim[0])).toBe('Save changes');
    const ctx = p.el.querySelector('pf-hero-band .nd-ctx')!;
    expect(txt(ctx.querySelector('.nd-ctx__primary'))).toBe('Blood group');
    expect(txt(ctx.querySelector('[data-k="Form"]'))).toContain('Patient registration');
    expect(txt(ctx.querySelector('[data-k="Step"]'))).toContain('Identity');
    expect(txt(ctx.querySelector('[data-k="Type"]'))).toContain('Dropdown');
    expect(ctx.querySelector('[data-k="Key"] .nd-num')?.textContent).toBe('blood_group');
    expect(p.el.querySelector('pf-screen-header')?.classList.contains('pf-classic-only')).toBe(true);
  });

  it('new: "New field" + "Add field"; nd-cards, kit fields, slate switches, no native controls', () => {
    const p = make({ screen: 'patient_register', stepId: 's1' });
    expect(txt(p.el.querySelector('.nd-ctx__primary'))).toBe('New field');
    expect(txt(p.el.querySelector('.pf-hb-btn--primary'))).toBe('Add field');
    expect(p.el.querySelectorAll('.pf-fe-card.nd-card').length).toBeGreaterThanOrEqual(2);
    const sw = p.el.querySelectorAll('.nd-toggle[role="switch"]');
    expect(sw.length).toBe(2);
    (sw[0] as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.cmp.draft().isRequired).toBe(true);
    hygiene(p.el);
  });
});

describe('Condition builder — kit controls', () => {
  it('AND / OR is a neutral nd-seg; remove is an SVG icon button', () => {
    TestBed.configureTestingModule({ imports: [ConditionBuilderComponent] });
    const f = TestBed.createComponent(ConditionBuilderComponent);
    f.componentRef.setInput('rules', [
      { field: 'a', operator: 'equals', value: '1' },
      { field: 'b', operator: 'isEmpty' },
    ]);
    f.componentRef.setInput('fields', []);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const seg = el.querySelector('.nd-seg[role="radiogroup"]')!;
    expect(seg.querySelectorAll('[role="radio"]').length).toBe(2);
    expect(el.querySelector('.cb-remove svg')).not.toBeNull();
    expect(el.querySelector('input.nd-input')).not.toBeNull();
    expect(/✕/.test(el.textContent ?? '')).toBe(false);
  });
});
