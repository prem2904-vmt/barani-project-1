import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConsultBuilderComponent } from '../consult-builder/consult-builder.component';
import { ConsultDoctor, ConsultDraft } from '../../../shared/opd/consult';
import { ToastService } from '../../../core/services/toast.service';

/**
 * OPD consult screen (slice — SHELL). The separate, non-lab screen the "new
 * order" fork routes to when the user is working in OPD. Hosts the consult
 * builder; persistence (as an Order with Module='opd') and the branch doctor
 * list come in later slices. Fully self-contained — imports nothing from the
 * lab feature.
 */
@Component({
  selector: 'pf-consult-page',
  standalone: true,
  imports: [ConsultBuilderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-consult-page">
      <header class="pf-consult-page__head">
        <button type="button" class="pf-consult-page__back press" (click)="back()" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <p class="pf-consult-page__eyebrow">OPD</p>
          <h1 class="pf-consult-page__title">Consultation</h1>
        </div>
      </header>

      <div class="pf-consult-page__body">
        <pf-consult-builder [doctors]="doctors()" (added)="onAdded($event)"></pf-consult-builder>
      </div>
    </section>
  `,
  styles: [`
    .pf-consult-page { max-width: 620px; margin: 0 auto; padding: 20px 16px 40px; }
    .pf-consult-page__head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
    .pf-consult-page__back { width: 38px; height: 38px; display: inline-flex; align-items: center;
      justify-content: center; border-radius: 10px; color: var(--text-secondary, #cbd5e1);
      background: var(--glass-bg, rgba(255,255,255,0.05));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.14)); cursor: pointer; }
    .pf-consult-page__eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .06em; color: var(--brand, #a855f7); }
    .pf-consult-page__title { font-size: 22px; font-weight: 800; color: var(--text-primary, #e2e8f0); }
    .pf-consult-page__body { padding: 16px; border-radius: 16px;
      background: var(--glass-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1)); }
  `],
})
export class ConsultPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  /** Doctors for this branch — empty until the doctor onboarding slice lands. */
  readonly doctors = signal<ConsultDoctor[]>([]);
  readonly patientId = this.route.snapshot.queryParamMap.get('patientId');

  onAdded(draft: ConsultDraft) {
    // Persistence (Order with Module='opd') arrives in a later slice.
    this.toasts.info(`Consultation with ${draft.doctorName} captured — saving comes next.`);
    this.back();
  }

  back() { void this.router.navigate(['/frontdesk']); }
}
