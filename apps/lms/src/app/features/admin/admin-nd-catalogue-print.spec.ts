import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { ReportTemplateComponent } from './report-template/report-template.component';
import { BillingConfigComponent } from './billing-config/billing-config.component';
import { SetupWizardComponent } from './setup-wizard/setup-wizard.component';
import { LabelPrinterComponent } from './label-printer/label-printer.component';
import { PricingComponent } from './pricing/pricing.component';
import { OptionGroupsPanelComponent } from './tests/tests/option-groups-panel.component';
import { MicroMastersPanelComponent } from './tests/tests/micro-masters-panel.component';
import { MySignatureComponent } from '../user-signature/my-signature.component';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { PrinterService } from '../../core/printer/printer.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { AuthService } from '../../core/auth/auth.service';
import { TestPricingService } from '../../core/services/test-pricing.service';

/**
 * PF-PATTERN audit (current rules) for the catalogue + print pages: ONE
 * primary in view (classic-only markup excluded), slate switches instead of
 * the violet pf-toggle / checkboxes, neutral selected states (aria-pressed,
 * never `--on` gradients), kit cards / fields, no native select, no mono.
 * Test Master editors (option group, micro master) open as a side card that
 * is a sheet on phones, with the editor's save as the ONE primary.
 */
const PRIMARY = '.pf-hb-btn--primary, .pf-btn--primary, pf-touch-btn .v-primary, .pf-sig-cta--primary';
/** Primaries a new-design user can see (classic-only markup is display:none). */
const primaries = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>(PRIMARY)).filter(b => !b.closest('.pf-classic-only'));
const hygiene = (el: HTMLElement) => {
  expect(el.querySelector('pf-toggle, select, datalist, .font-mono, [class*="--on"]:not(.pf-toggle)')).toBeNull();
  expect(Array.from(el.querySelectorAll('input[type="checkbox"]')).filter(i => !/srcheck/.test(i.className))).toEqual([]);
};
const tabBtn = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('pf-hero-band pf-segmented button'))
    .find(b => (b.getAttribute('aria-label') ?? '') === label)!;

describe('ND audit — Report designer', () => {
  const make = () => renderBandPage(ReportTemplateComponent, {
    getFor: (url) => url === '/api/config/report-template' ? { labName: 'Micro World Labs' }
      : url === '/api/tenants/departments' ? [{ id: 'd1', name: 'Haematology' }]
      : url.startsWith('/api/workflows/') ? { configJson: '{}' } : null,
  });
  it('one primary on every tab; slate switches; neutral thumbs; preview is an pf-card', () => {
    const p = make();
    for (const t of ['Letterhead', 'Patient strip', 'Results table', 'Footer']) {
      tabBtn(p.el, t).click();
      p.f.detectChanges();
      expect(primaries(p.el).map(b => b.textContent?.trim()), t).toEqual([]);   // Settings: no violet primary; Save is the pane's bar
      hygiene(p.el);
    }
    tabBtn(p.el, 'Letterhead').click();
    p.f.detectChanges();
    const sw = p.el.querySelector<HTMLButtonElement>('.pf-toggle[role="switch"][aria-label="NABL accredited"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click(); p.f.detectChanges();
    expect(p.cmp.tpl().nablAccredited).toBe(true);
    // Header styles: neutral selected tile in the designer's side card.
    expect(p.el.querySelector('.pf-rhe-preset.pf-tile-sel[aria-checked="true"]')).not.toBeNull();
    tabBtn(p.el, 'Patient strip').click();
    p.f.detectChanges();
    const aside = p.el.querySelector('.pf-rt-aside')!;
    expect(aside.classList.contains('pf-card')).toBe(true);
    expect(aside.querySelector('.pf-card__label')!.textContent).toContain('Live preview');
  });
});

describe('ND audit — Billing config', () => {
  const make = () => renderBandPage(BillingConfigComponent, {
    getFor: (url) => url === '/api/config/billing' ? { tenantId: 't1', gstEnabled: false, invoicePrefix: 'INV', allowDiscounts: true }
      : url === '/api/config/invoice-template' ? {} : [],
  });
  it('one primary (band Save) on every tab; Save letterhead is secondary; slate switches', () => {
    const p = make();
    for (const t of ['GST Setup', 'Discounts', 'Invoice']) {
      tabBtn(p.el, t).click();
      p.f.detectChanges();
      expect(primaries(p.el).map(b => b.textContent?.trim()), t).toEqual(['Save']);
      hygiene(p.el);
    }
    expect(p.el.querySelector('.pf-save-letterhead')!.classList.contains('pf-btn--secondary')).toBe(true);
    expect(p.el.querySelectorAll('.pf-toggle[role="switch"]').length).toBeGreaterThanOrEqual(4);
    expect(p.el.querySelector('.pf-tpl-chip[aria-pressed="true"]')).not.toBeNull();
    tabBtn(p.el, 'GST Setup').click();
    p.f.detectChanges();
    p.el.querySelector<HTMLButtonElement>('.pf-toggle[aria-label="Enable GST"]')!.click();
    expect(p.cmp.config().gstEnabled).toBe(true);
  });
});

describe('ND audit — Branding, Printing, Signature', () => {
  it('Branding: kit cards (icon chip + label), one primary', () => {
    const tenant = signal<any>({ id: 't1', name: 'Micro World', brandingMode: 'both', brandingName: 'MW', logoUrl: '' });
    const p = renderBandPage(SetupWizardComponent, {
      providers: [{ provide: TenantStateService, useValue: { tenant, ensureLoaded: vi.fn(), update: vi.fn() } }],
    });
    p.api.patch.mockImplementation(() => of({ id: 't1' }) as any);
    const cards = p.el.querySelectorAll('section.pf-card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.pf-card__icon svg')).not.toBeNull();
    expect(primaries(p.el).length).toBe(1);
    hygiene(p.el);
  });

  it('Printing: Test print is the ONE primary; Pair / Scan are outline; connected is neutral', () => {
    const printer = {
      testPrint: vi.fn(async () => ({ ok: true })),
      bleDeviceName: signal<string | null>(null), bleConnected: signal(false),
      deviceName: signal<string | null>(null), connected: signal(false),
      electronStatus: vi.fn(async () => ({ connected: false })), listSystemPrinters: vi.fn(async () => []),
    };
    const p = renderBandPage(LabelPrinterComponent, {
      providers: [
        { provide: PrinterService, useValue: printer },
        { provide: BranchLabConfigService, useValue: { ensureLoaded: vi.fn(), labelCodeMode: () => 'qr', config: () => null } },
      ],
    });
    expect(primaries(p.el).map(b => b.textContent?.trim())).toEqual(['Test print']);
    hygiene(p.el);
  });

  it('Signature: one primary per tab; the registration field is a kit input', () => {
    const auth = { user: signal<any>({ tenantName: 'Micro World', signatureDataUrl: null, registrationId: '' }),
      setRegistrationIdLocal: vi.fn(), setSignatureLocal: vi.fn() };
    const p = renderBandPage(MySignatureComponent, { providers: [{ provide: AuthService, useValue: auth }] });
    expect(primaries(p.el).length).toBe(1);
    tabBtn(p.el, 'Registration ID').click();
    p.f.detectChanges();
    expect(primaries(p.el).length).toBe(1);
    expect(p.el.querySelector('.pf-sig-input')!.classList.contains('pf-input')).toBe(true);
    hygiene(p.el);
  });
});

describe('ND audit — Test Master side views', () => {
  it('Pricing: slate "Offered" switches; Save changes appears as the ONE primary when dirty, and tells the host', () => {
    const p = renderBandPage(PricingComponent, {
      getFor: (url) => url.startsWith('/api/tests') ? [{ id: 't1', name: 'Glucose Fasting', type: 'individual', price: 120, departmentId: 'd1', isOffered: true }]
        : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Biochemistry' }] : [],
      providers: [{ provide: TestPricingService, useValue: { isolationOn: () => false, ensureLoaded: vi.fn(), save: vi.fn(() => of({})), branches: () => [] } }],
    });
    const emitted: boolean[] = [];
    p.cmp.editingChange.subscribe((v: boolean) => emitted.push(v));
    p.f.detectChanges();
    const sw = p.el.querySelector<HTMLButtonElement>('.pf-pricing__offer .pf-toggle[role="switch"]');
    expect(sw).not.toBeNull();
    expect(sw!.getAttribute('aria-checked')).toBe('true');
    expect(primaries(p.el)).toEqual([]);
    sw!.click();
    p.f.detectChanges();
    expect(primaries(p.el).map(b => b.textContent?.trim())).toEqual(['Save changes']);
    expect(emitted.at(-1)).toBe(true);
    hygiene(p.el);
  });

  it('Option groups: the editor is a side card (sheet on phones), its save is the ONE primary', () => {
    const p = renderBandPage(OptionGroupsPanelComponent, {
      getFor: (url) => url === '/api/option-groups'
        ? [{ code: 'OG1', name: 'Urine colour', values: [{ code: null, value: 'Pale yellow', normal: true, active: true }], links: [] }] : [],
    });
    const emitted: boolean[] = [];
    p.cmp.editingChange.subscribe((v: boolean) => emitted.push(v));
    p.f.detectChanges();
    const side = () => p.el.querySelector('aside.pf-og__side')!;
    expect(side().classList.contains('pf-card')).toBe(true);
    expect(side().classList.contains('pf-sheet')).toBe(false);
    // "Normal" is the neutral selected chip + a violet check — never green.
    expect(side().querySelector('.pf-og__chip--normal svg')).not.toBeNull();
    p.cmp.startEdit(p.cmp.selected());
    p.f.detectChanges();
    expect(side().classList.contains('pf-sheet')).toBe(true);
    expect(emitted.at(-1)).toBe(true);
    expect(side().querySelectorAll('.pf-toggle[role="switch"]').length).toBe(2);   // Normal + Active
    expect(primaries(p.el).map(b => b.textContent?.trim())).toEqual(['Save everywhere']);
    hygiene(p.el);
  });

  it('Microbiology: the master-row editor is a side card / phone sheet; flags are slate switches', () => {
    const p = renderBandPage(MicroMastersPanelComponent, {
      getFor: (url) => url.includes('antibiotic') ? [{ code: 'AMK', name: 'Amikacin', astApplicable: true, diskDiffusion: true, micTesting: false }] : [],
    });
    p.cmp.select('antibiotics');
    p.f.detectChanges();
    p.cmp.startCreate();
    p.f.detectChanges();
    const ed = p.el.querySelector('aside.pf-mm__side--editor')!;
    expect(ed).not.toBeNull();
    expect(ed.classList.contains('pf-card')).toBe(true);
    expect(ed.classList.contains('pf-sheet')).toBe(true);
    expect(ed.querySelectorAll('.pf-toggle[role="switch"]').length).toBe(3);   // AST · Disk · MIC
    expect(ed.querySelector('input.pf-input')).not.toBeNull();
    expect(primaries(p.el).map(b => b.textContent?.trim())).toEqual(['Save']);
    hygiene(p.el);
  });
});
