import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { lineShort, sayRx } from '../shared/rx-schedule';
import type { OpdRxLineDto } from '../shared/opd.models';
import { ConsultApi, ConsultPastConsult } from './consult.api';
import { OpdFormRendererComponent } from '../admin/forms/renderer';
import { fromDto } from './rx/rx-model';
import { procedurePrintText } from './rx-print';
import { JourneyDockComponent } from '../shared/journey-dock.component';
import { JourneyDockService, journeyDayKey } from '../shared/journey-dock.service';

/**
 * `/opd/patient/:patientId` — the patient's past OPD consults (Agent C), each
 * rendered with ITS OWN pinned form version (read-only through the form seam),
 * its prescription in doctor shorthand + the patient sentence, and its
 * investigations. Private notes are never shown here.
 */
@Component({
  selector: 'pf-opd-patient-history',
  standalone: true,
  imports: [DatePipe, HeroBandComponent, OpdFormRendererComponent, JourneyDockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" [customSearch]="true" [contextBar]="true">
        <div band-search class="nd-ctx">
          <span class="nd-ctx__primary">OPD history</span>
          <span class="nd-ctx__chip"><span class="nd-ctx__k">Consults</span>{{ rows().length }}</span>
        </div>
      </pf-hero-band>
      <div class="pf-band-body ph__body">
        @if (loading()) {
          @for (i of [1, 2]; track i) { <div class="ph__skel"></div> }
        }
        @for (c of rows(); track c.visitId) {
          <article class="nd-card ph__card" [attr.data-day]="day(c.visitDate)" [class.ph__card--on]="dock.selectedKey() === day(c.visitDate)">
            <div class="nd-card__head">
              <span class="nd-card__label">{{ c.visitDate | date:'EEE, MMM d, y' }}</span>
              <span class="nd-card__note">{{ c.doctorName }}@if (c.departmentName) { · {{ c.departmentName }}}</span>
              <button type="button" class="nd-btn nd-btn--quiet" (click)="open(c.visitId)">Open</button>
            </div>
            <div class="nd-card__body ph__cb">
              @if (c.diagnoses.length) { <p class="ph__dx"><b>Diagnosis:</b> {{ dx(c) }}</p> }
              @if (c.chiefComplaint) { <p class="ph__t"><b>Complaint:</b> {{ c.chiefComplaint }}</p> }
              @if (c.form) {
                <pf-opd-form-renderer [schema]="c.form.schema" [addons]="c.form.addonFields" [answers]="c.answers ?? {}" mode="readonly" [layout]="'phone'" [visitDate]="c.visitDate"></pf-opd-form-renderer>
                <p class="ph__muted">Form: {{ c.form.formName }} v{{ c.form.version }}</p>
              }
              @if (c.rx.length) {
                <div class="ph__k">Prescription</div>
                @for (r of c.rx; track $index) {
                  <div class="ph__rx"><b>{{ r.drugName }}</b> · {{ short(r) }}<span>{{ say(r) }}</span></div>
                }
              }
              @if (tests(c)) { <p class="ph__t"><b>Investigations:</b> {{ tests(c) }}</p> }
              @if (c.procedures?.length) { <p class="ph__t"><b>Procedures:</b> {{ procs(c) }}</p> }
              @if (c.advice) { <p class="ph__t"><b>Advice:</b> {{ c.advice }}</p> }
            </div>
          </article>
        } @empty {
          @if (!loading()) {
            <div class="nd-empty"><p class="nd-empty__title">No completed OPD consults yet</p></div>
          }
        }
      </div>
      <pf-journey-dock class="ph__dock" (picked)="scrollTo($event)"></pf-journey-dock>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .ph { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .ph__body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 24px; display: flex; flex-direction: column; gap: 14px; max-width: 960px; width: 100%; margin: 0 auto; }
    .ph__card { overflow: visible; }
    .ph__cb { overflow: visible; gap: 10px; }
    .ph__dx, .ph__t { margin: 0; font-size: 13.5px; line-height: 1.45; color: var(--text-primary); }
    .ph__dx b, .ph__t b { font-weight: 600; }
    .ph__k { font-size: 11.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .ph__rx { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
    .ph__rx span { font-size: 12.5px; color: var(--text-tertiary); }
    .ph__muted { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .ph__card--on { border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent); }
    .ph__dock { margin-inline: calc(-1 * var(--pf-hb-bleed, 0px)); }
    .ph__skel { height: 140px; border-radius: 16px; background: var(--nd-chip-bg); }
  `],
})
export class OpdPatientHistoryPage implements OnInit, OnDestroy {
  private readonly api = inject(ConsultApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  /** The journey dock (consult v6): a date tap scrolls to that consult. */
  readonly dock = inject(JourneyDockService);
  readonly rows = signal<ConsultPastConsult[]>([]);
  readonly loading = signal(true);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('patientId');
    if (!id) { this.loading.set(false); return; }
    this.dock.show({ id, name: 'this patient' });
    const at = this.route.snapshot.queryParamMap?.get('date');
    if (at) this.dock.select(at);
    this.api.history(id).subscribe({
      next: r => { this.rows.set(r ?? []); this.loading.set(false); if (at) queueMicrotask(() => this.scrollTo(at)); },
      error: () => this.loading.set(false),
    });
  }
  ngOnDestroy() { this.dock.hide(); }
  day(iso: string) { return journeyDayKey(iso); }
  /** Bring the consult of that day into view (no-op for a lab-only day). */
  scrollTo(day: string) {
    const el = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-day="${day}"]`);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  dx(c: ConsultPastConsult) { return c.diagnoses.map(d => d.label).join(', '); }
  procs(c: ConsultPastConsult) { return (c.procedures ?? []).map(procedurePrintText).join(', '); }
  tests(c: ConsultPastConsult) { return (c.investigations ?? []).flatMap(i => i.items).map(t => t.name).join(', '); }
  short(r: OpdRxLineDto) { const l = fromDto(r); return lineShort(l.line, l.drug); }
  say(r: OpdRxLineDto) { const l = fromDto(r); return sayRx(l.line, l.drug); }
  open(visitId: string) { this.router.navigate(['/opd/consult', visitId]); }
}
