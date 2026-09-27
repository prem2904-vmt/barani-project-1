import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ChatWindowsComponent } from './chat-windows.component';
import { Box, Hit, clampLift, parseRailPosition, planRailLift, samplePoints } from './chat-rail-placement';
import { ThemeService } from '../../../core/services/theme.service';
import { ChatService } from '../../../core/services/chat.service';
import { ChatWindowsService } from '../../../core/services/chat-windows.service';
import { AuthService } from '../../../core/auth/auth.service';
import { SessionScopeService } from '../../../core/auth/session-scope.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiService } from '../../../core/services/api.service';
import { PresenceService } from '../../../core/services/presence.service';

/**
 * The floating chat rail ("SA" heads) must never sit on the page's primary
 * action — owner's iPad: it covered "Continue to payment" on Order &
 * Payments. It lifts itself clear of what's underneath (primaries always,
 * any control when there is room), and can be dragged — remembered per user.
 */

// A 44px head docked at the bottom-right of a 1024×768 iPad.
const HEAD: Box = { left: 966, right: 1010, top: 700, bottom: 744 };

/** A page with a primary CTA occupying [top, bottom] across the right side. */
const pageWith = (bands: Array<{ top: number; bottom: number; kind: Exclude<Hit, null> }>) =>
  (x: number, y: number): Hit => {
    for (const b of bands) if (y >= b.top && y <= b.bottom && x > 800) return b.kind;
    return null;
  };

describe('planRailLift', () => {
  it('stays put when nothing is underneath', () => {
    expect(planRailLift([HEAD], () => null, 400)).toBe(0);
  });

  it('lifts just clear of a primary action under the head ("Continue to payment")', () => {
    const lift = planRailLift([HEAD], pageWith([{ top: 690, bottom: 740, kind: 'primary' }]), 400);
    expect(lift).toBeGreaterThan(0);
    const lifted = { ...HEAD, top: HEAD.top - lift, bottom: HEAD.bottom - lift };
    for (const [, y] of samplePoints(lifted)) expect(y < 690 || y > 740).toBe(true);
    expect(lift).toBeLessThanOrEqual(64);          // the smallest clear step, not a fly-away
  });

  it('prefers a spot free of ANY control, but settles for "not on a primary" when the page is dense', () => {
    // Dense page: controls everywhere above; a primary right under the head.
    const dense = pageWith([
      { top: 690, bottom: 745, kind: 'primary' },
      { top: 0, bottom: 689, kind: 'control' },
    ]);
    const lift = planRailLift([HEAD], dense, 400);
    const lifted = { ...HEAD, top: HEAD.top - lift, bottom: HEAD.bottom - lift };
    expect(samplePoints(lifted).every(([, y]) => y < 690)).toBe(true);
  });

  it('never flies past the cap (stays docked if nothing clears)', () => {
    expect(planRailLift([HEAD], () => 'primary', 200)).toBe(0);
  });

  it('a primary is avoided by its rectangle — the head may not even graze it', () => {
    // A CTA whose edge sits 3px inside the head's box: probe points miss it,
    // the rectangle check does not.
    const cta: Box = { left: 700, right: 969, top: 650, bottom: 760 };
    expect(planRailLift([HEAD], () => null, 400)).toBe(0);
    const lift = planRailLift([HEAD], () => null, 400, 8, [cta]);
    expect(HEAD.bottom - lift).toBeLessThanOrEqual(cta.top - 6);
  });

  it('checks every head of a stacked rail', () => {
    const upper: Box = { ...HEAD, top: 646, bottom: 690 };
    const lift = planRailLift([upper, HEAD], pageWith([{ top: 600, bottom: 660, kind: 'primary' }]), 400);
    expect(lift).toBeGreaterThan(0);
  });

  it('clamp + persisted-position parsing are defensive', () => {
    expect(clampLift(-20, 300)).toBe(0);
    expect(clampLift(999, 300)).toBe(300);
    expect(clampLift(Number.NaN, 300)).toBe(0);
    expect(parseRailPosition(null)).toEqual({ side: 'right', lift: 0 });
    expect(parseRailPosition('{"side":"left","lift":120.4}')).toEqual({ side: 'left', lift: 120 });
    expect(parseRailPosition('garbage')).toEqual({ side: 'right', lift: 0 });
  });
});

describe('ChatWindowsComponent — rail placement', () => {
  const CONV = {
    id: 'c1', isGroup: false, name: null, createdById: 'me', lastMessageAt: '', unreadCount: 2, lastMessage: null,
    participants: [{ userId: 'me', displayName: 'Me', email: '' }, { userId: 'sa', displayName: 'Sam Arul', email: '' }],
  };
  let store: Map<string, string>;
  const realEFP = (document as any).elementsFromPoint;

  function render(user = { userId: 'u1', tenantId: 't1' }) {
    const minimized = signal<string[]>(['c1']);
    const windowsSvc = {
      open: signal<string[]>([]), minimized, favourites: signal<string[]>([]),
      isFavourite: () => false, openWindow: vi.fn(), focus: vi.fn(), minimize: vi.fn(), close: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [ChatWindowsComponent],
      providers: [
        { provide: ThemeService, useValue: { isNewDesign: () => true } },
        { provide: ChatService, useValue: { conversations: signal([CONV]), threads: signal(new Map()), forgetThread: vi.fn() } },
        { provide: ChatWindowsService, useValue: windowsSvc },
        { provide: AuthService, useValue: { user: () => ({ id: 'me', authId: 'me' }) } },
        { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
        { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
        { provide: WebrtcService, useValue: {} },
        { provide: SignalingService, useValue: { onlineUserIds: signal(new Set()) } },
        { provide: ToastService, useValue: { info: vi.fn(), error: vi.fn() } },
        { provide: ApiService, useValue: {} },
        { provide: PresenceService, useValue: { displayStatus: () => null } },
      ],
    });
    const scope = TestBed.inject(SessionScopeService);
    scope.changed({ ...user });
    const f = TestBed.createComponent(ChatWindowsComponent);
    f.detectChanges();
    TestBed.tick();
    const c = f.componentInstance as any;
    const el = f.nativeElement as HTMLElement;
    return { f, c, el, scope, windowsSvc };
  }

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    (document as any).elementsFromPoint = realEFP;
    TestBed.resetTestingModule();
  });

  it('the rail only takes taps on its heads (never a full-width tap-swallowing strip)', () => {
    const { el } = render();
    const rail = el.querySelector('.pf-cw__rail') as HTMLElement;
    expect(rail).toBeTruthy();
    const css = readFileSync('apps/lms/src/app/shared/components/chat-windows/chat-windows.component.ts', 'utf8');
    expect(css).toMatch(/\.pf-cw__rail\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.pf-cw__rail\s*>\s*\*\s*\{\s*pointer-events:\s*auto/);
    expect(css).not.toMatch(/\.pf-cw__rail\s*\{\s*left:\s*8px;\s*right:\s*8px/);
  });

  it('auto-lifts off a primary button under the head, and docks back when it is gone', () => {
    const { f, c, el } = render();
    const cta = document.createElement('button');
    cta.className = 'pf-oc-btn pf-oc-btn--primary';
    document.body.appendChild(cta);
    const head = el.querySelector('.pf-cw__head') as HTMLElement;
    // Head at y 700–744 (lift 0); the CTA covers y 690–745 on the right.
    head.getBoundingClientRect = () => {
      const lift = c.railAvoid() + c.railLift();
      return { left: 966, right: 1010, top: 700 - lift, bottom: 744 - lift, width: 44, height: 44, x: 966, y: 700 - lift, toJSON: () => ({}) } as DOMRect;
    };
    let ctaOn = true;
    (document as any).elementsFromPoint = (x: number, y: number) =>
      ctaOn && x > 900 && y >= 690 && y <= 745 ? [head, cta, document.body] : [head, document.body];

    c.measure();
    f.detectChanges();
    expect(c.railAvoid()).toBeGreaterThan(0);
    const rail = el.querySelector('.pf-cw__rail') as HTMLElement;
    expect(rail.style.bottom).toContain(`${c.railAvoid()}px`);

    ctaOn = false;
    c.measure();
    expect(c.railAvoid()).toBe(0);
    cta.remove();
  });

  it('drag moves the rail (and sides), the drop is not a tap, and the spot is remembered PER USER', async () => {
    const { f, c, el, windowsSvc, scope } = render({ userId: 'u1', tenantId: 't1' });
    const rail = el.querySelector('.pf-cw__rail') as HTMLElement;
    rail.getBoundingClientRect = () => ({ left: 966, right: 1010, top: 700, bottom: 744 } as DOMRect);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });

    const down = new PointerEvent('pointerdown', { clientX: 990, clientY: 720, button: 0, bubbles: true });
    rail.dispatchEvent(down);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 520 }));
    expect(c.dragging()).toBe(true);
    expect(c.railLift()).toBe(200);
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 520 }));
    f.detectChanges();
    expect(c.railSide()).toBe('left');
    expect(el.querySelector('.pf-cw__rail--left')).toBeTruthy();

    // The click that ends a drag must not open the chat…
    (el.querySelector('.pf-cw__head') as HTMLElement).click();
    expect(windowsSvc.openWindow).not.toHaveBeenCalled();
    // …a real tap afterwards does.
    (el.querySelector('.pf-cw__head') as HTMLElement).click();
    expect(windowsSvc.openWindow).toHaveBeenCalledWith('c1');

    expect(JSON.parse(store.get('pf.chatRail:t1:u1')!)).toEqual({ side: 'left', lift: 200 });

    // Another account on this device gets its own (default) spot…
    scope.changed({ userId: 'u2', tenantId: 't1' });
    TestBed.tick();
    expect(c.railSide()).toBe('right');
    expect(c.railLift()).toBe(0);
    // …and coming back restores the first user's.
    scope.changed({ userId: 'u1', tenantId: 't1' });
    TestBed.tick();
    expect(c.railSide()).toBe('left');
    expect(c.railLift()).toBe(200);
  });

  it('a small wobble is a tap, not a drag', () => {
    const { c, el, windowsSvc } = render();
    const rail = el.querySelector('.pf-cw__rail') as HTMLElement;
    rail.dispatchEvent(new PointerEvent('pointerdown', { clientX: 990, clientY: 720, button: 0, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 992, clientY: 717 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 992, clientY: 717 }));
    expect(c.dragging()).toBe(false);
    (el.querySelector('.pf-cw__head') as HTMLElement).click();
    expect(windowsSvc.openWindow).toHaveBeenCalledWith('c1');
  });
});
