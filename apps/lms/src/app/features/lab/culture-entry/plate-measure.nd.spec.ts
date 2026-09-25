import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { PlateMeasureComponent } from './plate-measure.component';
import { PlatformService } from '../../../core/services/platform.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { ToastService } from '../../../core/services/toast.service';
import { of, throwError, Subject } from 'rxjs';
import { DiskReadApi } from './disk-read';

/** Measure-zones modal on the kit (owner): nd-card / phone sheet, BILLING
 *  header, neutral stepper, solid-circle reticle, ONE primary per step. */

const css = () => ((PlateMeasureComponent as any).ɵcmp.styles as string[]).join('\n');

function render(withCam = false, api: Partial<Record<keyof DiskReadApi, unknown>> = {}) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, value: { getUserMedia: () => new Promise(() => { /* pending */ }) },
  });
  (HTMLMediaElement.prototype as any).play = () => Promise.resolve();
  TestBed.configureTestingModule({
    imports: [PlateMeasureComponent],
    providers: [
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { isCapacitor: () => false } },
      { provide: CapacitorService, useValue: {} },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {} } },
      { provide: DiskReadApi, useValue: { usage: () => throwError(() => ({ status: 404 })), read: () => new Subject(), confirm: () => of({}), ...api } },
    ],
  });
  const f = TestBed.createComponent(PlateMeasureComponent);
  f.componentInstance.antibiotics = ['Penicillin'];
  f.detectChanges();
  if (withCam) { (f.componentInstance as any)._camStream.set({ getTracks: () => [] }); f.detectChanges(); }
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any };
}

afterEach(() => { document.querySelectorAll('pf-plate-measure').forEach(n => n.remove()); });

describe('Measure zones modal — kit shell', () => {
  it('header: violet icon chip, MEASURE ZONES label, neutral expand + close; calm title', () => {
    const { el } = render();
    expect(el.querySelector('.pm-head .nd-card__icon svg')).toBeTruthy();
    expect(el.querySelector('.pm-head__label')?.textContent?.trim()).toBe('Measure zones');
    expect(el.querySelector('.pm-head__label')?.classList.contains('nd-card__label')).toBe(true);
    expect(el.querySelectorAll('.pm-head .pm-icon').length).toBe(2);
    expect(el.querySelector('.pm-x')?.getAttribute('aria-label')).toBe('Close');
    expect(el.querySelector('.pm-title')?.textContent?.trim()).toBe('Measure zones from plate');
    expect(css()).toMatch(/\.pm-title[^{]*\{[^}]*font-weight:\s*600/);
  });

  it('neutral stepper over the real steps: Capture → Calibrate → Measure & read → Review', () => {
    const { f, el, c } = render();
    const steps = el.querySelectorAll('.pm-step');
    expect([...steps].map(s => s.querySelector('.pm-step__lbl')?.textContent?.trim())).toEqual(['Capture', 'Calibrate', 'Measure & read', 'Review']);
    expect(steps[0].getAttribute('data-state')).toBe('active');
    expect(el.querySelector('.pm-sub')?.textContent).toContain('Step 1 of 4');
    c.mode.set('measure');
    f.detectChanges();
    const s2 = el.querySelectorAll('.pm-step');
    expect(s2[0].getAttribute('data-state')).toBe('done');
    expect(s2[2].getAttribute('data-state')).toBe('active');
  });

  it('capture: the camera reticle is a thin SOLID circle with a crosshair (no dashes)', () => {
    const { el } = render(true);
    const ret = el.querySelector('circle.pm-reticle')!;
    expect(ret).toBeTruthy();
    expect(ret.getAttribute('stroke-dasharray')).toBeNull();
    expect(el.querySelector('.pm-cross')).toBeTruthy();
  });

  it('capture: Capture is the ONE primary; Upload is secondary', () => {
    const { el } = render(true);
    const prim = el.querySelectorAll('.pm-capture .nd-btn--primary');
    expect(prim.length).toBe(1);
    expect(prim[0].textContent).toContain('Capture');
    expect(el.querySelector('.pm-capture label.nd-btn--secondary')?.textContent).toContain('Upload a photo instead');
  });

  it('primaries are the kit gradient: no component rule paints a solid violet button', () => {
    const rules = css().split('}').filter(r => /\.pm-btn/.test(r));
    for (const r of rules) expect(r).not.toMatch(/background:\s*#7c3aed/i);
  });

  it('calibrate: Measure is the one primary (auto-detect is secondary)', () => {
    const { f, el, c } = render();
    c.imageSrc.set('data:image/png;base64,x');
    c.mode.set('calibrate');
    f.detectChanges();
    const prim = el.querySelectorAll('.pm-controls .nd-btn--primary');
    expect(prim.length).toBe(1);
    expect(prim[0].textContent?.trim()).toBe('Measure');
  });

  it('phones: a tall sheet above the navbar (kit nd-sheet + handle)', () => {
    const { el } = render();
    const panel = el.querySelector('.pm-panel')!;
    expect(panel.classList.contains('nd-sheet')).toBe(true);
    expect(panel.querySelector('.nd-sheet__handle')).toBeTruthy();
    const phone = css().slice(css().lastIndexOf('max-width: 640px'));
    expect(phone).toMatch(/\.pm-backdrop[^{]*\{[^}]*bottom:\s*var\(--nd-nav-h/);
  });

  it('light mode: coded rings are neutral white; unassigned = violet accent', () => {
    const { c } = render();
    const light = vi.spyOn(c, 'isLight').mockReturnValue(true);
    c.srI = () => 'R';
    const row = (code: string | null) => ({ id: 9, n: 1, cx: 0, cy: 0, own: { rx: 5, ry: 5, angle: 0 }, ruler: { rx: 5, ry: 5, angle: 0 }, k: 2, zoneFound: true, code, codeSrc: null, aiConf: null, notDisk: false });
    expect(c.ringStroke(row('CTR 30'))).toBe('#ffffff');
    expect(c.ringStroke(row(null))).toBe('#a78bfa');
    light.mockReturnValue(false);
  });
});
