import { Injectable, signal } from '@angular/core';

/**
 * Shared open-state for the Messages panel (the conversations + people
 * list anchored to the bar's chat icon). Lives in a service so the
 * floating windows' compose button can raise the SAME panel instead of
 * a second, competing picker.
 */
@Injectable({ providedIn: 'root' })
export class MessagesPanelService {
  readonly open = signal(false);
  toggle(): void { this.open.set(!this.open()); }
  close(): void { this.open.set(false); }
  show(): void { this.open.set(true); }
}
