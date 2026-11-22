import { DestroyRef, Injectable, inject } from '@angular/core';

/** One screen's Save, as the keyboard sees it. */
export interface SaveShortcutHandler {
  /** The screen's Save is on screen (false = this handler is ignored, the next one down answers). */
  active?: () => boolean;
  /** The Save button is ENABLED (something changed and nothing is in flight). */
  canSave: () => boolean;
  save: () => void;
  /** Higher answers first (default 0). The Settings band Save registers at -1: a screen's own Save always wins. */
  priority?: number;
}

/** Ctrl/Cmd+S (no Shift / Alt). */
export function isSaveKey(ev: KeyboardEvent): boolean {
  return (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (ev.key === 's' || ev.key === 'S' || ev.code === 'KeyS');
}

/**
 * Ctrl/Cmd+S presses the screen's Save — and does NOTHING when there are no changes (owner 2026-11-19: Save only when
 * something changed; the shortcut follows the button). The newest active handler answers; while any Save is on screen
 * the browser's own "Save page" never opens. With no Save on screen the key is left alone.
 */
@Injectable({ providedIn: 'root' })
export class SaveShortcutService {
  private readonly handlers: SaveShortcutHandler[] = [];
  private listening = false;

  register(h: SaveShortcutHandler): () => void {
    this.handlers.push(h);
    this.listen();
    return () => {
      const i = this.handlers.lastIndexOf(h);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** The handler that would answer now (newest active), or null. */
  current(): SaveShortcutHandler | null {
    let best: SaveShortcutHandler | null = null;
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      const h = this.handlers[i];
      if (h.active && !h.active()) continue;
      if (!best || (h.priority ?? 0) > (best.priority ?? 0)) best = h;
    }
    return best;
  }

  /** Handle one keydown; true when it was a Save key that a screen took. Exposed for specs. */
  handle(ev: KeyboardEvent): boolean {
    if (!isSaveKey(ev) || ev.defaultPrevented) return false;
    const h = this.current();
    if (!h) return false;
    ev.preventDefault();
    if (!ev.repeat && h.canSave()) h.save();
    return true;
  }

  private listen(): void {
    if (this.listening || typeof document === 'undefined') return;
    this.listening = true;
    document.addEventListener('keydown', ev => this.handle(ev));
  }
}

/** Component sugar: register a Save for the component's lifetime (call in an injection context). */
export function bindSaveShortcut(h: SaveShortcutHandler): void {
  const off = inject(SaveShortcutService).register(h);
  inject(DestroyRef).onDestroy(off);
}
