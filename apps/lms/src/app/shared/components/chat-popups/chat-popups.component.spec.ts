import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ChatPopupsComponent } from './chat-popups.component';
import { ChatPopupService } from '../../../core/services/chat-popup.service';
import { ChatService } from '../../../core/services/chat.service';
import { ChatWindowsService } from '../../../core/services/chat-windows.service';
import { ThemeService } from '../../../core/services/theme.service';

describe('ChatPopupsComponent', () => {
  function setup(newDesign = true) {
    const chat = { loadThread: vi.fn(async () => undefined), openConversation: vi.fn(async () => undefined) };
    const windows = { isPhone: signal(false), open: signal<string[]>([]), openWindow: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ChatPopupsComponent],
      providers: [
        provideRouter([]),
        { provide: ChatService, useValue: chat },
        { provide: ChatWindowsService, useValue: windows },
        { provide: ThemeService, useValue: { isNewDesign: () => newDesign } },
      ],
    });
    const svc = TestBed.inject(ChatPopupService);
    const fixture = TestBed.createComponent(ChatPopupsComponent);
    fixture.detectChanges();
    return { fixture, svc, chat, windows, el: fixture.nativeElement as HTMLElement };
  }
  const push = (svc: ChatPopupService, id = 'c1', mid = 'm1', preview = 'Sample 26117 is haemolysed') =>
    svc.push({ conversationId: id, messageId: mid, senderId: 'u', senderName: 'Priya Sharma',
      groupName: null, preview, sentAt: '2026-09-27T10:00:00Z' });

  afterEach(() => TestBed.inject(ChatPopupService).clear());

  it('renders nothing until a message arrives', () => {
    const t = setup();
    expect(t.el.querySelector('[data-testid="chat-popup"]')).toBeNull();
  });

  it('shows initials, sender, one-line preview and time; SVG icons only', () => {
    const t = setup();
    push(t.svc);
    t.fixture.detectChanges();
    const card = t.el.querySelector('[data-testid="chat-popup"]')!;
    expect(card.querySelector('.pf-cpop__avatar')!.textContent!.trim()).toBe('PS');
    expect(card.querySelector('.pf-cpop__name')!.textContent).toContain('Priya Sharma');
    expect(card.querySelector('.pf-cpop__preview')!.textContent).toContain('haemolysed');
    expect(card.querySelector('time')).not.toBeNull();
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(card.textContent ?? '')).toBe(false);
    expect(card.querySelector('svg')).not.toBeNull();
  });

  it('collapses to "3 new messages"', () => {
    const t = setup();
    push(t.svc, 'c1', 'm1'); push(t.svc, 'c1', 'm2'); push(t.svc, 'c1', 'm3');
    t.fixture.detectChanges();
    expect(t.el.querySelectorAll('[data-testid="chat-popup"]').length).toBe(1);
    expect(t.el.querySelector('[data-testid="chat-popup-count"]')!.textContent).toContain('3 new messages');
  });

  it('click opens the conversation as a docked window (web, new design) and dismisses', () => {
    const t = setup();
    push(t.svc);
    t.fixture.detectChanges();
    (t.el.querySelector('.pf-cpop__main') as HTMLButtonElement).click();
    expect(t.windows.openWindow).toHaveBeenCalledWith('c1');
    expect(t.chat.loadThread).toHaveBeenCalledWith('c1');
    expect(t.svc.popups()).toEqual([]);
  });

  it('classic design / phones navigate to the thread page', () => {
    const t = setup(false);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    push(t.svc);
    t.fixture.detectChanges();
    (t.el.querySelector('.pf-cpop__main') as HTMLButtonElement).click();
    expect(nav).toHaveBeenCalledWith(['/messages'], { queryParams: { c: 'c1' } });
  });

  it('hover pauses auto-dismiss', () => {
    const t = setup();
    const pause = vi.spyOn(t.svc, 'pause');
    push(t.svc);
    t.fixture.detectChanges();
    t.el.querySelector('.pf-cpop')!.dispatchEvent(new Event('mouseenter'));
    expect(pause).toHaveBeenCalled();
  });

  it('respects reduced motion and uses no monospace', () => {
    const t = setup();
    const css = (ChatPopupsComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');
    expect(css).toContain('prefers-reduced-motion');
    expect(/monospace|ui-monospace|Menlo|Courier/i.test(css)).toBe(false);
    expect(t).toBeTruthy();
  });
});
