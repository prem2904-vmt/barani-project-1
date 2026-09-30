import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { NotificationBellComponent } from './notification-bell.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DesktopNotifyService } from '../../../core/services/desktop-notify.service';

/**
 * Desktop app: the bell feeds the dock / taskbar badge, and a click on a
 * native bell notification lands on the same screen a tap on the row would
 * (marking it read); with no dedicated screen the bell opens.
 */
describe('NotificationBellComponent — desktop app', () => {
  const rows = [
    { id: 'n1', type: 'report_ready', title: 'Report ready', body: 'b', isRead: false, createdAt: new Date().toISOString(), referenceId: 'r1', referenceType: 'report' },
    { id: 'n2', type: 'tat_breach', title: 'TAT', body: 'b', isRead: false, createdAt: new Date().toISOString(), referenceId: null, referenceType: null },
    { id: 'n3', type: 'tat_breach', title: 'TAT', body: 'b', isRead: true, createdAt: new Date().toISOString(), referenceId: null, referenceType: null },
  ];

  function render() {
    const desktop = { active: true, setBellUnread: vi.fn() };
    const api = { get: vi.fn(() => of(rows.map(r => ({ ...r })))), patch: vi.fn(() => of({})) };
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { hasPermission: () => false } },
        { provide: DesktopNotifyService, useValue: desktop },
      ],
    });
    const f = TestBed.createComponent(NotificationBellComponent);
    f.detectChanges();
    TestBed.tick();
    return { f, desktop, api, router: TestBed.inject(Router) };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('reports the unread count to the badge, and 0 when the bell goes away', () => {
    const { f, desktop } = render();
    expect(desktop.setBellUnread).toHaveBeenLastCalledWith(2);
    f.destroy();
    expect(desktop.setBellUnread).toHaveBeenLastCalledWith(0);
  });

  it('a native click opens the target screen and marks that row read', () => {
    const { f, api, router } = render();
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    window.dispatchEvent(new CustomEvent('pf-open-notification', {
      detail: { type: 'report_ready', referenceType: 'report', referenceId: 'r1' },
    }));
    expect(nav).toHaveBeenCalledWith(['/reports/view', 'r1'], {});
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/n1/read');
    expect(f.componentInstance.open()).toBe(false);
  });

  it('no dedicated screen → the bell opens', () => {
    const { f, router } = render();
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    window.dispatchEvent(new CustomEvent('pf-open-notification', {
      detail: { type: 'something_new', referenceType: null, referenceId: null },
    }));
    expect(nav).not.toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(true);
  });
});
