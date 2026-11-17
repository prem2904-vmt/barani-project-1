import { vi } from 'vitest';
import { Router } from '@angular/router';
import { LabSampleNumbersPage } from './sample-numbers.page';
import { LabCollectionPage } from './collection.page';
import { LabResultsPage } from './results.page';
import { LabReportOptionsPage } from './report-options.page';
import { SAMPLE_ID_DATE_OPTIONS, sampleIdPreview, sanitizeSamplePad } from './sample-id-format-card.component';
import { DEFAULT_LAB_PREFIX, buildBranchPrefixes } from './space-prefixes-card.component';
import { groupLabels, renderLabPage, rowLabels, segButtons, text } from './lab-pages.spec-helpers';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';

const cfgGet = (extra: Record<string, unknown> = {}) => (url: string) =>
  url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto', ...extra } : [];

describe('Lab › Sample numbers', () => {
  it('ONE page of group cards (DESIGN-V2): Format · Prefixes · Finding a sample · Labels · Structure, no tab pill', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page', { getFor: cfgGet() });
    expect(groupLabels(p.el)).toEqual(['Format', 'Prefixes', 'Finding a sample', 'Labels', 'Structure']);
    expect(p.el.querySelector('pf-hero-band pf-segmented')).toBeNull();
    expect(p.el.querySelector('pf-sample-id-format-card')).not.toBeNull();
    expect(p.api.get).toHaveBeenCalledWith('/api/config/sample-id');
    // every category id is still a ?tab= anchor on the page
    for (const c of LAB_PAGES.sampleNumbers.categories) expect(p.el.querySelector(`[data-group="${c.id}"]`), c.id).not.toBeNull();
  });

  it('barcode is ONE row: 1D barcode · QR · Data Matrix; scope is said once per group (no per-row pills)', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page?tab=barcode', { getFor: cfgGet() });
    expect(segButtons(p.el, 'Barcode on tube labels').map(b => text(b))).toEqual(['1D barcode', 'QR', 'Data Matrix']);
    expect(p.el.querySelector('pf-setting-row .pf-ls__scope')).toBeNull();
    expect(text(p.el.querySelector('[data-group="barcode"] .pf-sgroup__scope'))).toBe('this branch');
  });

  it('the find group carries scan vs manual AND the pre-fill sample search', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page?tab=find', { getFor: cfgGet() });
    expect(text(p.el)).toContain('Pre-fill sample search');
    expect(segButtons(p.el, 'Find a sample').length).toBe(2);
  });

  it('picking a tab writes ?tab= (replacing history) so reload / shell panel land on it', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page', { getFor: cfgGet() });
    const nav = vi.spyOn(p.harness.routeDebugElement!.injector.get(Router), 'navigate');
    p.cmp.pick('barcode');
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: 'barcode' }, queryParamsHandling: 'merge', replaceUrl: true }));
  });

  it('label code changes PATCH only labelCodeMode, as before', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page?tab=barcode', { getFor: cfgGet() });
    const qr = segButtons(p.el, 'Barcode on tube labels').find(b => text(b) === 'QR')!;
    qr.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { labelCodeMode: 'qr' });
  });

  it('lab structure changes PATCH only labStructure', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page?tab=structure', { getFor: cfgGet() });
    segButtons(p.el, 'Lab structure').find(b => text(b) === 'Standalone')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { labStructure: 'standalone' });
  });

  it('scan vs manual PATCHes the tenant', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page?tab=find', { getFor: cfgGet() });
    segButtons(p.el, 'Find a sample').find(b => text(b) === 'Manual')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { scanMode: 'manual' });
  });
});

describe('Sample ID format card (moved from Organization › Sample ID)', () => {
  it('reads and saves through the same API with the same payload', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page', {
      getFor: u => u === '/api/config/sample-id' ? { datePrefix: 'ddmmyy', separator: '/', padding: 4, serialMode: 'alpha', letterCount: 3 } : cfgGet()(u),
    });
    p.el.querySelector<HTMLButtonElement>('.pf-sf__save')!.click();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/sample-id', {
      enabled: true, datePrefix: 'ddmmyy', separator: '/', padding: 4, serialMode: 'alpha', letterCount: 3,
    });
    expect(p.toasts.success).toHaveBeenCalledWith('Sample ID format saved');
  });

  it('previews with a stand-in prefix and clamps the digits', () => {
    const d = new Date(2026, 6, 5);
    expect(sampleIdPreview('MIC', 'yymm', '-', 5, 'numeric', 2, d)).toBe('MIC-2607-00001');
    expect(sampleIdPreview('MIC', 'none', '', 3, 'alpha', 2, d)).toBe('MICAA001');
    expect(sanitizeSamplePad(99, false)).toBe(10);
    expect(sanitizeSamplePad(99, true)).toBe(6);
    expect(sanitizeSamplePad('x', false)).toBe(1);
    expect(SAMPLE_ID_DATE_OPTIONS.map(o => o.value)).toContain('yymm');
  });
});

describe('Prefix per lab space (read-only)', () => {
  it('groups the default Lab + named spaces per branch with the prefix they print', () => {
    const rows = buildBranchPrefixes(
      [{ id: 'b1', name: 'Main', defaultLabCode: '' }, { id: 'b2', name: 'Anna', defaultLabCode: 'an', isActive: false }] as any,
      [{ id: 's2', branchId: 'b1', name: 'Micro', code: 'mic', order: 2 }, { id: 's1', branchId: 'b1', name: 'Bio', code: '', order: 1 }]);
    expect(rows.length).toBe(1);
    expect(rows[0].rows.map(r => [r.name, r.code])).toEqual([['Lab (default space)', DEFAULT_LAB_PREFIX], ['Bio', ''], ['Micro', 'MIC']]);
  });

  it('renders the lists and links to the lab spaces page; never writes', async () => {
    const p = await renderLabPage(LabSampleNumbersPage, '/page?tab=prefixes', {
      getFor: u => u === '/api/tenants/branches' ? [{ id: 'b1', name: 'Main Lab', defaultLabCode: 'LAB' }]
        : u === '/api/tenants/lab-spaces' ? [{ id: 's1', branchId: 'b1', name: 'Micro', code: 'MIC', order: 1 }] : cfgGet()(u),
    });
    expect(Array.from(p.el.querySelectorAll('[data-testid="space-code"]')).map(c => text(c))).toEqual(['LAB', 'MIC']);
    expect(p.el.querySelector('[data-testid="space-prefixes-link"]')!.getAttribute('href')).toBe('/admin/lab/departments?tab=spaces');
    expect(p.el.querySelector('pf-space-prefixes-card input')).toBeNull();
    expect(p.api.patch).not.toHaveBeenCalled();
  });
});

describe('Lab › Collection and queues', () => {
  const depts = [{ id: 'd1', name: 'Haematology', code: 'HEM' }, { id: 'd2', name: 'Biochemistry', code: 'BIO' }];
  const get = (u: string) => u.startsWith('/api/tenants/departments') ? depts
    : u === '/api/users/picker' ? [{ id: 'u1', displayName: 'Asha', isActive: true }]
    : u === '/api/roles/picker' ? [{ id: 'r1', name: 'Technician' }]
    : u === '/api/tenants/auto-assign-configs' ? [{ departmentId: 'd1', validatorUserIdsJson: '["u1"]', assigneeUserIdsJson: '[]', autoAssignRoleIdsJson: '[]', validatorRoleIdsJson: '[]' }]
    : cfgGet({ queueFocusMode: 'auto', effectiveQueueFocus: 'patient' })(u);

  it('ONE page of group cards: Queue (focus + counters pointer), Claiming, Auto-assign (full width)', async () => {
    const p = await renderLabPage(LabCollectionPage, '/page', { getFor: get });
    expect(groupLabels(p.el)).toEqual(['Queue', 'Claiming', 'Auto-assign']);
    expect(rowLabels(p.el).slice(0, 2)).toEqual(['Queue focus', 'Counters and collection']);
  });

  it('queue focus PATCHes only queueFocusMode', async () => {
    const p = await renderLabPage(LabCollectionPage, '/page', { getFor: get });
    segButtons(p.el, 'Queue focus').find(b => text(b) === 'Sample')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { queueFocusMode: 'sample' });
  });

  it('auto-assign: technician AND validator pools per department, same PUT body as before (the one home of validator pools)', async () => {
    const p = await renderLabPage(LabCollectionPage, '/page?tab=assign', { getFor: get });
    expect(text(p.el)).toContain('Validators — people · roles');
    expect(text(p.el)).toContain('Technicians — people · roles');
    expect(p.el.querySelectorAll('.pf-ls__dept').length).toBe(2);
    // drive the host component through its public setters (the pf-select is covered by its own spec)
    const ls = p.harness.routeDebugElement!.query(d => d.name === 'pf-lab-settings').componentInstance as any;
    ls.setValidators('d2', ['u1']);
    expect(p.api.put).toHaveBeenCalledWith('/api/tenants/auto-assign-configs', {
      departmentId: 'd2', assigneeUserIds: [], roleIds: [], validatorUserIds: ['u1'], validatorRoleIds: [],
    });
    ls.setAssignees('d1', ['u1']);   // changing the tech pool keeps d1's validators
    expect(p.api.put).toHaveBeenCalledWith('/api/tenants/auto-assign-configs', {
      departmentId: 'd1', assigneeUserIds: ['u1'], roleIds: [], validatorUserIds: ['u1'], validatorRoleIds: [],
    });
  });

  it('auto-assign master switches PATCH the branch config', async () => {
    const p = await renderLabPage(LabCollectionPage, '/page?tab=assign', { getFor: get });
    p.el.querySelector<HTMLButtonElement>('button[aria-label="Auto-assign validators"]')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { autoAssignValidatorsEnabled: true });
    p.el.querySelector<HTMLButtonElement>('button[aria-label="Auto-assign technicians"]')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { autoAssignEnabled: true });
  });

  it('no-scan claim PATCHes the tenant', async () => {
    const p = await renderLabPage(LabCollectionPage, '/page?tab=noscan', { getFor: get });
    p.el.querySelector<HTMLButtonElement>('button[aria-label^="Allow no-scan claim"]')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { allowNoScanClaim: true });
  });
});

describe('Lab › Results and validation', () => {
  it('ONE page of group cards: Calculations, Validation, Stage lock, Turnaround targets', async () => {
    const p = await renderLabPage(LabResultsPage, '/page', { getFor: cfgGet() });
    expect(groupLabels(p.el).slice(0, 2)).toEqual(['Calculations', 'Validation']);
    p.el.querySelector<HTMLButtonElement>('button[aria-label="Require validation for all results"]')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { requireValidationForAllResults: true });
  });

  it('constants: ISI / MNPT / normal HCT, saved on blur to the tenant', async () => {
    const p = await renderLabPage(LabResultsPage, '/page?tab=constants', { getFor: cfgGet() });
    expect(p.el.querySelectorAll('pf-lab-settings input.pf-num').length).toBe(3);
    const ls = p.harness.routeDebugElement!.query(d => d.name === 'pf-lab-settings').componentInstance as any;
    ls.calcIsi.set(1.2); ls.calcMnpt.set(13); ls.calcNormalHct.set(42);
    ls.saveCalcConstants();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { calcConstants: { ISI: 1.2, MNPT: 13, NORMAL_HCT: 42 } });
  });

  it('microbiology: Stage lock + Turnaround targets are group cards; their Save is the band primary', async () => {
    const p = await renderLabPage(LabResultsPage, '/page?tab=micro', {
      getFor: u => u === '/api/microbiology/settings'
        ? { lockTimeoutMinutes: 45, allowSupervisorTakeover: true, stageTats: [{ stageKey: 'gram', tatHours: 6 }] } : cfgGet()(u),
    });
    expect(p.el.querySelectorAll('pf-hero-band').length).toBe(1);
    expect(groupLabels(p.el)).toEqual(expect.arrayContaining(['Stage lock', 'Turnaround targets']));
    p.el.querySelector<HTMLButtonElement>('[data-testid="culture-save"]')!.click();
    expect(p.api.put).toHaveBeenCalledWith('/api/microbiology/settings', {
      lockTimeoutMinutes: 45, allowSupervisorTakeover: true, stageTats: [{ stageKey: 'gram', tatHours: 6 }],
    });
  });
});

describe('Lab › Report options', () => {
  it('technician notes PATCH only techReportNotes; the sending category is the WhatsApp Auto card', async () => {
    const p = await renderLabPage(LabReportOptionsPage, '/page', { getFor: cfgGet() });
    expect(groupLabels(p.el)).toEqual(['Report notes', 'Sending']);
    p.el.querySelector<HTMLButtonElement>('.pf-ls__card button[aria-label="Technician notes on report"]')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { techReportNotes: true });
  });
});
