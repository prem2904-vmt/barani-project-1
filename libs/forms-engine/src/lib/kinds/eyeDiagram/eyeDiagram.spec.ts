import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { EyeDiagramFill, eomOf, gazePoint } from './eyeDiagram.fill';

function ptrAt(el: Element, type: string, x: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
  el.dispatchEvent(e);
}

/** jsdom has no layout: give each eye box a 200px square at a known place. */
function layout(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>('.fe-eye__box').forEach((b, i) => {
    b.getBoundingClientRect = () => ({ left: i * 300, top: 0, width: 200, height: 200, right: i * 300 + 200, bottom: 200, x: i * 300, y: 0, toJSON: () => ({}) }) as DOMRect;
  });
}
const at = (eye: number, i: number) => ({ x: eye * 300 + (gazePoint(i).x * 200) / 100, y: (gazePoint(i).y * 200) / 100 });

describe('eyeDiagram fill', () => {
  it.each(examplesOf('eyeDiagram').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(EyeDiagramFill, ex.field, ex.answers[ex.field.key]);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('eom: 8 markers per eye start full; a tap marks restricted', async () => {
    const r = await renderKind(EyeDiagramFill, f('eom', 'eyeDiagram', { config: { preset: 'movements' } }));
    expect(r.el.querySelectorAll('.fe-eye__mk')).toHaveLength(16);
    expect(r.el.querySelectorAll('.fe-eye__mk.is-restricted')).toHaveLength(0);
    layout(r.el);
    const box = r.el.querySelector('[data-eye="re"]')!;
    const p = at(0, 2);
    ptrAt(box, 'pointerdown', p.x, p.y);
    ptrAt(box, 'pointerup', p.x, p.y);
    await r.stable();
    expect(r.last()).toEqual({ re: ['+', '+', '-', '+', '+', '+', '+', '+'], le: Array(8).fill('+') });
    // the include switch (default shown) leaves it out of the words and the PDF
    await r.click('[data-act="include"]');
    expect((r.last() as { includeInPdf?: boolean }).includeInPdf).toBe(false);
  });

  it('eom: one slide toggles each marker it crosses once (the legacy gesture)', async () => {
    const r = await renderKind(EyeDiagramFill, f('eom', 'eyeDiagram', { config: { preset: 'movements' } }));
    layout(r.el);
    const box = r.el.querySelector('[data-eye="re"]')!;
    const a = at(0, 0);
    const b = at(0, 1);
    ptrAt(box, 'pointerdown', a.x, a.y);
    ptrAt(box, 'pointermove', a.x + 1, a.y);
    ptrAt(box, 'pointermove', b.x, b.y);
    ptrAt(box, 'pointermove', b.x, b.y + 1);
    ptrAt(box, 'pointerup', b.x, b.y);
    await r.stable();
    expect(eomOf(r.last()).re.slice(0, 3)).toEqual(['-', '-', '+']);
  });

  it('eom: keyboard Enter toggles; "All full again" resets; "Not examined" clears', async () => {
    const r = await renderKind(EyeDiagramFill, f('eom', 'eyeDiagram'), null);
    const mk = r.el.querySelector<HTMLButtonElement>('[data-eye="le"] [data-mk="4"]')!;
    mk.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await r.stable();
    expect(eomOf(r.last()).le[4]).toBe('-');
    expect(mk.getAttribute('aria-label')).toContain('Left eye, looking down: restricted');
    await r.click('[data-act="all-full"]');
    expect(r.last()).toEqual({ re: Array(8).fill('+'), le: Array(8).fill('+') });
    await r.click('[data-act="clear-eye"]');
    expect(r.last()).toBeUndefined();
  });

  it('boxes: labels, defaults and drop-down choices from the form; empty → no answer', async () => {
    const field = f('va', 'eyeDiagram', {
      config: {
        preset: 'boxes',
        boxes: {
          re: { top: { label: 'Lids', defaultValue: 'Normal' }, bottom: { label: 'Cornea', inputType: 'dropdown', options: ['Clear', 'Hazy'] } },
          le: { top: { label: 'Lids', defaultValue: 'Normal' } },
        },
      },
    });
    const r = await renderKind(EyeDiagramFill, field, null);
    expect(r.el.querySelector('[data-eye="re"] [data-box="top"]')?.textContent).toContain('Lids');
    expect(r.el.querySelector('[data-eye="re"] [data-box="top"]')?.textContent).toContain('Normal');
    await r.click('[data-eye="re"] [data-box="bottom"]');
    expect(r.el.querySelector('[data-eye-input]')).toBeNull(); // a drop-down box offers only its choices
    await r.click(r.byText('Hazy'));
    expect(r.last()).toEqual({ re: { top: 'Normal', bottom: 'Hazy' }, le: { top: 'Normal' } });
  });
});
