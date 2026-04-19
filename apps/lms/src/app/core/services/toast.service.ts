import { Injectable, signal } from '@angular/core';

export type ToastLevel = 'success' | 'error' | 'info' | 'warning';
export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _seq = 1;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  show(message: string, level: ToastLevel = 'info', timeoutMs = 4000): void {
    const id = this._seq++;
    this._toasts.update(list => [...list, { id, level, message }]);
    setTimeout(() => this.dismiss(id), timeoutMs);
  }

  success(msg: string, ms?: number) { this.show(msg, 'success', ms); }
  error(msg: string, ms?: number) { this.show(msg, 'error', ms); }
  info(msg: string, ms?: number) { this.show(msg, 'info', ms); }
  warning(msg: string, ms?: number) { this.show(msg, 'warning', ms); }

  dismiss(id: number): void {
    this._toasts.update(list => list.filter(t => t.id !== id));
  }
}
