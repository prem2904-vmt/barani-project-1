import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ChatWindowsComponent } from './chat-windows.component';
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

describe('ChatWindowsComponent — fixed chat rail', () => {
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

  it('keeps the minimized rail fixed above the navbar regardless of page controls', () => {
    const { el } = render();
    const rail = el.querySelector('.pf-cw__rail') as HTMLElement;
    expect(rail.style.bottom).toBe('');
    const css = readFileSync('apps/lms/src/app/shared/components/chat-windows/chat-windows.component.ts', 'utf8');
    expect(css).toMatch(/\.pf-cw__rail\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*calc\(var\(--pf-botbar-h, 0px\) \+ 12px\)/);
    expect(css).not.toContain('--pf-cw-lift');
    expect(css).not.toContain('railAvoid');
  });

  it('opens a minimized conversation when its head is clicked', () => {
    const { el, windowsSvc } = render();
    (el.querySelector('.pf-cw__head') as HTMLElement).click();
    expect(windowsSvc.openWindow).toHaveBeenCalledWith('c1');
  });
});
