import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuilderError } from './builder-models';
import { CortexChatComponent } from './cortex-chat.component';
import { openBuilder } from './builder-testing';

afterEach(() => TestBed.resetTestingModule());

describe('Cortex chat', () => {
  it('sends the message with the form id, shows the steps in plain words, and keeps the conversation going', async () => {
    const { api, chat, id } = await openBuilder();
    api.cortex.mockResolvedValueOnce({ conversationId: 'c9', reply: 'I added it.', steps: [{ tool: 'add_question', summary: "Added 'Cough' with a follow-up 'For how many days'", changed: true }], formChanged: false });
    await chat.send('  add cough  ');
    expect(api.cortex).toHaveBeenCalledWith(id, 'add cough', undefined);
    expect(chat.messages().map((m) => [m.from, m.text])).toEqual([['user', 'add cough'], ['cortex', 'I added it.']]);
    expect(chat.messages()[1].steps![0].summary).toContain("Added 'Cough'");
    await chat.send('and fever');
    expect(api.cortex).toHaveBeenLastCalledWith(id, 'and fever', 'c9');
  });

  it('renders the banner, "Cortex is working…" while waiting, and each step', async () => {
    const { api, chat } = await openBuilder();
    let release!: () => void;
    api.cortex.mockImplementationOnce(() => new Promise((r) => { release = () => r({ conversationId: 'c', reply: 'Ok', steps: [{ tool: 't', summary: 'Added a page', changed: true }], formChanged: false }); }));
    const f = TestBed.createComponent(CortexChatComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-draft-banner]')!.textContent).toContain('Cortex only edits the draft. You publish.');
    const p = chat.send('hello');
    await Promise.resolve();
    f.detectChanges();
    expect(el.querySelector('[data-working]')!.textContent).toContain('Cortex is working…');
    expect((el.querySelector('[data-act="send"]') as HTMLButtonElement).disabled).toBe(true);
    release();
    await p;
    f.detectChanges();
    expect(el.querySelector('[data-working]')).toBeNull();
    expect(el.querySelector('[data-steps]')!.textContent).toContain('Added a page');
  });

  it('typing then Send posts the message (Send is off while the box is empty)', async () => {
    const { api } = await openBuilder();
    const f = TestBed.createComponent(CortexChatComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const send = el.querySelector('[data-act="send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const box = el.querySelector('[data-box]') as HTMLTextAreaElement;
    box.value = 'add cough';
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(send.disabled).toBe(false);
    send.click();
    await f.whenStable();
    expect(api.cortex).toHaveBeenCalledTimes(1);
  });

  it('formChanged reloads the draft into the editor (and re-runs the checks)', async () => {
    const { api, chat, session, checks } = await openBuilder();
    const reload = vi.spyOn(session, 'reloadDraft');
    const run = vi.spyOn(checks, 'run').mockResolvedValue();
    api.cortex.mockResolvedValueOnce({ conversationId: 'c', reply: 'Added.', steps: [], formChanged: true, draftVersion: 3 });
    await chat.send('add cough');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalled();
  });

  it('no formChanged, no reload', async () => {
    const { chat, session } = await openBuilder();
    const reload = vi.spyOn(session, 'reloadDraft');
    await chat.send('what can you do?');
    expect(reload).not.toHaveBeenCalled();
  });

  it('unsaved edits are saved BEFORE the message goes', async () => {
    const { chat, session, api } = await openBuilder();
    const order: string[] = [];
    vi.spyOn(session, 'flush').mockImplementation(async () => { order.push('flush'); });
    api.cortex.mockImplementationOnce(async () => { order.push('cortex'); return { conversationId: 'c', reply: 'ok', steps: [], formChanged: false }; });
    await chat.send('hi');
    expect(order).toEqual(['flush', 'cortex']);
  });

  it('if the screen cannot be saved, the message is NOT sent and the person is told', async () => {
    const { chat, session, api } = await openBuilder();
    vi.spyOn(session, 'flush').mockResolvedValue();
    session.saveState.set('error');
    await chat.send('hi');
    expect(api.cortex).not.toHaveBeenCalled();
    const last = chat.messages().at(-1)!;
    expect(last.error).toBe(true);
    expect(last.text).toMatch(/aren't saved/);
  });

  it('a local edit made while Cortex worked asks before it is replaced; "Keep my changes" does not reload', async () => {
    const { chat, session, api, dialog } = await openBuilder();
    const reload = vi.spyOn(session, 'reloadDraft');
    api.cortex.mockImplementationOnce(async () => {
      session.saveState.set('dirty'); // the person kept typing
      return { conversationId: 'c', reply: 'Added.', steps: [], formChanged: true };
    });
    dialog.confirm.mockResolvedValueOnce(false);
    await chat.send('add cough');
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(dialog.confirm.mock.calls[0][0]).toMatchObject({ tone: 'danger' });
    expect(reload).not.toHaveBeenCalled();
    expect(chat.messages().at(-1)!.text).toMatch(/Kept your changes/);
  });

  it('"Use Cortex’s version" reloads', async () => {
    const { chat, session, api, dialog } = await openBuilder();
    const reload = vi.spyOn(session, 'reloadDraft');
    api.cortex.mockImplementationOnce(async () => {
      session.saveState.set('dirty');
      return { conversationId: 'c', reply: 'Added.', steps: [], formChanged: true };
    });
    dialog.confirm.mockResolvedValueOnce(true);
    await chat.send('add cough');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['feature_off', 403, /switched off/],
    ['cortex_unavailable', 424, /isn't set up/],
    ['cap_reached', 429, /limit/],
  ])('%s shows plain words, not a code', async (code, status, words) => {
    const { chat, api } = await openBuilder();
    const words2 = { feature_off: 'Cortex form building is switched off for your lab.', cortex_unavailable: "Cortex isn't set up here yet.", cap_reached: "Cortex has reached today's limit." }[code]!;
    api.cortex.mockRejectedValueOnce(new BuilderError(code, words2, status));
    await chat.send('hi');
    const last = chat.messages().at(-1)!;
    expect(last.error).toBe(true);
    expect(last.text).toMatch(words);
    expect(last.text).not.toContain(code);
    expect(chat.working()).toBe(false);
  });

  it('a master (read-only) form cannot be chatted into', async () => {
    const { chat, session } = await openBuilder();
    session.readOnly.set(true);
    expect(chat.canSend()).toBe(false);
  });
});
