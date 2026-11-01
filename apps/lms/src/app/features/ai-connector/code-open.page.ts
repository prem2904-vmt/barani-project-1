import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../../shared/models/api-response.model';
import { SkeletonDetailComponent } from '../../shared/primitives/skeleton-kit.component';
import { AiConnectorApi } from './ai-connector.api';

export type CodeOpenPhase = 'loading' | 'staff' | 'expired' | 'error';

/** Where a resolved patient code goes: a single mentioned order → the order landing (/o/:id), else the patient profile. */
export function patientTarget(patientId: string, orderIds: readonly string[]): string[] {
  return orderIds.length === 1 ? ['/o', orderIds[0]] : ['/frontdesk/patients', patientId];
}

/**
 * /r/:code — the "open in Prefrontal" link an AI answer carries. The AI only ever sees expiring
 * codes (P-xxxxx patients, T-n staff); THIS page turns the code back into the real record with a
 * plain server lookup (never an AI). Signed-out → the shell's auth guard sends to login and back.
 * The server answers 404 for expired / someone else's / other lab / not permitted — all shown as
 * the same sentence, so the page never reveals which one it was.
 */
@Component({
  selector: 'pf-code-open',
  standalone: true,
  imports: [SkeletonDetailComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-co">
      @switch (phase()) {
        @case ('loading') {
          <pf-skeleton-detail [fields]="4" [sections]="1" label="Opening…"></pf-skeleton-detail>
        }
        @case ('staff') {
          <section class="pf-card pf-co__card" aria-labelledby="pf-co-staff">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
              </span>
              <h2 class="pf-card__label" id="pf-co-staff">Staff member</h2>
            </header>
            <div class="pf-card__body pf-co__body">
              <p class="pf-co__name">{{ staffName() }}</p>
              <p class="pf-field__hint">Shown to the connected app only as a short code. Names stay inside Prefrontal.</p>
              <a class="pf-btn pf-btn--secondary press" routerLink="/">Back to Prefrontal</a>
            </div>
          </section>
        }
        @case ('expired') {
          <section class="pf-card pf-co__card" role="alert">
            <div class="pf-card__body pf-co__body">
              <p class="pf-co__name">This link has expired or isn’t yours.</p>
              <p class="pf-field__hint">Links from a connected app’s answer last one day and open only for the person who asked. Ask the question again to get a fresh link.</p>
              <a class="pf-btn pf-btn--secondary press" routerLink="/">Back to Prefrontal</a>
            </div>
          </section>
        }
        @case ('error') {
          <section class="pf-card pf-co__card" role="alert">
            <div class="pf-card__body pf-co__body">
              <p class="pf-co__name">Couldn’t open this link.</p>
              <p class="pf-field__hint">Check your connection and try again.</p>
              <button type="button" class="pf-btn pf-btn--secondary press" (click)="open()">Try again</button>
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .pf-co { display: flex; justify-content: center; padding: 48px 16px; min-height: 60vh; }
    .pf-co__card { width: 100%; max-width: 480px; align-self: flex-start; }
    .pf-co__body { display: grid; gap: 12px; padding: 16px 18px 18px; justify-items: start; }
    .pf-co__name { margin: 0; font-size: 17px; font-weight: 600; color: var(--text-primary); text-wrap: pretty; }
  `],
})
export class CodeOpenPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AiConnectorApi);

  readonly phase = signal<CodeOpenPhase>('loading');
  readonly staffName = signal('');

  constructor() {
    void this.open();
  }

  async open(): Promise<void> {
    const code = (this.route.snapshot.paramMap.get('code') ?? '').trim();
    if (!code) { this.phase.set('expired'); return; }
    this.phase.set('loading');
    try {
      const r = await firstValueFrom(this.api.resolve(code));
      if (r.kind === 'patient') {
        await this.router.navigate(patientTarget(r.patientId, r.orderIds ?? []), { replaceUrl: true });
      } else {
        this.staffName.set(r.name);
        this.phase.set('staff');
      }
    } catch (e) {
      this.phase.set(ApiError.from(e).code === 'not_found' ? 'expired' : 'error');
    }
  }
}
