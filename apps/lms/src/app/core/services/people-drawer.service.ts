import { Injectable, signal } from '@angular/core';

/**
 * Thin shared state for the People drawer. Lets the top-strip button
 * toggle it without holding a viewChild reference to the drawer (which
 * lives in the shell tree).
 */
@Injectable({ providedIn: 'root' })
export class PeopleDrawerService {
  readonly open = signal(false);

  toggle(): void { this.open.set(!this.open()); }
  openIt(): void { this.open.set(true); }
  close(): void { this.open.set(false); }
}
