import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { SENSE_ON } from '../../core/services/pf-sense.testing';
import { ToastService } from '../../core/services/toast.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../instruments/instrument-bridge.service';
import { AssistantApiService } from './assistant-api.service';
import { AssistantPanelComponent } from './assistant-panel.component';
import type { AssistantChatRequest, AssistantReply, RateCardSummary } from './assistant.models';
import { RATE_CARD_PREPARE, RateCardPrepareException } from './rate-card-pages';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const BATCH = '3f2a9c1e-5b7d-4c8e-9a10-0123456789ab';
const SUMMARY: RateCardSummary = {
  batchId: BATCH, pages: 2, pagesRead: 2, lines: 12, priceSuggestions: 3, newTestSuggestions: 1, suggestions: 4, alreadyCurrent: 2, noPrice: 1,
  unmatched: [{ n: 7, text: 'Lipid Pro', reason: 'Not in your tests, and no matching department.' }], notes: [], provider: 'gemini', model: 'm',
};
const PROVIDERS = [{ id: 'gemini' as const, label: 'Gemini', available: true }, { id: 'claude' as const, label: 'Claude', available: true }];

function setup(o: { read?: () => Observable<RateCardSummary>; upload?: () => Observable<{ uploadId: string; pages: number }>; prepare?: () => Promise<Blob[]>;
  chat?: (r: AssistantChatRequest) => Observable<AssistantReply>; attachments?: boolean } = {}) {
  try { localStorage.removeItem('pf.assistant.provider'); } catch { /* noop */ }
  const api = {
    providers: vi.fn(() => of(PROVIDERS)),
    chat: vi.fn((_p: string, r: AssistantChatRequest) => (o.chat ?? (() => of({ reply: 'ok', suggestions: [], provider: 'gemini', model: 'm' })))(r)),
    rateCardUpload: vi.fn(o.upload ?? (() => of({ uploadId: 'up1', pages: 2 }))),
    rateCardRead: vi.fn(o.read ?? (() => of(SUMMARY))),
  };
  const prepare = vi.fn(o.prepare ?? (async () => [new Blob(['a'], { type: 'image/jpeg' }), new Blob(['b'], { type: 'image/jpeg' })]));
  TestBed.configureTestingModule({
    imports: [AssistantPanelComponent],
    providers: [
      { provide: AssistantApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'assistant', ensureLoaded: async () => undefined } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
      { provide: RATE_CARD_PREPARE, useValue: prepare },
      SENSE_ON,
    ],
  });
  const f = TestBed.createComponent(AssistantPanelComponent);
  f.componentRef.setInput('context', { page: 'test-master', subject: 'Tests and prices', ...(o.attachments === false ? {} : { attachments: 'rate-card' }) });
  f.componentRef.setInput('open', true);
  const opened: (string | null)[] = [];
  f.componentInstance.openPending.subscribe((b) => opened.push(b));
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  document.body.appendChild(el);
  const settle = async () => { await flush(); f.detectChanges(); };
  const pick = async (names = ['rates.pdf']) => {
    const input = el.querySelector<HTMLInputElement>('input.pf-asst__file:not([capture])')!;
    const files = names.map((n) => new File(['x'], n, { type: n.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }));
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
  };
  return { f, el, api, prepare, opened, settle, pick, cmp: f.componentInstance };
}

describe('Assistant panel — Test Master rate card', () => {
  afterEach(() => { TestBed.resetTestingModule(); document.body.replaceChildren(); });

  it('Test Master context: Attach + camera in the composer and an "Add a rate card" door; copy says Cortex, never AI', async () => {
    const p = setup();
    await p.settle();
    expect(p.el.querySelector('.pf-asst__head')!.textContent).toContain('Test Master assistant');
    expect(p.el.querySelectorAll('.pf-asst__attach')).toHaveLength(2);
    expect(p.el.querySelector('[data-asst-attach]')).not.toBeNull();
    expect(p.el.querySelector('input.pf-asst__file[capture="environment"]')).not.toBeNull();
    expect(p.el.textContent).not.toMatch(/\bAI\b/);
    // Every icon is an SVG, never an emoji.
    expect(p.el.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('other pages never get the attach controls', async () => {
    const p = setup({ attachments: false });
    await p.settle();
    expect(p.el.querySelector('.pf-asst__attach')).toBeNull();
    expect(p.el.querySelector('[data-asst-attach]')).toBeNull();
  });

  it('a pick → prepare → upload → read → "4 suggestions added to Pending" and Review in Pending opens that batch', async () => {
    const p = setup();
    await p.settle();
    await p.pick();
    expect(p.prepare).toHaveBeenCalledTimes(1);
    expect(p.api.rateCardUpload).toHaveBeenCalledTimes(1);
    expect(p.api.rateCardRead).toHaveBeenCalledWith('up1', 'gemini');
    const card = p.el.querySelector('[data-asst-card]')!;
    expect(card.getAttribute('data-phase')).toBe('done');
    expect(card.textContent).toContain('4 suggestions added to Pending');
    expect(card.textContent).toContain('3 prices and 1 new test');
    expect(card.textContent).toContain('2 already at the printed price');
    expect(card.textContent).toContain('1 line not added');
    p.el.querySelector<HTMLButtonElement>('[data-asst-review]')!.click();
    expect(p.opened).toEqual([BATCH]);
  });

  it('shows progress while reading and holds the composer', async () => {
    const gate = new Subject<RateCardSummary>();
    const p = setup({ read: () => gate });
    await p.settle();
    await p.pick();
    const card = p.el.querySelector('[data-asst-card]')!;
    expect(card.getAttribute('data-phase')).toBe('reading');
    expect(card.textContent).toContain('Cortex is reading 2 pages');
    expect(p.cmp.cardBusy()).toBe(true);
    expect(p.el.querySelector<HTMLButtonElement>('.pf-asst__attach')!.disabled).toBe(true);
    gate.next(SUMMARY); gate.complete();
    await p.settle();
    expect(p.cmp.cardBusy()).toBe(false);
  });

  it('too many pages is refused in plain words and nothing is uploaded', async () => {
    const p = setup({ prepare: async () => { throw new RateCardPrepareException('too_many_pages'); } });
    await p.settle();
    await p.pick();
    expect(p.api.rateCardUpload).not.toHaveBeenCalled();
    expect(p.el.querySelector('[data-asst-card]')!.textContent).toContain('at most 6 pages');
  });

  it('one-a-minute: the refusal is worded as waiting, not as the monthly limit', async () => {
    const p = setup({ read: () => throwError(() => ({ status: 429, error: { error: 'rate_limited', message: '' } })) });
    await p.settle();
    await p.pick();
    const t = p.el.querySelector('[data-asst-card]')!.textContent!;
    expect(t).toContain('One rate card a minute');
    expect(t).not.toContain('limit reached for this month');
  });

  it('a read that failed is retried from the stored upload (no second prepare, no second upload)', async () => {
    let n = 0;
    const p = setup({ read: () => (++n === 1 ? throwError(() => ({ status: 200, error: { error: 'ai_failed', message: '' } })) : of(SUMMARY)) });
    await p.settle();
    await p.pick();
    expect(p.el.querySelector('[data-asst-card]')!.getAttribute('data-phase')).toBe('error');
    p.el.querySelector<HTMLButtonElement>('.pf-asst-retry')!.click();
    await p.settle();
    expect(p.api.rateCardRead).toHaveBeenCalledTimes(2);
    expect(p.api.rateCardUpload).toHaveBeenCalledTimes(1);
    expect(p.prepare).toHaveBeenCalledTimes(1);
    expect(p.el.querySelector('[data-asst-card]')!.getAttribute('data-phase')).toBe('done');
  });

  it('a chat answer with proposals shows them as waiting in Pending and one Review link; nothing says it was applied', async () => {
    const p = setup({ chat: () => of({
      reply: 'I added a suggestion to Pending changes.', provider: 'gemini', model: 'm',
      suggestions: [{ kind: 'proposal', id: BATCH, label: 'CBC ₹250 → ₹300', note: 'price' }],
    }) });
    await p.settle();
    p.cmp.ask('Set CBC to 300');
    await p.settle();
    const t = p.el.textContent!;
    expect(t).toContain('CBC ₹250 → ₹300');
    expect(t).toContain('Waiting in Pending');
    p.el.querySelector<HTMLButtonElement>('[data-asst-review]')!.click();
    expect(p.opened).toEqual([null]);
  });
});
