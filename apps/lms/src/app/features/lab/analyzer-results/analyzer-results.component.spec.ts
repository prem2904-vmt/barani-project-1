import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { DialogService } from '../../../core/services/dialog.service';
import { ScanService } from '../../../core/services/scan.service';
import type { MessageSummaryDto } from '../../../shared/instruments/instrument.models';
import { AnalyzerResultsComponent, previewSummary, searchMessages } from './analyzer-results.component';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

function msg(extra: Partial<MessageSummaryDto> = {}): MessageSummaryDto {
  return {
    id: 'm1', instrumentId: 'i1', instrumentName: 'Sysmex XN', sampleId: '26999', state: 'unmatched', isQc: false, protocol: 'astm',
    receivedAt: '2026-09-30T05:12:00Z', runAt: null, processedAt: null, orderSampleId: null, orderId: null,
    resultCount: 20, mappedCount: 0, unmappedCodes: [],
    preview: [{ code: 'WBC', value: '7.8', unit: '10^3/uL', flags: ['H'] }, { code: 'RBC', value: '4.52' }],
    ...extra,
  };
}

describe('Analyzer results (unmatched + QC)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(confirm = true) {
    const p = renderBandPage(AnalyzerResultsComponent, {
      getFor: (u) => (u.includes('state=qc') ? { items: [msg({ id: 'q1', isQc: true, state: 'qc', sampleId: null })], total: 1 }
        : { items: [msg()], total: 1 }),
      providers: [{ provide: ScanService, useValue: { manualEntry: () => true } }],
    });
    const dialog = TestBed.inject(DialogService) as unknown as { confirm: ReturnType<typeof vi.fn> };
    dialog.confirm.mockImplementation(async () => confirm);
    return { ...p, dialog };
  }

  it('lists unmatched runs (state=unmatched) with no primary; the QC segment reloads read-only', async () => {
    const p = render();
    await flush(); p.f.detectChanges();
    expect(p.api.get).toHaveBeenCalledWith('/api/instruments/messages?state=unmatched&page=1&pageSize=100');
    expect(p.el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary').length).toBe(0);
    expect(p.cmp.colDefs().some((c: { colId: string }) => c.colId === 'actions')).toBe(true);
    p.cmp.setTab('qc'); p.f.detectChanges(); await flush();
    expect(p.api.get).toHaveBeenCalledWith('/api/instruments/messages?state=qc&page=1&pageSize=100');
    expect(p.cmp.colDefs().some((c: { colId: string }) => c.colId === 'actions')).toBe(false);
  });

  it('attach: confirm → POST {barcode} → the run leaves the list', async () => {
    const p = render(true);
    await flush();
    p.api.post.mockImplementation((() => of(msg({ state: 'matched' }))) as never);
    await p.cmp.onBarcode(msg(), ' 26123 ');
    expect(p.dialog.confirm).toHaveBeenCalled();
    expect(p.api.post).toHaveBeenCalledWith('/api/instruments/messages/m1/attach', { barcode: '26123' });
    expect(p.cmp.rows()).toEqual([]);
  });

  it('attach cancelled at the confirm → nothing is sent', async () => {
    const p = render(false);
    await flush();
    await p.cmp.onBarcode(msg(), '26123');
    expect(p.api.post).not.toHaveBeenCalled();
  });

  it('preview + search helpers', () => {
    expect(previewSummary(msg())).toBe('WBC 7.8 H · RBC 4.52');
    expect(searchMessages([msg(), msg({ id: 'm2', sampleId: '11111' })], '26999').map((m) => m.id)).toEqual(['m1']);
  });
});
