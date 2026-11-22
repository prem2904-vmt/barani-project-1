import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { NotificationBellComponent, POPOVER_ROWS } from './notification-bell.component';
import { NotificationsStore } from './notifications.store';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { Notification } from '../../models/user.model';

const NOW = Date.now();
const row = (id: string, type: string, minAgo: number, over: Partial<Notification> = {}): Notification => ({
  id, tenantId: 't', recipientId: 'u', type, title: 'Title ' + id, body: 'Body of ' + id, isRead: false,
  createdAt: new Date(NOW - minAgo * 60_000).toISOString(), referenceType: 'order_test', referenceId: 'ot-' + id, ...over,
});

function render(list: Notification[], perms = true) {
  const api = { get: vi.fn(() => of(list)), patch: vi.fn(() => of({})) };
  const critical = { acknowledgeOrderTest: vi.fn(() => of([{ id: 'e', status: 'acknowledged' }])) };
  TestBed.configureTestingModule({
    imports: [NotificationBellComponent],
    providers: [
      // "See all notifications" really navigates, so the route exists here too.
      provideRouter([{ path: 'notifications', children: [] }]),
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { hasPermission: () => perms, hasAnyPermission: () => perms } },
      { provide: CriticalResultsService, useValue: critical },
    ],
  });
  const f = TestBed.createComponent(NotificationBellComponent);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, api, critical, store: TestBed.inject(NotificationsStore) };
}
const tick = () => new Promise<void>(r => setTimeout(r, 5));
const open = async (f: ReturnType<typeof render>['f']) => {
  (f.nativeElement.querySelector('.pf-bell-btn') as HTMLButtonElement).click();
  f.detectChanges(); await tick(); f.detectChanges();
};

describe('NotificationBellComponent — redesigned popover', () => {
  afterEach(() => { TestBed.resetTestingModule(); document.body.innerHTML = ''; });

  const list = [
    row('1', 'critical_value', 5, { referenceId: 'ot-9' }),
    row('2', 'critical_value', 25, { referenceId: 'ot-9' }),     // same result, same hour → merges
    row('3', 'tat_breach', 40, { referenceType: 'order_sample' }),
    row('4', 'report_ready', 50, { referenceType: 'report' }),
    row('5', 'result_comment_added', 60),
    row('6', 'sample_rejection', 70, { referenceType: 'order_sample', isRead: true }),
    row('7', 'user_created', 80, { referenceType: undefined, referenceId: undefined }),
    row('8', 'report_ready', 90, { referenceType: 'report' }),
  ];

  it('header says "Notifications · N unread" with the badge count, and offers Mark all read', async () => {
    const { f, el } = render(list);
    await open(f);
    const head = el.querySelector('.pf-bell-header')!.textContent!.replace(/\s+/g, ' ');
    expect(head).toContain('Notifications · 7 unread');       // 8 rows, 1 read — the same count as the badge
    expect(el.querySelector('.pf-bell-badge')!.textContent!.trim()).toBe('7');
    expect(el.querySelector('.pf-mark-all')!.textContent).toContain('Mark all read');
  });

  it('shows only the latest rows, duplicates merged into one ("Alerted 2 times"), with an icon in every tile', async () => {
    const { f, el } = render(list);
    await open(f);
    const rows = el.querySelectorAll('.pf-bell-row');
    expect(rows.length).toBe(POPOVER_ROWS);
    expect(rows[0].textContent).toContain('Alerted 2 times');
    expect(el.querySelectorAll('.pf-bell-row').length).toBe(6);
    for (const tile of Array.from(el.querySelectorAll('.pf-type-icon'))) expect(tile.querySelectorAll('svg path').length, 'tile has a drawn icon').toBeGreaterThan(0);
  });

  it('wraps the body (no truncation classes) and has ONE action per row; critical gets Acknowledge', async () => {
    const { f, el } = render(list);
    await open(f);
    const first = el.querySelector('.pf-bell-row')!;
    expect(first.querySelector('.pf-bell-ack')).toBeTruthy();
    expect(first.querySelectorAll('button.pf-bell-ack, button.pf-bell-act').length).toBe(1);
    expect(el.querySelector('.truncate')).toBeNull();
    expect(getComputedStyle(first.querySelector('.pf-bell-body-text')!).textOverflow).not.toBe('ellipsis');
  });

  it('"See all notifications" is a link to /notifications inside the popover', async () => {
    const { f, el } = render(list);
    await open(f);
    const a = el.querySelector('[data-testid="bell-see-all"]') as HTMLAnchorElement;
    expect(a.textContent).toContain('See all notifications');
    expect(a.getAttribute('href')).toBe('/notifications');
    expect(el.querySelector('.pf-bell-panel')!.contains(a)).toBe(true);
    a.addEventListener('click', e => e.preventDefault());
    a.click(); f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
    await tick();                                            // let the navigation settle before the injector goes
    expect(TestBed.inject(Router).url).toBe('/notifications');
  });

  it('Esc closes the popover and focus returns to the bell button', async () => {
    const { f, el } = render(list);
    await open(f);
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges(); await tick();
    expect(f.componentInstance.open()).toBe(false);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('.pf-bell-btn'));
  });

  it('opening moves focus into the popover; Tab wraps last → first and Shift+Tab first → last (trap)', async () => {
    const { f, el } = render(list);
    await open(f);
    const panel = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel.contains(document.activeElement)).toBe(true);
    const f2 = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
    const first = f2[0], last = f2[f2.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panel.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    panel.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    // A Tab from the middle is left to the browser.
    f2[1].focus();
    const mid = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panel.dispatchEvent(mid);
    expect(mid.defaultPrevented).toBe(false);
  });

  it('is a labelled dialog and announces new arrivals politely (aria-live), not on first load', async () => {
    const { f, el, api } = render(list.slice(0, 3));
    f.detectChanges(); await tick(); f.detectChanges();
    const live = el.querySelector('[data-testid="bell-live"]') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent!.trim()).toBe('');                // the first load is not an "arrival"
    api.get.mockReturnValue(of([row('x', 'report_ready', 1, { referenceType: 'report' }), ...list.slice(0, 3)]));
    window.dispatchEvent(new CustomEvent('pf-notification-received'));
    f.detectChanges(); TestBed.tick(); f.detectChanges(); await tick(); f.detectChanges();
    expect(live.textContent!.trim()).toBe('1 new notification');
    await open(f);
    expect(el.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Notifications');
  });

  it('the live-update path still works: pf-notification-received refetches; pf-open-bell opens the popover', async () => {
    const { f, api } = render(list.slice(0, 2));
    const calls = api.get.mock.calls.length;
    window.dispatchEvent(new CustomEvent('pf-notification-received'));
    expect(api.get.mock.calls.length).toBe(calls + 1);
    window.dispatchEvent(new CustomEvent('pf-open-bell'));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
  });

  it('a click outside closes it without stealing focus back', async () => {
    const { f } = render(list);
    await open(f);
    document.body.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('clicking the Acknowledge on a merged row acknowledges that result and reads BOTH alerts', async () => {
    const { f, el, api, critical } = render(list);
    await open(f);
    (el.querySelector('.pf-bell-ack') as HTMLButtonElement).click();
    f.detectChanges();
    expect(critical.acknowledgeOrderTest).toHaveBeenCalledWith('ot-9', 'bell');
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/1/read');
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/2/read');
  });
});
