import { signal } from '@angular/core';
import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { VoiceInput } from '../../fill/contract';
import { TextFill } from './text.fill';

function fakeVoice(words: string | Error, available = true) {
  const started: { label: string }[] = [];
  const voice: VoiceInput = {
    available: signal(available),
    start: async (ctx) => {
      started.push(ctx);
      return {
        stop: async () => {
          if (words instanceof Error) throw words;
          return words;
        },
        cancel: () => undefined,
      };
    },
  };
  return { voice, started };
}

const input = (el: HTMLElement) => el.querySelector<HTMLInputElement | HTMLTextAreaElement>('.fe-text__input')!;

describe('text fill', () => {
  it.each(examplesOf('text').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(TextFill, ex.field, ex.answers[ex.field.key]);
    expect(input(r.el).value).toBe(ex.answers[ex.field.key]);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('typing writes the text; clearing writes nothing', async () => {
    const r = await renderKind(TextFill, f('occ', 'text', { label: 'Occupation' }), null);
    const i = input(r.el);
    i.value = 'Teacher';
    i.dispatchEvent(new Event('input'));
    expect(r.last()).toBe('Teacher');
    i.value = '';
    i.dispatchEvent(new Event('input'));
    expect(r.last()).toBeUndefined();
  });

  it('is named by the field label, 16px-ready input class, no native date/select', async () => {
    const r = await renderKind(TextFill, f('n', 'text', { label: 'Name' }), null);
    expect(input(r.el).getAttribute('aria-labelledby')).toBe('lbl');
    expect(input(r.el).classList).toContain('fe-text__input');
  });

  it('a long note is a textarea that grows (no inner scroller)', async () => {
    const r = await renderKind(TextFill, f('addr', 'text', { label: 'Address', config: { multiline: true } }), 'x');
    expect(r.el.querySelector('textarea.fe-text__input')).not.toBeNull();
  });

  it('phone and e-mail bring the right keyboard', async () => {
    const p = await renderKind(TextFill, f('ph', 'text', { label: 'Phone', config: { format: 'phone' } }), null);
    expect(input(p.el).getAttribute('type')).toBe('tel');
    expect(input(p.el).getAttribute('inputmode')).toBe('tel');
    const e = await renderKind(TextFill, f('em', 'text', { label: 'E-mail', config: { format: 'email' } }), null);
    expect(input(e.el).getAttribute('type')).toBe('email');
  });

  it('no mic when dictation is not set up', async () => {
    const none = await renderKind(TextFill, f('a', 'text', { label: 'Note' }), null);
    expect(none.el.querySelector('.fe-mic')).toBeNull();
    const off = await renderKind(TextFill, f('a', 'text', { label: 'Note' }), null, {
      voice: fakeVoice('x', false).voice,
    });
    expect(off.el.querySelector('.fe-mic')).toBeNull();
    const fieldOff = await renderKind(TextFill, f('a', 'text', { label: 'Note', config: { voice: false } }), null, {
      voice: fakeVoice('x').voice,
    });
    expect(fieldOff.el.querySelector('.fe-mic')).toBeNull();
    // legacy: a one-line box never has a mic beside it, even with dictation set up
    const line = await renderKind(TextFill, f('a', 'text', { label: 'Occupation' }), null, { voice: fakeVoice('x').voice });
    expect(line.el.querySelector('.fe-mic')).toBeNull();
    const note = await renderKind(TextFill, f('a', 'text', { label: 'Address', config: { multiline: true } }), null, {
      voice: fakeVoice('x').voice,
    });
    expect(note.el.querySelector('.fe-text--mic .fe-mic--inline')).not.toBeNull();
  });

  it('the mic APPENDS what was said (never replaces), with the field label as context', async () => {
    const { voice, started } = fakeVoice('worse at night');
    const r = await renderKind(TextFill, f('notes', 'text', { label: 'Notes', config: { multiline: true } }), 'Blocked nose', { voice });
    const mic = r.el.querySelector<HTMLButtonElement>('.fe-mic')!;
    expect(mic.getAttribute('aria-label')).toBe('Dictate Notes');
    await r.click(mic);
    expect(started).toEqual([{ label: 'Notes' }]);
    expect(mic.getAttribute('aria-pressed')).toBe('true');
    expect(r.el.textContent).toContain('Listening');
    await r.click(mic);
    await r.stable();
    expect(r.last()).toBe('Blocked nose worse at night');
    expect(mic.getAttribute('aria-pressed')).toBe('false');
  });

  it('dictation that fails says so plainly and keeps the text', async () => {
    const { voice } = fakeVoice(new Error('down'));
    const r = await renderKind(TextFill, f('notes', 'text', { label: 'Notes', config: { multiline: true } }), 'kept', { voice });
    await r.click('.fe-mic');
    await r.click('.fe-mic');
    await r.stable();
    expect(r.calls).toEqual([]);
    expect(r.el.textContent).toContain("Couldn't hear that");
  });
});
