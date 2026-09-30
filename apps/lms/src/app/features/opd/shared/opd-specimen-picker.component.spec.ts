import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { OpdSpecimenPickerComponent } from './opd-specimen-picker.component';

const CHOOSE = { id: 'tKoh', name: 'KOH Mount', parameters: JSON.stringify({ specimenMode: 'choose' }) };
const FIXED = { id: 'tBc', name: 'Blood Culture', parameters: JSON.stringify({ specimenMode: 'fixed' }) };
const NONE = { id: 'tCbc', name: 'CBC', parameters: JSON.stringify({ specimenMode: 'none' }) };

@Component({
  standalone: true,
  imports: [OpdSpecimenPickerComponent],
  template: `<pf-opd-specimen-picker [test]="test()" [value]="value()" [invalid]="invalid()" (valueChange)="picked.set($event)" />`,
})
class HostComponent {
  readonly test = signal<{ id: string; name: string; parameters?: string | null }>(CHOOSE);
  readonly value = signal<string | null>(null);
  readonly invalid = signal(false);
  readonly picked = signal<string | null>(null);
}

/** Effects (the picker's own fetch-on-test-change) run asynchronously on the
 *  microtask queue — same convention as `book-visit.page.spec.ts`'s `flush`. */
const tick = () => new Promise(r => setTimeout(r, 0));

async function render(api: { get: ReturnType<typeof vi.fn> }, initial: Partial<{ test: typeof CHOOSE; value: string | null; invalid: boolean }> = {}) {
  TestBed.configureTestingModule({ imports: [HostComponent], providers: [{ provide: ApiService, useValue: api }] });
  const f = TestBed.createComponent(HostComponent);
  if (initial.test) f.componentInstance.test.set(initial.test);
  if ('value' in initial) f.componentInstance.value.set(initial.value ?? null);
  if (initial.invalid) f.componentInstance.invalid.set(true);
  f.detectChanges();
  await tick();
  f.detectChanges();
  const picker = () => f.debugElement.children[0].componentInstance as OpdSpecimenPickerComponent;
  return { f, el: f.nativeElement as HTMLElement, host: f.componentInstance, picker };
}

function apiStub(specimens: unknown[] = [], master: unknown[] = []) {
  return { get: vi.fn((url: string) => of(url.startsWith('/api/microbiology/test-specimens') ? specimens : master)) };
}

afterEach(() => TestBed.resetTestingModule());

describe('OpdSpecimenPickerComponent', () => {
  it('none mode: renders nothing and never calls the server', async () => {
    const api = apiStub();
    const { el } = await render(api, { test: NONE });
    expect(el.querySelector('pf-select')).toBeNull();
    expect(el.querySelector('.pf-opd-spec__fixed')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('fixed mode: shows the stamped specimen as text, no picker', async () => {
    const api = apiStub([{ testId: 'tBc', specimens: [{ code: 'BLD', name: 'Blood', isDefault: true }] }]);
    const { el } = await render(api, { test: FIXED });
    expect(el.querySelector('pf-select')).toBeNull();
    expect(el.textContent).toContain('Specimen · Blood');
  });

  it('choose mode: fetches the allowed list once and renders a pf-select (never a native select)', async () => {
    const api = apiStub([{ testId: 'tKoh', specimens: [{ code: 'SKN', name: 'Skin scraping', isDefault: false }] }]);
    const { el } = await render(api);
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('pf-select')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/api/microbiology/test-specimens?testIds=tKoh');
    expect(api.get).toHaveBeenCalledWith('/api/microbiology/specimens');
  });

  it('choose mode with an empty allowed list falls back to the Specimen master', async () => {
    const api = apiStub([{ testId: 'tKoh', specimens: [] }], [{ code: 'SKN', name: 'Skin scraping' }, { code: 'NAIL', name: 'Nail clipping' }]);
    const { picker } = await render(api);
    expect(picker().options().map(o => o.label)).toEqual(['Skin scraping', 'Nail clipping']);
  });

  it('shows the inline error only when invalid AND no value is chosen yet', async () => {
    const api = apiStub([{ testId: 'tKoh', specimens: [{ code: 'SKN', name: 'Skin scraping', isDefault: false }] }]);
    const { f, el, host } = await render(api, { invalid: true });
    expect(el.querySelector('.pf-opd-spec__err')!.textContent).toContain('Choose the specimen for KOH Mount.');
    host.value.set('SKN');
    f.detectChanges();
    expect(el.querySelector('.pf-opd-spec__err')).toBeNull();
  });

  it('picking an option emits valueChange with the code', async () => {
    const api = apiStub([{ testId: 'tKoh', specimens: [{ code: 'SKN', name: 'Skin scraping', isDefault: false }] }]);
    const { f, host, picker } = await render(api);
    picker().pick('SKN');
    f.detectChanges();
    expect(host.picked()).toBe('SKN');
  });

  it('re-picking the SAME test id does not refetch (loadedFor cache)', async () => {
    const api = apiStub([{ testId: 'tKoh', specimens: [{ code: 'SKN', name: 'Skin scraping', isDefault: false }] }]);
    const { f, host } = await render(api);
    const calls = api.get.mock.calls.length;
    host.test.set({ ...CHOOSE }); // same id, new object reference
    f.detectChanges();
    await tick();
    f.detectChanges();
    expect(api.get.mock.calls.length).toBe(calls);
  });
});
