import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Order } from '../../../../shared/models/order.model';
import type { EmailRecipient } from '../../../../shared/utils/email-share';
import type { WaRecipient } from '../../../../core/services/whatsapp-manual.service';

/** The landing's existing share rules + senders (never re-implemented here). */
export interface FlowShareApi {
  waShareMode(): 'auto' | 'chat' | null | undefined | false | string;
  waDoctorPhone(o: Order): string | null;
  emailFor(o: Order): { patient: boolean; doctor: boolean } | null;
  smsFor(o: Order): { patient: boolean; doctor: boolean } | null;
  emailBusy(): boolean;
  shareReportWhatsapp(o: Order, to?: WaRecipient): unknown;
  emailReport(o: Order, to: EmailRecipient): unknown;
  smsReport(o: Order, to: WaRecipient): unknown;
}

/**
 * The flow grid's Share menu: the work list's Share rows (WhatsApp · Email · SMS, patient / doctor) with the same
 * `data-test` hooks, opened by a grid row's Share (Next or ⋯). The grid's rows are drawn by AG-Grid, so the menu
 * floats in a fixed box laid over the pressed control (`rect`) and opens below it near the top of the screen,
 * above it otherwise — the old row menu's own placement. Styles: the ONE share-menu stylesheet (_share-menu.scss).
 * Every row only CALLS the landing's existing sender; this component decides nothing about who may get what.
 */
@Component({
  selector: 'pf-fd-flow-share-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let o = order();
    <div class="pf-share-wrapper fd-share-float" [style.top.px]="rect().top" [style.left.px]="rect().left"
      [style.width.px]="rect().width" [style.height.px]="rect().height">
      <div class="pf-share-menu" [class.pf-share-menu--down]="down()" role="menu" aria-label="Share report">
        @if (api().waShareMode() === 'chat' && api().waDoctorPhone(o)) {
          <span class="pf-share-menu__label" aria-hidden="true">WhatsApp</span>
          <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-whatsapp-patient" aria-label="WhatsApp: send to patient"
            title="WhatsApp Chat: opens the patient's chat with the report ready; you press Send" (click)="send(() => api().shareReportWhatsapp(o, 'patient'))">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="WA" /></svg>
            <span>Send to patient</span>
          </button>
          <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-whatsapp-doctor" aria-label="WhatsApp: send to doctor"
            [title]="'WhatsApp Chat: opens ' + (o.refDoctorName || 'the referral doctor') + '\\'s chat with the report ready; you press Send'"
            (click)="send(() => api().shareReportWhatsapp(o, 'doctor'))">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="WA" /></svg>
            <span>Send to doctor</span>
          </button>
        } @else if (api().waShareMode()) {
          <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-whatsapp" [title]="waTitle()"
            (click)="send(() => api().shareReportWhatsapp(o))">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="WA" /></svg>
            <span>WhatsApp</span>
          </button>
        }
        @if (api().emailFor(o); as em) {
          @if (em.doctor) {
            <span class="pf-share-menu__label" aria-hidden="true">Email</span>
            @if (em.patient) {
              <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-email-both" aria-label="Email: send to both"
                title="The lab emails the report PDF to the patient and the referral doctor" [disabled]="api().emailBusy()"
                (click)="send(() => api().emailReport(o, 'both'))">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="MAIL1" /><path [attr.d]="MAIL2" /></svg>
                <span>Send to both</span>
              </button>
              <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-email-patient" aria-label="Email: send to patient"
                title="The lab emails the report PDF to the patient" [disabled]="api().emailBusy()"
                (click)="send(() => api().emailReport(o, 'patient'))">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="MAIL1" /><path [attr.d]="MAIL2" /></svg>
                <span>Send to patient</span>
              </button>
            }
            <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-email-doctor" aria-label="Email: send to doctor"
              [title]="'The lab emails the report PDF to ' + (o.refDoctorName || 'the referral doctor')" [disabled]="api().emailBusy()"
              (click)="send(() => api().emailReport(o, 'doctor'))">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="MAIL1" /><path [attr.d]="MAIL2" /></svg>
              <span>Send to doctor</span>
            </button>
          } @else {
            <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-email"
              title="The lab emails the report PDF to the patient" [disabled]="api().emailBusy()"
              (click)="send(() => api().emailReport(o, 'patient'))">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="MAIL1" /><path [attr.d]="MAIL2" /></svg>
              <span>Email</span>
            </button>
          }
        }
        @if (api().smsFor(o); as sm) {
          @if (sm.doctor) {
            <span class="pf-share-menu__label" aria-hidden="true">SMS</span>
            @if (sm.patient) {
              <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-sms-patient" aria-label="SMS: send to patient"
                title="Opens Messages with the report link ready; you press Send" (click)="send(() => api().smsReport(o, 'patient'))">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="SMS1" /><path d="M7 8h10M7 12h6" /></svg>
                <span>Send to patient</span>
              </button>
            }
            <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-sms-doctor" aria-label="SMS: send to doctor"
              title="Opens Messages with the report link ready; you press Send" (click)="send(() => api().smsReport(o, 'doctor'))">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="SMS1" /><path d="M7 8h10M7 12h6" /></svg>
              <span>Send to doctor</span>
            </button>
          } @else {
            <button type="button" role="menuitem" class="pf-share-menu__item" data-test="share-sms"
              title="Opens Messages with the report link ready; you press Send" (click)="send(() => api().smsReport(o, 'patient'))">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="SMS1" /><path d="M7 8h10M7 12h6" /></svg>
              <span>SMS</span>
            </button>
          }
        }
      </div>
    </div>
  `,
  styleUrl: './flow-share-menu.component.scss',
})
export class FlowShareMenuComponent {
  readonly order = input.required<Order>();
  readonly api = input.required<FlowShareApi>();
  /** The pressed control's box (viewport px). */
  readonly rect = input.required<{ top: number; left: number; width: number; height: number }>();
  readonly closed = output<void>();

  readonly WA = 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z';
  readonly MAIL1 = 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z';
  readonly MAIL2 = 'm22 7-10 6L2 7';
  readonly SMS1 = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';

  /** Below the control in the top part of the screen, above it lower down (the menu can be tall). */
  readonly down = computed(() => this.rect().top < (typeof window === 'undefined' ? 400 : window.innerHeight * 0.45));
  readonly waTitle = computed(() => {
    const a = this.api(); const o = this.order();
    return a.waShareMode() === 'auto'
      ? (a.waDoctorPhone(o) ? 'WhatsApp Auto: the lab number sends the report to the patient and the referral doctor' : 'WhatsApp Auto: the lab number sends the report')
      : 'WhatsApp Chat: opens WhatsApp with the report ready; you press Send';
  });

  /** Run the landing's sender in the click itself (WhatsApp web opens its tab inside the gesture), then close. */
  send(fn: () => unknown): void {
    fn();
    this.closed.emit();
  }
}
