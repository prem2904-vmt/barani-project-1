import { Injectable, signal } from '@angular/core';

export type ToastLevel = 'success' | 'error' | 'info' | 'warning';
/** Optional ONE action on a toast ("Undo", "Print label"); pressing it runs `run` and dismisses the toast. */
export interface ToastAction { label: string; run: () => void; }
export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
  action?: ToastAction;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _seq = 1;
  private readonly _toasts = signal<Toast[]>([]);
  /** Each live toast's dismiss timer and its length (a toast under the pointer / with focus is held, then released). */
  private readonly _timers = new Map<number, { h: ReturnType<typeof setTimeout>; ms: number }>();
  readonly toasts = this._toasts.asReadonly();

  show(message: string, level: ToastLevel = 'info', timeoutMs = 4000, action?: ToastAction): number {
    const id = this._seq++;
    this._toasts.update(list => [...list, action ? { id, level, message, action } : { id, level, message }]);
    this._timers.set(id, { h: setTimeout(() => this.dismiss(id), timeoutMs), ms: timeoutMs });
    return id;
  }

  /** The pointer is over the toast or focus is inside it (Safari / keyboard users reaching for "Undo"): keep it on screen. */
  hold(id: number): void {
    const t = this._timers.get(id);
    if (t) clearTimeout(t.h);
  }

  /** The pointer left / focus went away: give it a short grace, then dismiss as usual. */
  release(id: number): void {
    const t = this._timers.get(id);
    if (!t) return;
    clearTimeout(t.h);
    t.h = setTimeout(() => this.dismiss(id), Math.min(t.ms, 3000));
  }

  /** A toast with one action button (e.g. Undo for 6 s). Returns the toast id. */
  withAction(message: string, action: ToastAction, level: ToastLevel = 'success', timeoutMs = 6000): number {
    return this.show(message, level, timeoutMs, action);
  }

  /** Runs a toast's action once and dismisses it. */
  runAction(t: Toast): void {
    this.dismiss(t.id);
    try { t.action?.run(); } catch { /* the action reports its own errors */ }
  }

  success(msg: string, ms?: number) { this.show(msg, 'success', ms); }
  error(msg: string, ms?: number) { this.show(msg, 'error', ms); }
  info(msg: string, ms?: number) { this.show(msg, 'info', ms); }
  warning(msg: string, ms?: number) { this.show(msg, 'warning', ms); }

  dismiss(id: number): void {
    const t = this._timers.get(id);
    if (t) { clearTimeout(t.h); this._timers.delete(id); }
    this._toasts.update(list => list.filter(t => t.id !== id));
  }
}
