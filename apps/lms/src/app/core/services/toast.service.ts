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
  readonly toasts = this._toasts.asReadonly();

  show(message: string, level: ToastLevel = 'info', timeoutMs = 4000, action?: ToastAction): number {
    const id = this._seq++;
    this._toasts.update(list => [...list, action ? { id, level, message, action } : { id, level, message }]);
    setTimeout(() => this.dismiss(id), timeoutMs);
    return id;
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
    this._toasts.update(list => list.filter(t => t.id !== id));
  }
}
