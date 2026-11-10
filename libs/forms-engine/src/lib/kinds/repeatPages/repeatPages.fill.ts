import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FeDialog, PfIconComponent } from '../../kit';
import { instancesOf, isAnswered } from '../../core/pages';
import { resizeInstances } from '../../core/rules';
import { cfg } from '../../core/types';
import { FE_WIZARD, KindFill } from '../../fill/contract';

interface PageCount {
  page: string;
  title: string;
  count: number;
}

/**
 * repeatPages: "How many?" — a stepper that adds whole pages to the wizard
 * (each pregnancy, each operation), then chips that jump to each one
 * ("Pregnancy 1", "Pregnancy 2"). `individual` mode has one stepper per
 * page. Lowering the count asks first when the last repetition holds answers.
 */
@Component({
  selector: 'fe-repeat-pages-fill',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-rp" role="group" [attr.aria-labelledby]="labelId()">
      @for (pc of counts(); track pc.page) {
        <div class="fe-sub">
          @if (counts().length > 1) {
            <span class="fe-sub__lbl">{{ pc.title }}</span>
          }
          <div class="fe-stepper">
            <button
              type="button"
              class="fe-stepper__btn"
              [attr.aria-label]="'One fewer ' + pc.title"
              [disabled]="disabled() || pc.count <= minCount()"
              (click)="change(pc, -1)"
            >
              <pf-icon name="minus" [size]="22" />
            </button>
            <span class="fe-numbox fe-numbox--static" aria-live="polite">
              <span class="fe-numbox__v">{{ pc.count }}</span>
              <span class="fe-numbox__u">{{ pc.count === 1 ? 'page' : 'pages' }}</span>
            </span>
            <button
              type="button"
              class="fe-stepper__btn"
              [attr.aria-label]="'One more ' + pc.title"
              [disabled]="disabled() || pc.count >= maxCount()"
              (click)="change(pc, 1)"
            >
              <pf-icon name="plus" [size]="22" />
            </button>
          </div>
        </div>
      }
      @if (instances().length && arranged()) {
        <ol class="fe-rp__order" aria-label="The order these pages are filled and printed in">
          @for (i of instances(); track i.id; let first = $first; let last = $last; let n = $index) {
            <li class="fe-rp__row" [attr.data-instance]="i.id">
              <button type="button" class="fe-chip fe-rp__go" [attr.aria-label]="'Go to ' + i.title + (i.answered ? ', has answers' : '')" (click)="go(i.id)">
                <span class="fe-rp__n">{{ n + 1 }}</span> {{ i.title }}
                @if (i.answered) {
                  <span class="fe-rp__done" aria-hidden="true"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                }
                <pf-icon name="chevron-right" [size]="16" />
              </button>
              <button
                type="button"
                class="fe-iconbtn"
                [attr.aria-label]="'Move ' + i.title + ' earlier'"
                [disabled]="disabled() || first"
                (click)="move(n, -1)"
              >
                <pf-icon name="arrow-up" [size]="20" />
              </button>
              <button
                type="button"
                class="fe-iconbtn"
                [attr.aria-label]="'Move ' + i.title + ' later'"
                [disabled]="disabled() || last"
                (click)="move(n, 1)"
              >
                <pf-icon name="arrow-down" [size]="20" />
              </button>
            </li>
          }
        </ol>
      } @else if (instances().length) {
        <div class="fe-chips" role="group" aria-label="Go to a page">
          @for (i of instances(); track i.id) {
            <button
              type="button"
              class="fe-chip"
              [attr.data-instance]="i.id"
              [attr.data-answered]="i.answered"
              [attr.aria-label]="'Go to ' + i.title + (i.answered ? ', has answers' : '')"
              (click)="go(i.id)"
            >
              @if (i.answered) {
                <span class="fe-rp__done" aria-hidden="true"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
              }
              {{ i.title }}
              <pf-icon name="chevron-right" [size]="16" />
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class RepeatPagesFill extends KindFill {
  private readonly dialog = inject(FeDialog);
  private readonly wizard = inject(FE_WIZARD);

  private readonly pages = computed(() => cfg<string[]>(this.field(), 'pages', []));
  private readonly individual = computed(() => this.config()['mode'] === 'individual');
  protected readonly minCount = computed(() => (this.config()['minCount'] as number) ?? 0);
  protected readonly maxCount = computed(() => (this.config()['maxCount'] as number) ?? 10);
  private title(page: string): string {
    return this.wizard?.pageTitle(page) || page;
  }

  protected readonly counts = computed<PageCount[]>(() => {
    const insts = instancesOf(this.value());
    const n = (p: string) => insts.filter((i) => i.page === p).length;
    if (!this.individual()) {
      const count = Math.max(0, ...this.pages().map(n));
      const title = this.pages().length === 1 ? this.title(this.pages()[0]) : this.field().label;
      return [{ page: '*', title, count }];
    }
    return this.pages().map((p) => ({ page: p, title: this.title(p), count: n(p) }));
  });

  /** The doctor arranges the order (legacy orderMode custom / instance, a drag list there; Move earlier / later here). */
  protected readonly arranged = computed(() => (this.config()['orderMode'] ?? 'static') !== 'static');

  protected readonly instances = computed(() =>
    (this.arranged()
      ? instancesOf(this.value())
      : instancesOf(this.value())
          .slice()
          .sort((a, b) => a.index - b.index || this.pages().indexOf(a.page) - this.pages().indexOf(b.page))
    )
      .map((i) => ({
        id: `${this.field().key}#${i.page}#${i.index}`,
        title: `${this.title(i.page)} ${i.index + 1}`,
        // a tick on the chips of the pages already filled in
        answered: Object.values(i.values ?? {}).some(isAnswered),
      })),
  );

  protected async change(pc: PageCount, delta: 1 | -1): Promise<void> {
    const next = pc.count + delta;
    if (next < this.minCount() || next > this.maxCount()) return;
    if (delta < 0) {
      const dropped = instancesOf(this.value()).filter(
        (i) => i.index === next && (pc.page === '*' || i.page === pc.page),
      );
      if (dropped.some((i) => Object.values(i.values ?? {}).some(isAnswered))) {
        const ok = await this.dialog.confirm({
          title: `Remove ${pc.title} ${next + 1}?`,
          message: 'The answers on that page will be removed from this case sheet.',
          confirmLabel: 'Remove',
          cancelLabel: 'Keep',
          tone: 'danger',
        });
        if (!ok) return;
      }
    }
    const v = resizeInstances(this.field(), this.value(), next, pc.page === '*' ? undefined : pc.page);
    this.emit(v.instances.length ? v : undefined);
  }

  /** Swap a repetition with its neighbour; the list order is the order of the wizard and the narrative. */
  protected move(at: number, dir: 1 | -1): void {
    const list = [...instancesOf(this.value())];
    const to = at + dir;
    if (to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    this.emit({ instances: list });
  }

  protected go(id: string): void {
    this.wizard?.goTo(id);
  }
}
