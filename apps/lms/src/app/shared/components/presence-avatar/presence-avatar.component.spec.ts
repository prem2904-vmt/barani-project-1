import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PresenceAvatarComponent, PresenceDotComponent } from './presence-avatar.component';
import { PresenceService } from '../../../core/services/presence.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { SessionScopeService } from '../../../core/auth/session-scope.service';
import { Subject } from 'rxjs';

/**
 * One shared avatar-with-presence (owner 2026-09-27: "the available statuses
 * are not shown" in the navbar Messages popover). The dot reads the live hub
 * maps through PresenceService.displayStatus — it updates while on screen,
 * shows away/offline neutrally, is labelled for screen readers, and has no
 * dot for groups.
 */
@Component({
  standalone: true,
  imports: [PresenceAvatarComponent],
  template: `
    <pf-presence-avatar id="a" name="Priya Sharma" [userId]="uid()" />
    <pf-presence-avatar id="g" name="Bench" [group]="true" userId="x" />
  `,
})
class Host { uid = signal<string | null>('u-priya'); }

function setup() {
  const userPresences = signal(new Map<string, string>([['u-priya', 'active']]));
  const presenceChanged = new Subject<{ userId: string; status: string; custom?: boolean }>();
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      { provide: SignalingService, useValue: { userPresences, userPresenceChanged: presenceChanged } },
      { provide: AuthService, useValue: { user: signal({ id: 'app-me', authId: 'u-me' }) } },
      { provide: ApiService, useValue: { patch: () => of({}) } },
    ],
  });
  TestBed.inject(SessionScopeService).changed({ userId: 'app-me', tenantId: 't', authId: 'u-me' });
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const dot = () => el.querySelector('#a pf-presence-dot') as HTMLElement;
  return { f, el, dot, userPresences, presenceChanged };
}

describe('pf-presence-avatar / pf-presence-dot', () => {
  it('online: violet tone + "Online" label; initials from the name', () => {
    const t = setup();
    expect(t.el.querySelector('#a .pf-pav__face')!.textContent!.trim()).toBe('PS');
    expect(t.dot().getAttribute('data-tone')).toBe('on');
    expect(t.dot().getAttribute('aria-label')).toBe('Online');
    expect(t.dot().getAttribute('role')).toBe('img');
  });

  it('updates live from the hub deltas (away → offline) while on screen', () => {
    const t = setup();
    t.userPresences.set(new Map([['u-priya', 'away']]));
    t.f.detectChanges();
    expect(t.dot().getAttribute('data-tone')).toBe('away');
    expect(t.dot().getAttribute('aria-label')).toBe('Away');
    t.userPresences.set(new Map());
    t.f.detectChanges();
    expect(t.dot().getAttribute('data-tone')).toBe('off');
    expect(t.dot().getAttribute('aria-label')).toBe('Offline');
  });

  it('a custom status shows while connected; DND-grade is the muted-red tone', () => {
    const t = setup();
    t.presenceChanged.next({ userId: 'u-priya', status: 'surgery', custom: true });
    t.f.detectChanges();
    expect(t.dot().getAttribute('data-tone')).toBe('dnd');
    expect(t.dot().getAttribute('aria-label')).toBe('In surgery');
  });

  it('groups get no dot', () => {
    const t = setup();
    expect(t.el.querySelector('#g pf-presence-dot')).toBeNull();
  });

  it('no user id → no dot', () => {
    const t = setup();
    t.f.componentInstance.uid.set(null);
    t.f.detectChanges();
    expect(t.el.querySelector('#a pf-presence-dot')).toBeNull();
  });

  it('dot styles: ring in the surface colour, neutral away/offline', () => {
    const css = (PresenceDotComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');
    expect(css).toContain('--pf-pdot-ring');
    expect(/#(22c55e|16a34a|10b981|34d399)/i.test(css)).toBe(false);
  });
});
