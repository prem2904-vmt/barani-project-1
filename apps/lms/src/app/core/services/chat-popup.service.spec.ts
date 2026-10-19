import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ChatPopupInput, ChatPopupService } from './chat-popup.service';

const input = (conversationId: string, messageId: string, extra: Partial<ChatPopupInput> = {}): ChatPopupInput => ({
  conversationId, messageId, senderId: 'u-' + conversationId, senderName: 'Priya Sharma',
  groupName: null, preview: 'hello', sentAt: '2026-09-27T10:00:00Z', ...extra,
});

describe('ChatPopupService', () => {
  let svc: ChatPopupService;
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(ChatPopupService);
  });
  afterEach(() => { svc.clear(); vi.useRealTimers(); });

  it('auto-dismisses after ~5s', () => {
    svc.push(input('c1', 'm1'));
    expect(svc.popups().length).toBe(1);
    vi.advanceTimersByTime(ChatPopupService.DISMISS_MS - 1);
    expect(svc.popups().length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(svc.popups()).toEqual([]);
  });

  it('hover pauses every card and resumes the remaining time', () => {
    svc.push(input('c1', 'm1'));
    vi.advanceTimersByTime(3000);
    svc.pause();
    vi.advanceTimersByTime(60_000);
    expect(svc.popups().length).toBe(1);
    svc.resume();
    vi.advanceTimersByTime(1500);
    expect(svc.popups().length).toBe(1);
    vi.advanceTimersByTime(600);
    expect(svc.popups()).toEqual([]);
  });

  it('collapses one thread into one card and restarts its timer', () => {
    svc.push(input('c1', 'm1', { preview: 'one' }));
    vi.advanceTimersByTime(4000);
    svc.push(input('c1', 'm2', { preview: 'two' }));
    svc.push(input('c1', 'm3', { preview: 'three' }));
    expect(svc.popups()).toHaveLength(1);
    expect(svc.popups()[0]).toMatchObject({ count: 3, preview: 'three' });
    vi.advanceTimersByTime(4000);
    expect(svc.popups()).toHaveLength(1);
  });

  it('the same message never pops twice', () => {
    svc.push(input('c1', 'm1'));
    svc.push(input('c1', 'm1'));
    expect(svc.popups()[0].count).toBe(1);
  });

  it('keeps at most 3 cards, newest first', () => {
    for (const c of ['a', 'b', 'c', 'd']) svc.push(input(c, 'm-' + c));
    expect(svc.popups().map(p => p.conversationId)).toEqual(['d', 'c', 'b']);
  });

  it('dismissConversation + clear', () => {
    svc.push(input('a', '1'));
    svc.push(input('b', '2'));
    svc.dismissConversation('a');
    expect(svc.popups().map(p => p.conversationId)).toEqual(['b']);
    svc.clear();
    expect(svc.popups()).toEqual([]);
  });
});
