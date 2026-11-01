import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReportHeaderEditorComponent } from './report-header-editor.component';
import { DialogService } from '../../../core/services/dialog.service';
import { HttpClient } from '@angular/common/http';
import { PlatformService } from '../../../core/services/platform.service';
import type { ReportTemplate } from '../../../shared/models/report.model';
import { readHeaderLayout } from '../../../shared/utils/report-header-layout';
import { LH_SCAN_ID, letterheadPresetOf } from '../../../shared/utils/report-letterhead';
import { readReportStyle } from '../../../shared/utils/report-style';

/** Letterhead type card inside the header editor: one click = one patch (one undo step). */
const BASE = {
  id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate', address: '14 Gandhi Road', phone: '1', email: 'a@b.c',
  website: '', logoUrl: '', nablAccredited: false, headerPreset: 'classic', topAccentBar: true, primaryColor: '#1B3A6B',
  showPatientName: true, showAge: true, showRefDoctor: true, showOrderId: true, showAbhaId: false, showQrCode: true,
  showCollectionDate: true, showReportDate: true, showMethod: false, showInstrument: false, groupByDepartment: false,
  showCriticalFlag: true, showPathologistName: true, showSignature: true, showPoweredBy: true,
} as ReportTemplate;

function make(t: Partial<ReportTemplate> = {}, region: 'header' | 'footer' = 'header') {
  TestBed.configureTestingModule({ providers: [
    { provide: DialogService, useValue: { confirm: vi.fn(async () => true), choose: vi.fn(async () => 'fresh') } },
    { provide: HttpClient, useValue: {} },
    { provide: PlatformService, useValue: { getApiUrl: () => '' } },
  ] });
  const f = TestBed.createComponent(ReportHeaderEditorComponent);
  let tpl: ReportTemplate = { ...BASE, ...t };
  const patches: Array<Partial<ReportTemplate>> = [];
  f.componentRef.setInput('template', tpl);
  f.componentRef.setInput('region', region);
  f.componentInstance.patch.subscribe(p => { patches.push(p); tpl = { ...tpl, ...p }; f.componentRef.setInput('template', tpl); f.detectChanges(); });
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const tiles = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.pf-lhc-tile'));
  return { f, el, tiles, patches, tpl: () => tpl };
}

describe('Letterhead type card', () => {
  it('shows the three types on the Letterhead tab, Digital selected for an untouched template', () => {
    const { tiles } = make();
    expect(tiles().map(t => t.querySelector('.pf-lhc-name')!.textContent!.trim())).toEqual(['Digital', 'Pre-printed paper', 'Image letterhead']);
    expect(tiles().map(t => t.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('is not on the Footer tab (the Footer panel is the signature work\'s)', () => {
    expect(make({}, 'footer').el.querySelector('pf-report-letterhead-card')).toBeNull();
  });

  it('Pre-printed paper is one patch: letterpad on, style remembered; the old paper switch steps aside', () => {
    const { tiles, patches, tpl, el } = make();
    tiles()[1].click();
    expect(patches).toHaveLength(1);
    expect(tpl().letterpadMode).toBe(true);
    expect(letterheadPresetOf(tpl())).toBe('preprinted');
    expect(tiles()[1].getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).not.toContain('Printing asks whether to use your letterhead paper (header and footer left blank)');
    expect(el.textContent).toContain('Blank at the top (mm)');
  });

  it('Digital offers what later pages carry; choosing Slim writes only that key', () => {
    const { el, patches, tpl } = make();
    const slim = Array.from(el.querySelectorAll<HTMLButtonElement>('.pf-lhc-sub .pf-seg__item')).find(b => b.textContent!.trim() === 'Slim')!;
    slim.click();
    expect(patches).toHaveLength(1);
    expect(readReportStyle(tpl()).letterhead).toEqual({ preset: 'digital', continuation: 'slim' });
  });

  it('typing the blank top moves the patient details with the stationery scan', () => {
    const scanned = { ...BASE, metadata: JSON.stringify({ headerLayout: { v: 1, items: {}, bodyTop: 42, backgrounds: [{ id: LH_SCAN_ID, url: '/u/s.jpg', area: 'page', fit: 'cover', opacity: 1, pages: 'all' }] }, reportStyle: { v: 1, letterhead: { preset: 'preprinted' } } }), letterpadMode: true, letterpadHeaderMm: 42, letterpadFooterMm: 28 } as ReportTemplate;
    const { el, tpl } = make(scanned);
    const input = el.querySelectorAll<HTMLInputElement>('.pf-lhc-mm input')[0];
    expect(input.value).toBe('42');
    input.value = '47';
    input.dispatchEvent(new Event('change'));
    expect(tpl().letterpadHeaderMm).toBe(47);
    expect(readHeaderLayout(tpl())!.bodyTop).toBe(47);
    expect(el.textContent).toContain('Measure from this image');
  });
});
