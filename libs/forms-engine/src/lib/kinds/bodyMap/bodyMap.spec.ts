import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { ptr } from '../../canvas/canvas.spec-helpers';
import { CanvasAnswer } from '../../canvas/answer';
import { optionChosen } from '../../core/pages';
import { evaluateCondition } from '../../core/rules';
import { Answers, FieldDef } from '../../core/types';
import { FE_ASSETS, FE_KINDS } from '../../fill/contract';
import { FieldHostComponent } from '../../fill/field-host.component';
import { examplesOf } from '../../testing/examples';
import { renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { mockStarter } from '../../testing/starter-art';
import { TestAssetStore } from '../../testing/test-assets';
import { KIND_SPECS } from '../registry';
import { BodyMapFill } from './bodyMap.fill';

const [withRegions, withMarkers] = examplesOf('bodyMap');
const settle = async (r: { stable(): Promise<void> }) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((res) => setTimeout(res));
    await r.stable();
  }
};

/** A region's centre in surface px (jsdom: the view is picture units 1:1). */
function centre(id: string): { x: number; y: number } {
  const s = mockStarter('body-front')!;
  const r = s.regions.find((x) => x.id === id)!;
  const x = r.points.reduce((a, p) => a + p[0], 0) / r.points.length;
  const y = r.points.reduce((a, p) => a + p[1], 0) / r.points.length;
  return { x: x * s.width, y: y * s.height };
}

describe('bodyMap fill', () => {
  it.each(examplesOf('bodyMap').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(BodyMapFill, ex.field, ex.answers[ex.field.key], { assets: new TestAssetStore() });
    await settle(r);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('marked areas show under the picture with their notes; mark is the first tool', async () => {
    const r = await renderKind(BodyMapFill, withRegions.field, withRegions.answers['findings'], { assets: new TestAssetStore() });
    await settle(r);
    expect(r.el.querySelector('.fe-cv__tool[aria-checked="true"]')?.getAttribute('data-tool')).toBe('mark');
    expect(r.el.querySelector('[data-marked="right-knee"] input')).toHaveProperty('value', 'with warmth');
    expect(r.el.querySelector('.fe-cv__pin')?.textContent?.trim()).toBe('1');
    const note = r.el.querySelector<HTMLInputElement>('[data-marked="abdomen"] input')!;
    note.value = 'burning';
    note.dispatchEvent(new Event('change'));
    await r.stable();
    expect((r.last() as CanvasAnswer).regions).toEqual([{ id: 'abdomen', note: 'burning' }, { id: 'right-knee', note: 'with warmth' }]);
  });

  it('a tap marks the area under it; Clear removes it (no answer left)', async () => {
    const field = { ...withRegions.field, config: { template: 'body-front' } };
    const r = await renderKind(BodyMapFill, field, null, { assets: new TestAssetStore() });
    await settle(r);
    const c = centre('right-knee');
    const s = r.el.querySelector('.fe-cv__surface')!;
    ptr(s, 'pointerdown', c.x, c.y, { kind: 'touch' });
    ptr(s, 'pointerup', c.x, c.y, { kind: 'touch' });
    await r.stable();
    expect((r.last() as CanvasAnswer).regions).toEqual([{ id: 'right-knee' }]);
    await r.click('[data-marked="right-knee"] .fe-iconbtn');
    expect(r.last()).toBeUndefined();
  });

  it('fixed markers: tap to mark (an option); the answer lists the keys', async () => {
    const r = await renderKind(BodyMapFill, withMarkers.field, null, { assets: new TestAssetStore() });
    await settle(r);
    const m = r.el.querySelector<HTMLButtonElement>('[data-marker="jaw"]')!;
    expect(m.getAttribute('aria-label')).toContain('Jaw');
    m.click();
    await r.stable();
    expect((r.last() as CanvasAnswer).markers).toEqual(['jaw']);
    expect(m.getAttribute('aria-pressed')).toBe('true');
  });

  it('a pin opens its card: quick picks, what, note', async () => {
    const field = { ...withRegions.field, config: { ...withRegions.field.config, pinLabels: ['Tender', 'Swelling'] } };
    const r = await renderKind(BodyMapFill, field, withRegions.answers['findings'], { assets: new TestAssetStore() });
    await settle(r);
    await r.click('[data-pin-chip="1"]');
    const panel = r.el.querySelector('[data-pin-panel="1"]')!;
    expect(panel.querySelector<HTMLInputElement>('[data-pin-label]')!.value).toBe('Scar');
    await r.click(r.byText('Tender'));
    expect((r.last() as CanvasAnswer).pins![0].label).toBe('Tender');
    const note = r.el.querySelector<HTMLInputElement>('[data-pin-note]')!;
    note.value = '2 cm';
    note.dispatchEvent(new Event('change'));
    await r.stable();
    expect((r.last() as CanvasAnswer).pins![0]).toMatchObject({ label: 'Tender', note: '2 cm' });
  });

  it('tapped markers are chosen options: follow-ups open, conditions read them', () => {
    const v = { markers: ['jaw'] };
    expect(optionChosen(v, 'jaw')).toBe(true);
    expect(optionChosen(v, 'forehead')).toBe(false);
    expect(evaluateCondition(v, 'contains', 'jaw')).toBe(true);
    expect(evaluateCondition(v, 'notContains', 'jaw')).toBe(false);
  });

  it('in the field host, a marker’s follow-up questions open under the picture', async () => {
    @Component({
      standalone: true,
      imports: [FieldHostComponent],
      template: `<fe-field [field]="field" [scope]="scope()" [lookup]="lookup" [setValue]="set" />`,
    })
    class H {
      field: FieldDef = withMarkers.field;
      scope = signal<Answers>({ sites: { markers: ['forehead'] } });
      lookup = (k: string) => this.scope()[k];
      set = (k: string, v: unknown) => this.scope.update((s) => ({ ...s, [k]: v }));
    }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: FE_KINDS, useValue: KIND_SPECS },
        { provide: FE_ASSETS, useValue: new TestAssetStore() },
      ],
    });
    const fx = TestBed.createComponent(H);
    fx.detectChanges();
    await fx.whenStable();
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-follow="forehead"] [data-field="foreheadSeverity"]')).not.toBeNull();
    expect(el.querySelector('.fe-later')).toBeNull();
  });
});
