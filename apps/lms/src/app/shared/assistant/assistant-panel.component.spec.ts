import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { PlatformService } from '../../core/services/platform.service';
import { ToastService } from '../../core/services/toast.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../instruments/instrument-bridge.service';
import { AssistantApiService } from './assistant-api.service';
import { AssistantButtonComponent } from './assistant-button.component';
import { AssistantPanelComponent } from './assistant-panel.component';
import type { AssistantChatRequest, AssistantPageContext, AssistantProvider, AssistantReply, MappingPrefill } from './assistant.models';

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const BOTH: AssistantProvider[] = [
  { id: 'gemini', label: 'Gemini', available: true },
  { id: 'claude', label: 'Claude', available: false },
];

const REPLY: AssistantReply = {
  reply: 'The analyzer is **not connected**. Set these on the Snibe:\n\n- Host IP\n- Port',
  suggestions: [
    { kind: 'setting', label: 'Host IP', value: '192.168.1.8', note: 'This PC’s address on the analyzer cable' },
    { kind: 'action', text: 'Enable Checksum on the Snibe: Set → Online → Options' },
    { kind: 'mapping', analyzerCode: 'GLU', unit: 'mg/dL', confidence: 'high', why: 'Same unit and name',
      tests: [{ testId: 't1', code: 'BIO010', name: 'Fasting Blood Sugar' }] },
  ],
  provider: 'gemini', model: 'gemini-3.1-flash-lite', usage: { inputTokens: 10, outputTokens: 20 },
};

interface SetupOpts {
  beta?: boolean;
  providers?: () => Observable<AssistantProvider[]>;
  chat?: (req: AssistantChatRequest) => Observable<AssistantReply>;
  context?: Partial<AssistantPageContext>;
  diag?: () => Promise<unknown>;
}

function setup(o: SetupOpts = {}) {
  try { localStorage.removeItem('pf.assistant.provider'); } catch { /* noop */ }
  const api = {
    providers: vi.fn(o.providers ?? (() => of(BOTH))),
    chat: vi.fn((_page: string, req: AssistantChatRequest) => (o.chat ?? (() => of(REPLY)))(req)),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const bridge = o.diag ? { list: async () => [], diag: { snapshot: vi.fn(o.diag) } } : undefined;
  TestBed.configureTestingModule({
    imports: [AssistantPanelComponent],
    providers: [
      { provide: AssistantApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'assistant' && o.beta !== false, ensureLoaded: async () => undefined } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => bridge },
    ],
  });
  const f = TestBed.createComponent(AssistantPanelComponent);
  f.componentRef.setInput('context', { page: 'instruments', subject: 'Snibe Maglumi', instrumentId: 'i1', canAddMapping: true, ...o.context });
  f.componentRef.setInput('open', true);
  const added: MappingPrefill[] = [];
  let closed = 0;
  f.componentInstance.addMapping.subscribe((p) => added.push(p));
  f.componentInstance.closed.subscribe(() => closed++);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  document.body.appendChild(el);
  const type = (text: string) => {
    const ta = el.querySelector<HTMLTextAreaElement>('.pf-asst__input')!;
    ta.value = text; ta.dispatchEvent(new Event('input')); f.detectChanges();
  };
  const sendBtn = () => el.querySelector<HTMLButtonElement>('.pf-asst__send')!;
  const settle = async () => { await flush(); f.detectChanges(); };
  return { f, el, api, toasts, added, closedCount: () => closed, type, sendBtn, settle, cmp: f.componentInstance, bridge };
}

describe('Assistant panel — beta gate', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('beta off: no panel, no request', () => {
    const p = setup({ beta: false });
    expect(p.el.querySelector('.pf-asst')).toBeNull();
    expect(p.api.providers).not.toHaveBeenCalled();
  });

  it('beta on + open: the panel, its title + subject, Esc / × close it', async () => {
    const p = setup();
    await p.settle();
    expect(p.el.querySelector('.pf-asst')!.getAttribute('aria-label')).toBe('Instruments assistant');
    expect(p.el.querySelector('.pf-asst__subject')!.textContent).toContain('Snibe Maglumi');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(p.closedCount()).toBe(1);
    p.el.querySelector<HTMLButtonElement>('[aria-label="Close the assistant"]')!.click();
    expect(p.closedCount()).toBe(2);
  });

  it('sparkle button renders only with the beta on (SVG, no emoji)', () => {
    for (const on of [false, true]) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [AssistantButtonComponent],
        providers: [{ provide: BetaFeaturesService, useValue: { enabled: () => on, ensureLoaded: async () => undefined } }],
      });
      const f = TestBed.createComponent(AssistantButtonComponent);
      f.detectChanges();
      const b = (f.nativeElement as HTMLElement).querySelector('button');
      if (!on) { expect(b).toBeNull(); continue; }
      expect(b!.querySelector('svg path')).not.toBeNull();
      expect(b!.textContent!.trim()).toBe('Ask AI');
      expect(/\p{Extended_Pictographic}/u.test(b!.textContent!)).toBe(false);
    }
  });
});

describe('Assistant panel — model select', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists Gemini + Claude; an unavailable one is greyed and can’t be picked', async () => {
    const p = setup();
    await p.settle();
    expect(p.cmp.providerOpts()).toEqual([
      { value: 'gemini', label: 'Gemini', hint: undefined, disabled: false },
      { value: 'claude', label: 'Claude', hint: 'Not available', disabled: true },
    ]);
    expect(p.cmp.provider()).toBe('gemini');
    p.cmp.setProvider('claude');
    expect(p.cmp.provider()).toBe('gemini');
  });

  it('remembers the pick and sends it', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const p = setup({ providers: () => of(BOTH.map((x) => ({ ...x, available: true }))) });
    await p.settle();
    p.cmp.setProvider('claude');
    expect(localStorage.getItem('pf.assistant.provider')).toBe('claude');
    p.type('Why is this analyzer offline?');
    p.sendBtn().click();
    expect(p.api.chat.mock.calls[0][1].provider).toBe('claude');
    vi.unstubAllGlobals();
  });

  it('no model available → says so in plain words, composer off', async () => {
    const p = setup({ providers: () => of(BOTH.map((x) => ({ ...x, available: false }))) });
    await p.settle();
    expect(p.el.querySelector('[data-state="none"]')!.textContent).toContain('No model is available right now');
    expect(p.el.querySelector<HTMLTextAreaElement>('.pf-asst__input')!.disabled).toBe(true);
  });

  it('providers 404 (assistant not on for this lab) → "Not available", no chat', async () => {
    const p = setup({ providers: () => throwError(() => new HttpErrorResponse({ status: 404 })) });
    await p.settle();
    const st = p.el.querySelector('[data-state="off"]')!;
    expect(st.textContent).toContain('Not available');
    expect(st.textContent).toContain('isn’t available for this lab');
    expect(p.el.querySelector('.pf-asst__input')).toBeNull();
  });
});

describe('Assistant panel — chat', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starter prompts send straight away; the request carries page, instrument and the turns', async () => {
    const p = setup();
    await p.settle();
    const starters = Array.from(p.el.querySelectorAll<HTMLButtonElement>('.pf-asst-starter')).map((b) => b.textContent!.trim());
    expect(starters).toEqual(['Why is this analyzer offline?', 'What should I set on the analyzer?', 'Suggest mappings for unmapped codes']);
    p.el.querySelector<HTMLButtonElement>('.pf-asst-starter')!.click();
    await p.settle();
    expect(p.api.chat).toHaveBeenCalledTimes(1);
    const [page, req] = p.api.chat.mock.calls[0];
    expect(page).toBe('instruments');
    expect(req).toEqual({ provider: 'gemini', instrumentId: 'i1', messages: [{ role: 'user', text: 'Why is this analyzer offline?' }] });
    expect(p.el.querySelector('.pf-asst-msg--user')!.textContent).toContain('Why is this analyzer offline?');
    const bot = p.el.querySelector('.pf-asst-msg--bot')!;
    expect(bot.querySelector('strong')!.textContent).toBe('not connected');
    expect(bot.querySelectorAll('.pf-asst-md__ul li')).toHaveLength(2);
    expect(bot.querySelector('.pf-asst-msg__by')!.textContent).toContain('Gemini');
  });

  it('Enter sends, Shift+Enter doesn’t; the next question carries the whole conversation', async () => {
    const p = setup();
    await p.settle();
    p.type('first');
    const ta = p.el.querySelector<HTMLTextAreaElement>('.pf-asst__input')!;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(p.api.chat).not.toHaveBeenCalled();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await p.settle();
    p.type('second');
    p.sendBtn().click();
    await p.settle();
    expect(p.api.chat.mock.calls[1][1].messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('while waiting: the AI glow + "is thinking", Send off; New chat clears', async () => {
    const pending = new Subject<AssistantReply>();
    const p = setup({ chat: () => pending });
    await p.settle();
    p.type('hello'); p.sendBtn().click(); p.f.detectChanges();
    expect(p.el.querySelector('.pf-asst__thread')!.getAttribute('data-ai-working')).toBe('true');
    expect(p.el.querySelector('.pf-asst-msg--pending')!.textContent).toContain('Gemini is thinking');
    p.type('more');
    expect(p.sendBtn().disabled).toBe(true);
    pending.next(REPLY); pending.complete();
    await p.settle();
    expect(p.el.querySelector('.pf-asst-msg--pending')).toBeNull();
    p.el.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click();
    p.f.detectChanges();
    expect(p.el.querySelectorAll('.pf-asst-msg')).toHaveLength(0);
  });

  it('model text is never HTML: tags stay text, only http(s) links become anchors (new tab, no opener)', async () => {
    const p = setup({ chat: () => of({ ...REPLY, suggestions: [],
      reply: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script> [bad](javascript:void0) [ok](https://prefrontal.health/help)' }) });
    await p.settle();
    p.type('x'); p.sendBtn().click();
    await p.settle();
    const md = p.el.querySelector('.pf-asst-md')!;
    expect(md.querySelector('img, script, iframe')).toBeNull();
    expect(md.textContent).toContain('<img src=x');
    const links = Array.from(md.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://prefrontal.health/help');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    expect(md.textContent).toContain('bad');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe('Assistant panel — suggestion cards', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function withReply(o: SetupOpts = {}) {
    const p = setup(o);
    await p.settle();
    p.type('Suggest mappings'); p.sendBtn().click();
    await p.settle();
    return p;
  }

  it('setting → value + Copy (clipboard, toast)', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const p = await withReply();
    const card = p.el.querySelector('.pf-asst-card[data-kind="setting"]')!;
    expect(card.querySelector('.pf-asst-card__label')!.textContent).toBe('Host IP');
    expect(card.querySelector('.pf-asst-card__value')!.textContent).toBe('192.168.1.8');
    card.querySelector<HTMLButtonElement>('button')!.click();
    await p.settle();
    expect(writeText).toHaveBeenCalledWith('192.168.1.8');
    expect(p.toasts.success).toHaveBeenCalledWith('Copied');
  });

  it('action → its text, no button', async () => {
    const p = await withReply();
    const card = p.el.querySelector('.pf-asst-card[data-kind="action"]')!;
    expect(card.textContent).toContain('Enable Checksum on the Snibe');
    expect(card.querySelector('button')).toBeNull();
  });

  it('mapping → "GLU (mg/dL) → Fasting Blood Sugar · BIO010"; Add to mapping hands off the row (no save)', async () => {
    const p = await withReply();
    const card = p.el.querySelector('.pf-asst-card[data-kind="mapping"]')!;
    expect(card.querySelector('.pf-asst-card__map code')!.textContent).toBe('GLU (mg/dL)');
    expect(card.querySelector('.pf-asst-card__map svg')!.getAttribute('aria-label')).toBe('maps to');
    expect(card.querySelector('.pf-asst-card__map span')!.textContent).toBe('Fasting Blood Sugar · BIO010');
    expect(card.querySelector('.pf-asst-conf')!.textContent).toBe('Strong match');
    card.querySelector<HTMLButtonElement>('button')!.click();
    p.f.detectChanges();
    expect(p.added).toEqual([{ instrumentId: 'i1', analyzerCode: 'GLU', unit: 'mg/dL', testId: 't1', testCode: 'BIO010', testName: 'Fasting Blood Sugar' }]);
    expect(card.querySelector('.pf-asst-card__done')!.textContent).toContain('Added — check it and Save');
  });

  it('mapping when it can’t be added yet: button off + why (connect wizard before Create)', async () => {
    const p = await withReply({ context: { instrumentId: null, canAddMapping: false, addMappingHint: 'Create the instrument first (step 3) — then add its mappings.' } });
    const card = p.el.querySelector('.pf-asst-card[data-kind="mapping"]')!;
    expect(card.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    expect(card.textContent).toContain('Create the instrument first');
  });

  it('list page: pick the instrument, then Add to mapping carries its id', async () => {
    const p = await withReply({ context: { instrumentId: null, canAddMapping: undefined, instruments: [{ id: 'i7', name: 'Snibe' }] } });
    const btn = () => p.el.querySelector<HTMLButtonElement>('.pf-asst-card[data-kind="mapping"] button')!;
    expect(btn().disabled).toBe(true);
    expect(p.el.textContent).toContain('Pick the instrument above');
    p.cmp.instrumentPick.set('i7'); p.f.detectChanges();
    btn().click();
    expect(p.added[0].instrumentId).toBe('i7');
  });
});

describe('Assistant panel — error states in plain words', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function failWith(err: unknown) {
    const p = setup({ chat: () => throwError(() => err) });
    await p.settle();
    p.type('hello'); p.sendBtn().click();
    await p.settle();
    return p;
  }

  it('limit reached → says so, no Try again', async () => {
    const p = await failWith(new HttpErrorResponse({ status: 429, error: { error: 'ai_cap_reached', message: 'cap' } }));
    const e = p.el.querySelector('[data-error="limit"]')!;
    expect(e.textContent).toContain('used its AI allowance');
    expect(e.querySelector('button')).toBeNull();
  });

  it('model unavailable → names it; Try again resends the same conversation', async () => {
    const p = await failWith(new HttpErrorResponse({ status: 503, error: { error: 'ai_unavailable' } }));
    const e = p.el.querySelector('[data-error="provider"]')!;
    expect(e.textContent).toContain('Gemini isn’t available right now');
    p.api.chat.mockImplementation(() => of(REPLY));
    e.querySelector<HTMLButtonElement>('button')!.click();
    await p.settle();
    expect(p.api.chat).toHaveBeenCalledTimes(2);
    expect(p.api.chat.mock.calls[1][1].messages).toEqual([{ role: 'user', text: 'hello' }]);
    expect(p.el.querySelector('[data-error]')).toBeNull();
    expect(p.el.querySelectorAll('.pf-asst-msg--user')).toHaveLength(1);
  });

  it('assistant switched off mid-way (404) and network', async () => {
    let p = await failWith(new HttpErrorResponse({ status: 404 }));
    expect(p.el.querySelector('[data-error="off"]')!.textContent).toContain('isn’t available for this lab');
    TestBed.resetTestingModule();
    p = await failWith(new HttpErrorResponse({ status: 0 }));
    expect(p.el.querySelector('[data-error="network"]')!.textContent).toContain('Check the connection');
  });
});

describe('Assistant panel — this PC’s network check (desktop)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('web: no chip, no diag sent', async () => {
    const p = setup();
    await p.settle();
    expect(p.el.querySelector('.pf-asst__diag')).toBeNull();
    p.type('x'); p.sendBtn().click();
    expect('diag' in p.api.chat.mock.calls[0][1]).toBe(false);
  });

  it('desktop: attaches the snapshot with a visible chip; × removes it from the next question; it can be added back', async () => {
    const snap = { hostname: 'LAB-PC', adapters: [{ address: '192.168.1.8' }] };
    const p = setup({ diag: async () => snap });
    await p.settle();
    const chip = p.el.querySelector('.pf-asst-chip--diag')!;
    expect(chip.textContent).toContain('Includes this PC’s network check');
    p.type('one'); p.sendBtn().click();
    await p.settle();
    expect(p.api.chat.mock.calls[0][1].diag).toEqual(snap);
    p.el.querySelector<HTMLButtonElement>('.pf-asst-chip__x')!.click();
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-asst-chip--diag')).toBeNull();
    p.type('two'); p.sendBtn().click();
    await p.settle();
    expect('diag' in p.api.chat.mock.calls[1][1]).toBe(false);
    p.el.querySelector<HTMLButtonElement>('.pf-asst__diagadd')!.click();
    await p.settle();
    expect(p.el.querySelector('.pf-asst-chip--diag')).not.toBeNull();
  });

  it('a page that already has the check (connect wizard) passes it — no second run', async () => {
    const p = setup({ diag: async () => ({ other: true }), context: { diag: { hostname: 'WIZ' } } });
    await p.settle();
    expect(p.bridge!.diag.snapshot).not.toHaveBeenCalled();
    p.type('x'); p.sendBtn().click();
    expect(p.api.chat.mock.calls[0][1].diag).toEqual({ hostname: 'WIZ' });
  });

  it('the check failing says so and offers to try again', async () => {
    const p = setup({ diag: async () => { throw new Error('denied'); } });
    await p.settle();
    expect(p.el.querySelector('.pf-asst__diag')!.textContent).toContain('Couldn’t check this PC’s network');
  });
});

describe('AssistantApiService — the contract', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('GET /api/assistant/providers and POST /api/assistant/instruments/chat (envelope tolerated)', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.test' } }],
    });
    const svc = TestBed.inject(AssistantApiService);
    const http = TestBed.inject(HttpTestingController);
    let provs: AssistantProvider[] = [];
    svc.providers().subscribe((x) => (provs = x));
    http.expectOne('https://api.test/api/assistant/providers').flush({ success: true, data: BOTH });
    expect(provs).toEqual(BOTH);

    let reply: AssistantReply | null = null;
    const body: AssistantChatRequest = { provider: 'claude', instrumentId: 'i1', messages: [{ role: 'user', text: 'hi' }] };
    svc.chat('instruments', body).subscribe((r) => (reply = r));
    const req = http.expectOne('https://api.test/api/assistant/instruments/chat');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ success: true, data: REPLY });
    expect(reply).toEqual(REPLY);

    let err: unknown = null;
    svc.chat('instruments', body).subscribe({ error: (e) => (err = e) });
    http.expectOne('https://api.test/api/assistant/instruments/chat').flush({ success: false, error: 'ai_cap_reached', message: 'cap' });
    expect(err).toMatchObject({ error: { error: 'ai_cap_reached' } });
    http.verify();
  });
});
