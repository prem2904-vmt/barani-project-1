import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FeDialog } from '../kit';
import { CanvasComponent, CanvasTool } from './canvas.component';
import { CanvasRegion, CanvasValue, emptyCanvas } from './canvas-model';

/** Synthetic pointer events (jsdom has no PointerEvent): what an iPad / Pencil / mouse sends. */
export function ptr(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  o: { id?: number; kind?: string; pressure?: number; button?: number } = {},
): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: o.button ?? 0 });
  Object.defineProperties(e, {
    pointerId: { value: o.id ?? 1 },
    pointerType: { value: o.kind ?? 'pen' },
    pressure: { value: o.pressure ?? 0.5 },
    width: { value: 1 },
    height: { value: 1 },
  });
  el.dispatchEvent(e);
}

const regions: CanvasRegion[] = [
  { key: 'rightKnee', label: 'Right knee', shape: { type: 'poly', points: [0, 0, 100, 0, 100, 100, 0, 100] } },
];

@Component({
  standalone: true,
  imports: [CanvasComponent],
  template: `<fe-canvas
    [value]="value()"
    [regions]="regions"
    [tools]="tools()"
    (changed)="changed.push($event); value.set($event)"
    (pinTapped)="pins.push($event)"
  />`,
})
class Host {
  readonly value = signal<CanvasValue>(emptyCanvas(1000, 625));
  readonly tools = signal<CanvasTool[]>(['pen', 'eraser', 'text', 'mark', 'pin']);
  readonly regions = regions;
  readonly changed: CanvasValue[] = [];
  readonly pins: string[] = [];
  readonly cv = viewChild.required(CanvasComponent);
}

async function setup(prompt: string | null = 'Scar') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: FeDialog, useValue: { prompt: async () => prompt, confirm: async () => true } }],
  });
  const fx = TestBed.createComponent(Host);
  fx.detectChanges();
  await fx.whenStable();
  const el = fx.nativeElement as HTMLElement;
  const surface = el.querySelector('.fe-cv__surface')!;
  const stable = async () => {
    fx.detectChanges();
    await fx.whenStable();
    fx.detectChanges();
  };
  const draw = async (pts: [number, number][], o: { id?: number; kind?: string; pressure?: number } = {}) => {
    ptr(surface, 'pointerdown', pts[0][0], pts[0][1], o);
    for (const [x, y] of pts.slice(1)) ptr(surface, 'pointermove', x, y, o);
    ptr(surface, 'pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1], o);
    await stable();
  };
  return { fx, host: fx.componentInstance, el, surface, stable, draw };
}

describe('fe-canvas (the engine surface)', () => {
  it('a Pencil stroke is captured as vector points with pressure, one change per stroke', async () => {
    const t = await setup();
    await t.draw(
      [
        [10, 10],
        [40, 20],
        [80, 60],
      ],
      { pressure: 0.8 },
    );
    expect(t.host.changed).toHaveLength(1);
    const s = t.host.value().ink[0];
    expect(s.pen).toBe(true);
    expect(s.points).toEqual([10, 10, 0.8, 40, 20, 0.8, 80, 60, 0.8]);
    expect(s.color).toBe('#111827');
    expect(t.el.querySelectorAll('path.fe-ink')).toHaveLength(1);
  });

  it('undo / redo (buttons and Ctrl+Z / Ctrl+Shift+Z)', async () => {
    const t = await setup();
    await t.draw([
      [10, 10],
      [50, 50],
    ]);
    await t.draw([
      [100, 10],
      [150, 50],
    ]);
    expect(t.host.value().ink).toHaveLength(2);
    t.el.querySelector<HTMLButtonElement>('[data-act="undo"]')!.click();
    await t.stable();
    expect(t.host.value().ink).toHaveLength(1);
    t.el.querySelector<HTMLButtonElement>('[data-act="redo"]')!.click();
    await t.stable();
    expect(t.host.value().ink).toHaveLength(2);
    t.el.querySelector('fe-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await t.stable();
    expect(t.host.value().ink).toHaveLength(1);
    t.el
      .querySelector('fe-canvas')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await t.stable();
    expect(t.host.value().ink).toHaveLength(2);
  });

  it('the eraser removes whole strokes it crosses, as one undo step (never paints white)', async () => {
    const t = await setup();
    await t.draw([
      [10, 100],
      [300, 100],
    ]);
    await t.draw([
      [10, 400],
      [300, 400],
    ]);
    t.host.cv().pickTool('eraser');
    await t.draw([
      [150, 50],
      [150, 150],
    ]);
    expect(t.host.value().ink).toHaveLength(1);
    expect(t.host.value().ink[0].points[1]).toBe(400);
    t.host.cv().undo();
    await t.stable();
    expect(t.host.value().ink).toHaveLength(2);
  });

  it('palm rejection on the surface: a finger after the Pencil does not draw', async () => {
    const t = await setup();
    await t.draw([
      [10, 10],
      [50, 50],
    ]);
    await t.draw(
      [
        [200, 200],
        [260, 260],
      ],
      { kind: 'touch', id: 7 },
    );
    expect(t.host.value().ink).toHaveLength(1);
  });

  it('mark tool: a tap toggles the region under it; tapping again clears it', async () => {
    const t = await setup();
    t.host.cv().pickTool('mark');
    await t.draw([[50, 50]], { kind: 'touch' });
    expect(t.host.value().regions).toEqual(['rightKnee']);
    await t.draw([[50, 50]], { kind: 'touch' });
    expect(t.host.value().regions).toEqual([]);
    await t.draw([[500, 500]], { kind: 'touch' });
    expect(t.host.changed).toHaveLength(2);
  });

  it('pin tool: a tap drops a numbered pin on the region and opens it', async () => {
    const t = await setup();
    t.host.cv().pickTool('pin');
    await t.draw([[50, 50]], { kind: 'touch' });
    const p = t.host.value().pins[0];
    expect(p).toMatchObject({ n: 1, x: 50, y: 50, region: 'rightKnee' });
    expect(t.host.pins).toEqual([p.id]);
    const btn = t.el.querySelector<HTMLButtonElement>('.fe-cv__pin')!;
    expect(btn.getAttribute('aria-label')).toContain('Pin 1');
    expect(btn.getAttribute('aria-label')).toContain('Right knee');
  });

  it('text tool: a tap asks for the words (FeDialog, never window.prompt) and writes a label', async () => {
    const t = await setup('3 cm scar');
    t.host.cv().pickTool('text');
    await t.draw([[200, 300]], { kind: 'mouse' });
    await new Promise((r) => setTimeout(r));
    await t.stable();
    expect(t.host.value().labels[0]).toMatchObject({ text: '3 cm scar', x: 200, y: 300 });
    expect(t.el.querySelector('text.fe-cv__label')?.textContent?.trim()).toBe('3 cm scar');
  });

  it('colour and thickness: the tray applies to the next stroke', async () => {
    const t = await setup();
    t.el.querySelector<HTMLButtonElement>('[data-act="style"]')!.click();
    await t.stable();
    t.el.querySelector<HTMLButtonElement>('.fe-cv__swatch[data-color="#dc2626"]')!.click();
    t.el.querySelector<HTMLButtonElement>('.fe-cv__swatch[data-size="thick"]')!.click();
    await t.stable();
    await t.draw([
      [10, 10],
      [50, 50],
    ]);
    expect(t.host.value().ink[0]).toMatchObject({ color: '#dc2626', size: 12 });
  });

  it('an outside value (reload) replaces the picture and restarts history', async () => {
    const t = await setup();
    await t.draw([
      [10, 10],
      [50, 50],
    ]);
    t.host.value.set({ ...emptyCanvas(1000, 625), regions: ['rightKnee'] });
    await t.stable();
    expect(t.el.querySelector<HTMLButtonElement>('[data-act="undo"]')!.disabled).toBe(true);
    expect(t.el.querySelector('path.fe-cv__region.is-marked')).not.toBeNull();
  });

  it('DPR-sharp by construction: ink is SVG geometry, the same at any device pixel ratio', async () => {
    const at = async (dpr: number) => {
      Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
      const t = await setup();
      await t.draw([
        [10, 10],
        [40, 30],
        [90, 20],
      ]);
      return t.el.querySelector('path.fe-ink')!.getAttribute('d');
    };
    const one = await at(1);
    expect(await at(3)).toBe(one);
    expect(document.querySelector('fe-canvas canvas')).toBeNull(); // no bitmap to blur
  });

  it('full screen lifts the same picture above the page (nothing lost); Escape puts it back', async () => {
    const t = await setup();
    await t.draw([
      [10, 10],
      [50, 50],
    ]);
    const cv = t.el.querySelector('fe-canvas')!;
    t.el.querySelector<HTMLButtonElement>('[data-act="full"]')!.click();
    await t.stable();
    expect(cv.classList.contains('fe-cv--full')).toBe(true);
    expect(cv.parentElement).toBe(document.body); // out of any card / sheet transform
    expect(cv.querySelectorAll('path.fe-ink')).toHaveLength(1);
    cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await t.stable();
    expect(cv.classList.contains('fe-cv--full')).toBe(false);
    expect(t.el.contains(cv)).toBe(true);
    expect(t.host.value().ink).toHaveLength(1);
  });

  it('every button is touch-sized and named', async () => {
    const t = await setup();
    for (const b of t.el.querySelectorAll('button')) {
      expect(b.className).toMatch(/fe-cv__tool|fe-cv__swatch|fe-cv__pin/);
      expect(b.getAttribute('aria-label') || b.textContent?.trim()).toBeTruthy();
    }
  });
});
