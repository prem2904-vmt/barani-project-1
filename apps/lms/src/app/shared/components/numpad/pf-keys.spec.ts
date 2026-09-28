import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PfKeysDirective } from './pf-keys.directive';
import { PfKeysPanelComponent } from './pf-keys-panel.component';
import { NumpadService, PF_KEYS_HEIGHT_VAR, PF_KEYS_OPEN_CLASS } from './numpad.service';
import { PfKeysKind, PfKeysPrefix, deptPrefixes, layoutStorageKey, numericLayoutOf, resolveLayout } from './pf-keys-layouts';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { DeviceClassService } from '../../../core/services/device-class.service';
import { KeyboardService } from '../../../core/services/keyboard.service';
import { PlatformService } from '../../../core/services/platform.service';

/**
 * PF Keys — the in-app keypad for SEARCH fields on TABLETS. The result
 * numpad's engine, generalised: tablet-only, search-only, remembered
 * layouts, the field's own Enter / arrows, the lab's own department
 * prefixes, the system-keyboard escape hatch and hardware step-aside.
 */

@Component({
  standalone: true,
  imports: [PfKeysDirective],
  template: `
    <input class="tests" type="text" [pfKeys]="kind()" [pfKeysArrows]="true" [pfKeysPrefixes]="prefixes()"
           (input)="onInput($any($event.target).value)"
           (keydown.enter)="enters = enters + 1" (keydown.arrowDown)="downs = downs + 1" (keydown.arrowUp)="ups = ups + 1" />
    <input class="patient" type="text" pfKeys="patient" (keydown.enter)="patientEnters = patientEnters + 1" />
    <input class="sample" type="text" pfKeys="sample" pfKeysEnter="Receive" />
    <input class="remarks" type="text" />
    <textarea class="notes"></textarea>
  `,
})
class HostComponent {
  readonly kind = signal<PfKeysKind | null>('test');
  readonly prefixes = signal<PfKeysPrefix[] | null>([{ label: 'HEM', name: 'Haematology' }, { label: 'BIO', name: 'Biochemistry' }]);
  enters = 0; downs = 0; ups = 0; patientEnters = 0;
  searches: string[] = [];
  private t?: ReturnType<typeof setTimeout>;
  /** The screens' debounced search (220ms, like pf-patient-search). */
  onInput(v: string) {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.searches.push(v), 220);
  }
}

const USER = signal<{ id: string; tenantId?: string; branchId?: string } | null>({ id: 'u-fd-1', tenantId: 'tn', branchId: 'b1' });
const DEVICE = signal<'tablet' | 'phone' | 'desktop'>('tablet');
const DEPTS = [
  { name: 'Haematology', code: 'HEM', sampleCode: 2 },
  { name: 'Clinical Pathology', code: 'clp', sampleCode: 1 },
  { name: 'Biochemistry', code: 'BIO' },
  { name: 'Old dept', code: 'OLD', isActive: false },
  { name: 'Dup', code: 'HEM' },
  { name: 'Blank', code: '  ' },
];
const apiGet = vi.fn((_: string) => of(DEPTS));

// In-memory Storage (the runner has no real localStorage).
const mem = new Map<string, string>();
const store = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
};

async function setup(device: 'tablet' | 'phone' | 'desktop' = 'tablet') {
  DEVICE.set(device);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user: USER } },
      { provide: DeviceClassService, useValue: { deviceClass: DEVICE, isTouch: () => DEVICE() !== 'desktop' } },
      { provide: ApiService, useValue: { get: apiGet } },
      { provide: PlatformService, useValue: { isCapacitor: () => false, isNative: () => false } },
    ],
  });
  const svc = TestBed.inject(NumpadService);
  svc.touch.set(true);
  svc.ensurePanel(PfKeysPanelComponent);
  const f = TestBed.createComponent(HostComponent);
  f.detectChanges();
  const appRef = TestBed.inject(ApplicationRef);
  const root = f.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLInputElement>(s: string) => root.querySelector(s) as T;
  const tick = () => { f.detectChanges(); appRef.tick(); };
  const pad = () => document.body.querySelector('.pf-k') as HTMLElement | null;
  const key = (k: string) => pad()!.querySelector(`[data-key="${k}"]`) as HTMLButtonElement;
  const tapField = (el: HTMLElement) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    el.focus();
    tick();
  };
  const press = (...keys: string[]) => { for (const k of keys) { key(k).click(); tick(); } };
  return { f, svc, q, tick, pad, key, tapField, press, host: f.componentInstance };
}

beforeEach(() => {
  mem.clear();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
  USER.set({ id: 'u-fd-1', tenantId: 'tn', branchId: 'b1' });
  apiGet.mockClear();
});
afterEach(() => {
  document.body.querySelectorAll('pf-keys-panel').forEach(n => n.remove());
  document.documentElement.classList.remove(PF_KEYS_OPEN_CLASS);
  document.documentElement.style.removeProperty(PF_KEYS_HEIGHT_VAR);
});

describe('PF Keys layouts (pure)', () => {
  it('defaults: tests → QWERTY, patient → number pad, sample → code pad', () => {
    expect(resolveLayout('test', null)).toBe('qwerty');
    expect(resolveLayout('patient', null)).toBe('number');
    expect(resolveLayout('sample', null)).toBe('code');
  });
  it('a remembered layout wins, but only one the kind allows', () => {
    expect(resolveLayout('test', 'code')).toBe('code');
    expect(resolveLayout('patient', 'qwerty')).toBe('qwerty');
    expect(resolveLayout('patient', 'code')).toBe('number');    // not a patient layout
    expect(resolveLayout('test', 'garbage')).toBe('qwerty');
    expect(resolveLayout('sample', null, 'qwerty')).toBe('qwerty'); // field default
  });
  it('123 leads to the kind\'s numeric pad', () => {
    expect(numericLayoutOf('test')).toBe('code');
    expect(numericLayoutOf('sample')).toBe('code');
    expect(numericLayoutOf('patient')).toBe('number');
  });
  it('remembered per user per field kind', () => {
    expect(layoutStorageKey('u1', 'test')).not.toBe(layoutStorageKey('u1', 'patient'));
    expect(layoutStorageKey('u1', 'test')).not.toBe(layoutStorageKey('u2', 'test'));
  });
  it('department prefixes come from the LAB\'s departments: unique, active, A→Z', () => {
    const p = deptPrefixes(DEPTS, 'test');
    expect(p.map(x => x.label)).toEqual(['BIO', 'CLP', 'HEM']);
    expect(p.find(x => x.label === 'HEM')!.insert).toBe('HEM');
    expect(deptPrefixes([], 'test')).toEqual([]);
  });
  it('sample lookups type the short barcode prefix DD+YY where the department has one', () => {
    const p = deptPrefixes(DEPTS, 'sample', 2026);
    expect(p.find(x => x.label === 'HEM')).toMatchObject({ insert: '0226', hint: '02·26' });
    expect(p.find(x => x.label === 'CLP')!.insert).toBe('0126');
    expect(p.find(x => x.label === 'BIO')!.insert).toBe('BIO');   // no sample code → letter code
  });
});

describe('PF Keys — tablet only', () => {
  it('tablet: the search field gets inputmode=none, no autocorrect / suggestions', async () => {
    const { q } = await setup('tablet');
    const t = q('.tests');
    expect(t.getAttribute('inputmode')).toBe('none');
    expect(t.getAttribute('autocomplete')).toBe('off');
    expect(t.getAttribute('autocorrect')).toBe('off');
    expect(t.getAttribute('spellcheck')).toBe('false');
    expect(t.readOnly).toBe(false);
  });

  for (const dev of ['phone', 'desktop'] as const) {
    it(`${dev}: nothing is touched — system / physical keyboard, no keypad`, async () => {
      const { q, pad, tapField } = await setup(dev);
      const t = q('.tests');
      expect(t.hasAttribute('inputmode')).toBe(false);
      expect(t.hasAttribute('autocorrect')).toBe(false);
      tapField(t);
      expect(t.hasAttribute('inputmode')).toBe(false);
      expect(pad()).toBeNull();
    });
  }

  it('search fields only: remarks inputs and textareas never get it', async () => {
    const { q, tapField, pad } = await setup('tablet');
    tapField(q('.remarks'));
    expect(q('.remarks').hasAttribute('inputmode')).toBe(false);
    expect(q<HTMLTextAreaElement>('.notes').hasAttribute('inputmode')).toBe(false);
    expect(pad()).toBeNull();
  });

  it('pfKeys off (null kind, e.g. the order pill on Doctor) restores the field', async () => {
    const { q, host, tick } = await setup('tablet');
    host.kind.set(null);
    tick();
    const t = q('.tests');
    expect(t.hasAttribute('inputmode')).toBe(false);
    expect(t.hasAttribute('autocorrect')).toBe(false);
  });
});

describe('PF Keys — typing into the search', () => {
  it('opens on a finger tap: a labelled group, every key a labelled button, focus stays', async () => {
    const { q, pad, tapField } = await setup();
    const t = q('.tests');
    tapField(t);
    const p = pad()!;
    expect(p).not.toBeNull();
    expect(p.getAttribute('role')).toBe('group');
    expect(p.getAttribute('aria-label')).toContain('Search keypad');
    expect(p.getAttribute('data-layout')).toBe('qwerty');
    const keys = Array.from(p.querySelectorAll('button'));
    expect(keys.every(b => !!b.getAttribute('aria-label'))).toBe(true);
    expect(p.querySelector('[data-key="q"]')!.getAttribute('aria-label')).toBe('Letter Q');
    expect(p.querySelector('[data-key="enter"]')!.getAttribute('aria-label')).toBe('Add selected test');
    expect(p.querySelector('[data-key="enter"]')!.textContent).toContain('Add');
    expect(document.activeElement).toBe(t);
    // No mic key (voice isn't wanted).
    expect(p.querySelector('[data-key="mic"]')).toBeNull();
    // A pointerdown on the keys never steals focus nor reaches the page.
    const outside = vi.fn();
    document.addEventListener('pointerdown', outside);
    const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' });
    p.querySelector('[data-key="h"]')!.dispatchEvent(ev);
    document.removeEventListener('pointerdown', outside);
    expect(ev.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
  });

  it('real input events reach the search — the debounced search still fires', async () => {
    vi.useFakeTimers();
    try {
      const { q, host, tapField, press } = await setup();
      tapField(q('.tests'));
      press('h', 'b', ' ', 'a');
      expect(q('.tests').value).toBe('hb a');
      expect(host.searches).toEqual([]);
      vi.advanceTimersByTime(250);
      expect(host.searches).toEqual(['hb a']);
      press('backspace');
      vi.advanceTimersByTime(250);
      expect(host.searches.at(-1)).toBe('hb ');
    } finally { vi.useRealTimers(); }
  });

  it('Add ↵ is the field\'s own Enter (adds the highlighted result); ↑/↓ move its highlight', async () => {
    const { q, host, tapField, press } = await setup();
    tapField(q('.tests'));
    press('down', 'down', 'up');
    expect(host.downs).toBe(2);
    expect(host.ups).toBe(1);
    press('enter');
    expect(host.enters).toBe(1);
  });

  it('no arrow keys where the screen has no highlight model', async () => {
    const { q, pad, tapField } = await setup();
    tapField(q('.sample'));
    expect(pad()!.querySelector('[data-key="down"]')).toBeNull();
    expect(pad()!.querySelector('[data-key="enter"]')!.textContent).toContain('Receive');
  });

  it('patient search: number pad; Search ↵ runs the field\'s Enter', async () => {
    const { q, host, pad, tapField, press } = await setup();
    tapField(q('.patient'));
    expect(pad()!.getAttribute('data-layout')).toBe('number');
    press('9', '8', '4', '0');
    expect(q('.patient').value).toBe('9840');
    press('enter');
    expect(host.patientEnters).toBe(1);
  });
});

describe('PF Keys — layouts: switching and remembered defaults', () => {
  it('123 → code pad (department prefix + digits); ABC → back; remembered per user per kind', async () => {
    const { q, pad, tapField, press, svc } = await setup();
    const t = q('.tests');
    tapField(t);
    press('layout-code');
    expect(pad()!.getAttribute('data-layout')).toBe('code');
    expect(store.getItem('pf-keys-layout:u-fd-1:test')).toBe('code');
    press('prefix-HEM', '0', '0', '1');
    expect(t.value).toBe('HEM001');
    press('-', '.');
    expect(t.value).toBe('HEM001-.');
    // Re-opening the same kind comes back on the code pad.
    svc.dismiss();
    tapField(t);
    expect(pad()!.getAttribute('data-layout')).toBe('code');
    // Another kind keeps its own default.
    tapField(q('.patient'));
    expect(pad()!.getAttribute('data-layout')).toBe('number');
    press('layout-qwerty');
    expect(pad()!.getAttribute('data-layout')).toBe('qwerty');
    expect(store.getItem('pf-keys-layout:u-fd-1:patient')).toBe('qwerty');
    // QWERTY's 123 on a patient field goes to the NUMBER pad.
    press('layout-number');
    expect(pad()!.getAttribute('data-layout')).toBe('number');
  });

  it('another user on the same tablet keeps their own layout', async () => {
    store.setItem('pf-keys-layout:u-fd-1:test', 'code');
    USER.set({ id: 'u-fd-2' });
    const { q, pad, tapField } = await setup();
    tapField(q('.tests'));
    expect(pad()!.getAttribute('data-layout')).toBe('qwerty');
  });

  it('storage failures never break it (falls back to the default)', async () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('denied'); } });
    try {
      const { q, pad, tapField, press } = await setup();
      tapField(q('.tests'));
      expect(pad()!.getAttribute('data-layout')).toBe('qwerty');
      press('layout-code');
      expect(pad()!.getAttribute('data-layout')).toBe('code');
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
    }
  });

  it('the kind changing under a focused field (order pill: Tests → Patient) re-picks the layout', async () => {
    const { q, host, pad, tapField, tick } = await setup();
    host.prefixes.set(null);
    tapField(q('.tests'));
    expect(pad()!.getAttribute('data-layout')).toBe('qwerty');
    host.kind.set('patient');
    tick();
    expect(pad()!.getAttribute('data-layout')).toBe('number');
  });
});

describe('PF Keys — department prefixes are the lab\'s own', () => {
  it('with no explicit prefixes, the code pad loads the lab\'s departments (once)', async () => {
    const { q, pad, tapField, press, tick } = await setup();
    tapField(q('.sample'));
    tick();
    expect(apiGet).toHaveBeenCalledWith('/api/tenants/departments');
    const labels = Array.from(pad()!.querySelectorAll('[data-key^="prefix-"]')).map(b => b.getAttribute('data-key'));
    expect(labels).toEqual(['prefix-BIO', 'prefix-CLP', 'prefix-HEM']);
    const yy = String(new Date().getFullYear() % 100).padStart(2, '0');
    press('prefix-HEM');
    expect(q('.sample').value).toBe('02' + yy);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});

describe('PF Keys — escape hatch, hardware keyboard, hide', () => {
  it('the keyboard key hands THIS field to the system keyboard until blur', async () => {
    const { q, pad, tapField, press, tick } = await setup();
    const t = q('.tests');
    tapField(t);
    press('system');
    expect(pad()).toBeNull();
    expect(t.hasAttribute('inputmode')).toBe(false);
    expect(document.activeElement).toBe(t);
    // Still no autocorrect / suggestions on the system keyboard.
    expect(t.getAttribute('autocorrect')).toBe('off');
    // A tap while on the system keyboard does not bring the keys back.
    tapField(t);
    expect(pad()).toBeNull();
    expect(t.hasAttribute('inputmode')).toBe(false);
    // Blur ends it: PF Keys is back next time.
    t.blur();
    tick();
    expect(t.getAttribute('inputmode')).toBe('none');
    tapField(t);
    expect(pad()).not.toBeNull();
  });

  it('a real hardware key steps PF Keys aside; typing works as always', async () => {
    const { q, pad, tapField, tick } = await setup();
    const t = q('.tests');
    tapField(t);
    expect(pad()).not.toBeNull();
    // A lone modifier does nothing.
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    tick();
    expect(pad()).not.toBeNull();
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    tick();
    expect(pad()).toBeNull();
    expect(document.activeElement).toBe(t);
    // Tapping the field brings it back.
    tapField(t);
    expect(pad()).not.toBeNull();
  });

  it('the hide chevron hides the keys and keeps focus; a tap brings them back', async () => {
    const { q, pad, tapField, press } = await setup();
    const t = q('.tests');
    tapField(t);
    press('hide');
    expect(pad()).toBeNull();
    expect(document.activeElement).toBe(t);
    tapField(t);
    expect(pad()).not.toBeNull();
  });

  it('programmatic / Tab focus does not pop it up', async () => {
    const { q, pad, tick } = await setup();
    q('.tests').focus();
    tick();
    expect(pad()).toBeNull();
  });
});

describe('PF Keys — docking: the page resizes above it', () => {
  it('publishes --pf-keys-h on <html>, hides the navbar like a keyboard, pads the page host', async () => {
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240);
    try {
      TestBed.resetTestingModule();
      const host = document.createElement('main');
      host.setAttribute('data-pf-keys-host', '');
      host.style.paddingBottom = '12px';
      document.body.appendChild(host);
      const { f, q, svc, tapField, tick } = await setup();
      host.appendChild(f.nativeElement);
      const kbd = TestBed.inject(KeyboardService);
      tapField(q('.tests'));
      svc.layoutNow();
      expect(svc.mode()).toBe('dock');
      expect(document.documentElement.style.getPropertyValue(PF_KEYS_HEIGHT_VAR)).toBe('240px');
      expect(document.documentElement.classList).toContain(PF_KEYS_OPEN_CLASS);
      expect(kbd.visible()).toBe(true);
      expect(host.style.getPropertyValue('padding-bottom')).toBe('240px');
      expect(host.style.getPropertyPriority('padding-bottom')).toBe('important');
      // Gone: everything is handed back.
      vi.useFakeTimers();
      try {
        svc.dismiss();
        tick();
        vi.advanceTimersByTime(1000);
      } finally { vi.useRealTimers(); }
      expect(document.documentElement.classList).not.toContain(PF_KEYS_OPEN_CLASS);
      expect(document.documentElement.style.getPropertyValue(PF_KEYS_HEIGHT_VAR)).toBe('');
      expect(kbd.visible()).toBe(false);
      expect(host.style.paddingBottom).toBe('12px');
      expect(host.style.getPropertyPriority('padding-bottom')).toBe('');
      host.remove();
    } finally { heightSpy.mockRestore(); }
  });

  it('the panel CSS docks full width at the bottom with the safe area, keys ≥ 44px, reduced motion respected', () => {
    const css = ((PfKeysPanelComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles || []).join('\n');
    expect(css).toMatch(/env\(safe-area-inset-bottom/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});

describe('PF Keys — wired on search fields only (source)', () => {
  const appRoot = path.resolve(__dirname, '../../..');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|ts)$/.test(e.name) && !/\.spec\.ts$/.test(e.name) && !p.includes(`${path.sep}numpad${path.sep}`)) files.push(p);
    }
  };
  walk(appRoot);
  const uses = files.flatMap(f => {
    const src = fs.readFileSync(f, 'utf8');
    const out: { file: string; tag: string }[] = [];
    const re = /<(input|textarea|pf-hero-band)\b[^>]*?(?:\bpfKeys\b|\[pfKeys\]|\bkeys=|\[keys\])[^>]*>/gs;
    for (const m of src.matchAll(re)) out.push({ file: path.relative(appRoot, f), tag: m[0] });
    return out;
  });

  it('is wired on the approved search fields', () => {
    const where = new Set(uses.map(u => u.file));
    for (const f of [
      'features/frontdesk/order-create/order-create.component.html',
      'shared/components/patient-search/patient-search.component.ts',
      'shared/components/hero-band/hero-band.component.ts',
      'features/lab/my-work/my-work.component.ts',
      'features/lab/receive-samples/receive-samples.component.ts',
      'features/lab/sample-collection/sample-collection.component.html',
    ]) expect(where.has(f)).toBe(true);
  });

  it('never on a textarea, and every use is a search / lookup field', () => {
    expect(uses.some(u => u.tag.startsWith('<textarea'))).toBe(false);
    for (const u of uses) {
      expect(u.tag).toMatch(/pfKeys="(test|patient|sample)"|\[pfKeys\]="(pfKeysKind|keys)\(\)"|keys="sample"|\[keys\]/);
    }
  });
});
