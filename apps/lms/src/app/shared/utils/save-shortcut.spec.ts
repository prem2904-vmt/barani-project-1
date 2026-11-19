import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SaveShortcutService, isSaveKey } from './save-shortcut';
import { SettingsSaveService } from './settings-save';
import { SettingsSaveComponent } from '../components/setting-row/settings-savebar.component';

const key = (o: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true, bubbles: true, ...o });

/** Owner 2026-11-19: the band Save is disabled until something changed; Ctrl/Cmd+S follows the button. */
describe('Save shortcut + band Save', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('isSaveKey: Ctrl+S and Cmd+S only', () => {
    expect(isSaveKey(key())).toBe(true);
    expect(isSaveKey(key({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSaveKey(key({ shiftKey: true }))).toBe(false);
    expect(isSaveKey(key({ ctrlKey: false }))).toBe(false);
    expect(isSaveKey(key({ key: 'p' }))).toBe(false);
  });

  it('no changes: Ctrl/Cmd+S does nothing (and keeps the browser "Save page" shut); a change: it saves', () => {
    const svc = TestBed.inject(SaveShortcutService);
    const canSave = signal(false);
    const save = vi.fn();
    const off = svc.register({ canSave: () => canSave(), save });
    const e1 = key();
    expect(svc.handle(e1)).toBe(true);
    expect(e1.defaultPrevented).toBe(true);
    expect(save).not.toHaveBeenCalled();
    canSave.set(true);
    svc.handle(key({ metaKey: true, ctrlKey: false }));
    expect(save).toHaveBeenCalledTimes(1);
    svc.handle(key({ repeat: true }));                 // a held key never saves twice
    expect(save).toHaveBeenCalledTimes(1);
    off();
    const e2 = key();
    expect(svc.handle(e2)).toBe(false);                 // no Save on screen: the key is left alone
    expect(e2.defaultPrevented).toBe(false);
  });

  it('the newest ACTIVE handler answers', () => {
    const svc = TestBed.inject(SaveShortcutService);
    const a = vi.fn(); const b = vi.fn();
    const shown = signal(true);
    svc.register({ canSave: () => true, save: a });
    svc.register({ active: () => shown(), canSave: () => true, save: b });
    svc.handle(key());
    expect(b).toHaveBeenCalledTimes(1);
    shown.set(false);
    svc.handle(key());
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('Settings band: Ctrl/Cmd+S saves only a dirty registration', () => {
    const settings = TestBed.inject(SettingsSaveService);
    const keys = TestBed.inject(SaveShortcutService);
    const dirty = signal(false);
    const save = vi.fn();
    const off = settings.register({ dirty: () => dirty(), saving: () => false, canSave: () => true, canDiscard: () => true, testId: () => 'x', save, discard: () => {} });
    keys.handle(key());
    expect(save).not.toHaveBeenCalled();
    dirty.set(true);
    keys.handle(key());
    expect(save).toHaveBeenCalledTimes(1);
    off();
  });

  it('band Save renders DISABLED ("No changes to save", aria-disabled) until dirty, then enabled', () => {
    @Component({ standalone: true, imports: [SettingsSaveComponent], template: '<pf-settings-save></pf-settings-save>' })
    class Host {}
    const settings = TestBed.inject(SettingsSaveService);
    const dirty = signal(false);
    settings.register({ dirty: () => dirty(), saving: () => false, canSave: () => true, canDiscard: () => true, testId: () => 'band-save-btn', save: () => {}, discard: () => {} });
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const btn = () => f.nativeElement.querySelector('[data-testid="band-save-btn"]') as HTMLButtonElement;
    expect(btn()).not.toBeNull();                       // never hidden
    expect(btn().disabled).toBe(true);
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(btn().getAttribute('title')).toBe('No changes to save');
    expect(btn().classList).toContain('pf-hb-btn--primary');
    dirty.set(true);
    f.detectChanges();
    expect(btn().disabled).toBe(false);
    expect(btn().getAttribute('aria-disabled')).toBeNull();
    expect(btn().getAttribute('title')).toBe('Save');
    dirty.set(false);                                    // reverted
    f.detectChanges();
    expect(btn().disabled).toBe(true);
  });
});

describe('Save shortcut priority', () => {
  it('a screen Save outranks the Settings band Save registered after it', () => {
    TestBed.resetTestingModule();
    const keys = TestBed.inject(SaveShortcutService);
    const own = vi.fn(); const band = vi.fn();
    keys.register({ canSave: () => true, save: own });
    keys.register({ canSave: () => true, save: band, priority: -1 });
    keys.handle(key());
    expect(own).toHaveBeenCalledTimes(1);
    expect(band).not.toHaveBeenCalled();
  });
});
