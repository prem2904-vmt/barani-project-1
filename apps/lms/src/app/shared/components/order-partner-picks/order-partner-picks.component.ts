import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';
import { Bill } from '../../models/bill.model';
import { Order } from '../../models/order.model';
import { Test } from '../../models/test.model';
import { SelectComponent } from '../../primitives/select.component';
import { PartnerRow } from '../../utils/order-outsourcing';
import { testListUrl } from '../../utils/test-list-url';
import { OrderPartnerLine, orderPartnerBody, orderPartnerLines } from './order-partner-picks.logic';

/**
 * Where each OUTSOURCED line of an existing order runs (OPS-106) - on the
 * billing screens (the order screen's pay step and the billing counter), the
 * same choice as order-create's cart: the Test Master partner / In-house / any
 * other active partner. A pick saves at once through PATCH orders/{id}/tests
 * (ordered ids + one `outsourcing` entry; the server regroups an undrawn tube,
 * splits a drawn one, and refuses a line with results). Read-only text once
 * the item is collected or the payment is settled (`locked`), and without
 * `modify_order` (the PATCH's own gate). Renders nothing for an in-house order.
 */
@Component({
  selector: 'pf-order-partner-picks',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lines().length) {
      <section class="pf-opp" aria-label="Where outsourced tests run" data-order-partner-picks>
        <h3 class="pf-opp__title">Outsourced tests</h3>
        @for (l of lines(); track l.id) {
          <div class="pf-opp__row" [attr.data-out-id]="l.id">
            <span class="pf-opp__name" [title]="l.name">{{ l.name }}</span>
            @if (l.locked || !canChange()) {
              <span class="pf-opp__where" data-testid="outsourcing-meta">{{ l.label }}</span>
            } @else {
              <pf-select size="sm" class="pf-opp__pick" [options]="l.options" [value]="l.pick"
                         [disabled]="busy() !== null" [attr.aria-label]="'Where ' + l.name + ' runs'"
                         (valueChange)="change(l, $event)"></pf-select>
            }
          </div>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-opp { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
    .pf-opp__title { margin: 0 0 2px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
    .pf-opp__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 8px 12px;
      border-radius: 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-opp__name { min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-opp__where { font-size: 12.5px; color: var(--text-secondary); text-align: right; }
    .pf-opp__pick { flex: 0 1 16rem; min-width: 11rem; }
  `],
})
export class OrderPartnerPicksComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);

  /** The order as the host loaded it (GET /api/orders/{id}: samples[].tests[]). */
  readonly order = input<Order | null>(null);
  /** The tests catalogue when the host has it; otherwise this loads it once. */
  readonly tests = input<readonly Test[] | null>(null);
  /** Payment settled (or any host-level lock): read-only text. */
  readonly locked = input(false);
  /** The server's answer after a pick: the fresh order and the rebuilt bill. */
  readonly changed = output<{ order: Order | null; bill: Bill | null }>();

  private readonly own = signal<Test[]>([]);
  private _testsAsked = false;
  private readonly partners = signal<PartnerRow[]>([]);
  private _partnersAsked = false;
  protected readonly busy = signal<string | null>(null);

  private readonly catalogue = computed<readonly Test[]>(() => {
    const given = this.tests();
    return given && given.length ? given : this.own();
  });
  readonly lines = computed<OrderPartnerLine[]>(() => {
    const byId = new Map(this.catalogue().map(t => [t.id, t] as const));
    return orderPartnerLines(this.order(), id => byId.get(id) as never, this.partners(), this.locked());
  });
  protected readonly canChange = computed(() => this.auth.hasPermission('modify_order'));

  constructor() {
    // The catalogue (only when the host gave none) and the partner names load once an order is on screen.
    effect(() => {
      const o = this.order();
      if (!o) return;
      const given = this.tests();
      if (!(given && given.length) && !this._testsAsked) {
        this._testsAsked = true;
        this.api.get<Test[]>(testListUrl()).subscribe({ next: l => this.own.set(l ?? []), error: () => { /* no picker without it */ } });
      }
    });
    effect(() => {
      if (this._partnersAsked || this.lines().length === 0) return;
      this._partnersAsked = true;
      this.api.get<PartnerRow[]>('/api/referral-labs?includeInactive=true').subscribe({
        next: rows => this.partners.set((rows ?? []).map(r => ({ id: r.id, name: r.name, isActive: r.isActive ?? true }))),
        error: () => { /* names fall back to "Partner lab"; the choice still works */ },
      });
    });
  }

  async change(line: OrderPartnerLine, value: string): Promise<void> {
    const o = this.order();
    if (!o || this.busy() || (value ?? '') === line.pick) return;
    this.busy.set(line.id);
    let bill: Bill | null = null;
    try {
      const res = await firstValueFrom(this.api.patch<{ order?: Order; bill?: Bill | null }>(
        `/api/orders/${o.id}/tests`, orderPartnerBody(o as never, line.id, value ?? '')));
      bill = res?.bill ?? null;     // rebuilt by the server (the price does not depend on the partner)
      this.toasts.success('Updated where ' + line.name + ' runs');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      // Re-read the order: the tube / effective partner moved - or the refusal means it moved on.
      this.api.get<Order>(`/api/orders/${o.id}`).subscribe({ next: fresh => this.changed.emit({ order: fresh ?? null, bill }) });
      this.busy.set(null);
    }
  }
}
