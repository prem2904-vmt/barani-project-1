import { SENSE_ON } from '../../core/services/pf-sense.testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { ToastService } from '../../core/services/toast.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../instruments/instrument-bridge.service';
import { AssistantApiService } from './assistant-api.service';
import { AssistantPanelComponent } from './assistant-panel.component';
import { normaliseSuggestions } from './assistant-logic';
import type { AssistantPageContext, AssistantReply, ProposalStatus } from './assistant.models';

/**
 * The shared assistant panel on the Insights page (dashboard builder): the
 * page's own transport, no instrument-only parts, a host `changes` card with
 * Keep / Undo, and model text still rendered as TEXT.
 */
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function setup(proposals: Record<string, ProposalStatus> = { p1: 'pending' }, reply?: Partial<AssistantReply>) {
  try { localStorage.removeItem('pf.assistant.provider'); } catch { /* noop */ }
  const api = { providers: vi.fn(() => of([{ id: 'gemini', label: 'Gemini', available: true }])), chat: vi.fn() };
  const chat = vi.fn(() => of<AssistantReply>({
    reply: 'Here is a **morning view**. <img src=x onerror=alert(1)>',
    suggestions: [{ kind: 'changes', ref: 'p1', changes: ['Added “Patients today”', 'Made Revenue a line chart'] }],
    provider: 'gemini', model: 'g', ...reply,
  }));
  const snapshot = vi.fn(async () => ({ any: 'diag' }));
  TestBed.configureTestingModule({
    imports: [AssistantPanelComponent],
    providers: [
      { provide: AssistantApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'assistant', ensureLoaded: async () => undefined } },
      // A desktop bridge IS available: the insights panel must still not take a network check.
      SENSE_ON,
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => ({ list: async () => [], diag: { snapshot } }) },
    ],
  });
  const f = TestBed.createComponent(AssistantPanelComponent);
  const ctx: AssistantPageContext = { page: 'insights', subject: 'Morning view', chat, proposals };
  f.componentRef.setInput('context', ctx);
  f.componentRef.setInput('open', true);
  const kept: string[] = [];
  const undone: string[] = [];
  f.componentInstance.keepProposal.subscribe((r) => kept.push(r));
  f.componentInstance.undoProposal.subscribe((r) => undone.push(r));
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  document.body.appendChild(el);
  const settle = async () => { await flush(); f.detectChanges(); };
  return { f, el, api, chat, snapshot, kept, undone, settle, cmp: f.componentInstance };
}

describe('Assistant panel — Insights page', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('insights copy + starters; no instrument picker, no network check', async () => {
    const p = setup();
    await p.settle();
    expect(p.el.querySelector('.pf-asst')!.getAttribute('aria-label')).toBe('Dashboard assistant');
    const starters = Array.from(p.el.querySelectorAll('.pf-asst-starter')).map((b) => b.textContent!.trim());
    expect(starters).toEqual(['Morning view for the lab owner', 'Patient flow by hour today', 'Revenue and dues this month']);
    expect(p.el.querySelector('.pf-asst__lead')!.textContent).toContain('keep it or undo it');
    expect(p.el.querySelector<HTMLTextAreaElement>('.pf-asst__input')!.placeholder).toContain('dashboard');
    expect(p.el.querySelector('.pf-asst__diag')).toBeNull();
    expect(p.snapshot).not.toHaveBeenCalled();
  });

  it('a starter goes through the page’s own transport (never the instruments endpoint)', async () => {
    const p = setup();
    await p.settle();
    (p.el.querySelector('.pf-asst-starter') as HTMLButtonElement).click();
    await p.settle();
    expect(p.chat).toHaveBeenCalledWith({ provider: 'gemini', messages: [{ role: 'user', text: 'Morning view for the lab owner' }] });
    expect(p.api.chat).not.toHaveBeenCalled();
  });

  it('model text stays text (no raw HTML); the changes card lists plain changes with Keep / Undo', async () => {
    const p = setup();
    await p.settle();
    p.cmp.ask('Morning view for the lab owner');
    await p.settle();
    const md = p.el.querySelector('.pf-asst-md')!;
    expect(md.querySelector('img')).toBeNull();
    expect(md.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(md.querySelector('strong')!.textContent).toBe('morning view');
    const card = p.el.querySelector('.pf-asst-card[data-kind="changes"]')!;
    expect(Array.from(card.querySelectorAll('.pf-asst-changes li')).map((l) => l.textContent)).toEqual(['Added “Patients today”', 'Made Revenue a line chart']);
    expect(card.textContent).toContain('Showing as a preview');
    (card.querySelector('.pf-asst-keep') as HTMLButtonElement).click();
    (card.querySelector('.pf-asst-undo') as HTMLButtonElement).click();
    expect(p.kept).toEqual(['p1']);
    expect(p.undone).toEqual(['p1']);
  });

  it('a decided proposal shows its status and no buttons', async () => {
    const p = setup({ p1: 'kept' });
    await p.settle();
    p.cmp.ask('x');
    await p.settle();
    const card = p.el.querySelector('.pf-asst-card[data-kind="changes"]')!;
    expect(card.textContent).toContain('Kept');
    expect(card.querySelector('.pf-asst-keep')).toBeNull();
    (p.cmp as unknown as { keep(s: unknown): void }).keep({ kind: 'changes', ref: 'p1', changes: [] });
    expect(p.kept).toEqual([]);
  });

  it('the model can never forge a changes card (normaliseSuggestions drops it)', () => {
    expect(normaliseSuggestions([{ kind: 'changes', ref: 'p1', changes: ['x'] }, { kind: 'action', text: 'ok' }])).toEqual([{ kind: 'action', text: 'ok' }]);
  });
});
