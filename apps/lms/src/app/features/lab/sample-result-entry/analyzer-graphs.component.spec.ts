import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AnalyzerGraphsComponent, type AnalyzerGraph } from './analyzer-graphs.component';
import { UploadsService } from '../../../core/services/uploads.service';

const G = (code: string, label: string, show = true): AnalyzerGraph =>
  ({ key: 'l:' + code, lineId: 'l', attachmentId: 'a' + code, code, label, url: '/uploads/t/' + code + '.png', show });

function make(graphs = [G('12003', 'WBC histogram'), G('12053', 'RBC histogram', false), G('12153', 'WBC DIFF scattergram')], readOnly = false) {
  TestBed.configureTestingModule({
    imports: [AnalyzerGraphsComponent],
    providers: [{ provide: UploadsService, useValue: { src: (u: string) => 'blob:' + u, isMissing: () => false } }],
  });
  const f = TestBed.createComponent(AnalyzerGraphsComponent);
  f.componentRef.setInput('graphs', graphs);
  f.componentRef.setInput('source', 'From Arun CBC · 5:02 PM');
  f.componentRef.setInput('readOnly', readOnly);
  f.detectChanges();
  return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement };
}

describe('AnalyzerGraphsComponent', () => {
  it('a thumbnail per graph (authenticated blob src), its human label, code and the run source', () => {
    const { el } = make();
    expect(Array.from(el.querySelectorAll('.pf-ag__thumb img')).map(i => i.getAttribute('src')))
      .toEqual(['blob:/uploads/t/12003.png', 'blob:/uploads/t/12053.png', 'blob:/uploads/t/12153.png']);
    expect(el.textContent).toContain('RBC histogram');
    expect(el.textContent).toContain('Code 12053');
    expect(el.textContent).toContain('From Arun CBC · 5:02 PM');
  });

  it('the eye reports the print toggle; read-only (validate) hides it', () => {
    const { c, el } = make();
    const spy = vi.fn(); c.toggleShow.subscribe(spy);
    (el.querySelectorAll('.pf-ag__eye')[1] as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ code: '12053' }));
    TestBed.resetTestingModule();
    expect(make(undefined, true).el.querySelector('.pf-ag__eye')).toBeNull();
  });

  it('lightbox: opens on the tapped graph, arrows / swipe step (wrapping), Esc closes', () => {
    const { f, c, el } = make();
    (el.querySelectorAll('.pf-ag__thumb')[1] as HTMLButtonElement).click();
    f.detectChanges();
    const lb = () => el.querySelector('.pf-ag-lb') as HTMLElement | null;
    expect(lb()?.getAttribute('role')).toBe('dialog');
    expect(lb()?.textContent).toContain('RBC histogram');
    c.onKey(new KeyboardEvent('keydown', { key: 'ArrowRight' })); f.detectChanges();
    expect(lb()?.textContent).toContain('WBC DIFF scattergram');
    c.onKey(new KeyboardEvent('keydown', { key: 'ArrowRight' })); f.detectChanges();
    expect(lb()?.textContent).toContain('WBC histogram');          // wraps
    c.onDown({ clientX: 300 } as PointerEvent); c.onUp({ clientX: 200, target: lb() } as unknown as PointerEvent); f.detectChanges();
    expect(c.openIndex()).toBe(1);                                   // swipe left = next
    c.onKey(new KeyboardEvent('keydown', { key: 'Escape' })); f.detectChanges();
    expect(lb()).toBeNull();
  });

  it('no native controls, no emoji', () => {
    const { el } = make();
    expect(el.querySelector('select, datalist')).toBeNull();
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(el.textContent ?? '')).toBe(false);
  });
});
