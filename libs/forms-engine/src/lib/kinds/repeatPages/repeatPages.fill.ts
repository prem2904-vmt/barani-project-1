import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { FeDialog, PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { instancesOf, isAnswered } from '../../core/pages';
import { resizeInstances } from '../../core/rules';
import { cfg } from '../../core/types';
import { FE_WIZARD, KindFill, injectLegacy } from '../../fill/contract';

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
  imports: [PfIconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (legacy()) {
      <!-- legacy recursive-pages-input: "How many Ulcer?" and a number box (a dropdown when the form says so); individual mode = one box per page -->
      <div class="fe-rp fe-rp--legacy" role="group" [attr.aria-labelledby]="labelId()">
        @if (!individual()) {
          <div class="fe-countrow">
            <span class="fe-countrow__lbl">How many {{ countWord() }}?</span>
            @if (useDropdown()) {
              <pf-select
                class="fe-countrow__sel"
                [options]="rangeOf('*')"
                [value]="shownCount(counts()[0])"
                [disabled]="disabled()"
                (valueChange)="setCount(counts()[0], $event ?? minCount())"
              />
            } @else {
              <input
                type="number"
                class="fe-countrow__in"
                data-count="*"
                [attr.min]="minCount()"
                [attr.max]="maxCount()"
                [attr.aria-label]="'How many ' + countWord()"
                [value]="shownCount(counts()[0])"
                [disabled]="disabled()"
                (input)="typeCount(counts()[0], $any($event.target).value)"
              />
            }
          </div>
        } @else {
          <div class="fe-countgrid">
            @for (pc of counts(); track pc.page) {
              <label class="fe-countgrid__cell">
                <span class="fe-countgrid__lbl">{{ pc.title }}</span>
                @if (useDropdown()) {
                  <pf-select
                    [options]="rangeOf(pc.page)"
                    [value]="shownCount(pc)"
                    [disabled]="disabled()"
                    (valueChange)="setCount(pc, $event ?? minCount())"
                  />
                } @else {
                  <input
                    type="number"
                    class="fe-countrow__in"
                    [attr.data-count]="pc.page"
                    [attr.min]="entryOf(pc.page, 'minCount', minCount())"
                    [attr.max]="entryOf(pc.page, 'maxCount', maxCount())"
                    [value]="shownCount(pc)"
                    [disabled]="disabled()"
                    (input)="typeCount(pc, $any($event.target).value)"
                  />
                }
              </label>
            }
          </div>
        }
      </div>
    } @else {
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
    }
  `,
})
export class RepeatPagesFill extends KindFill {
  private readonly dialog = inject(FeDialog);
  private readonly wizard = inject(FE_WIZARD);
  protected readonly legacy = injectLegacy();
  private seeded = false;

  constructor() {
    super();
    // Legacy: the pages are there from the start (the form's default count), before anyone touches the count.
    effect(() => {
      if (!this.legacy() || this.disabled() || this.value() != null || this.seeded) return;
      untracked(() => {
        const instances = this.defaultInstances();
        this.seeded = true;
        if (instances.length) this.emit({ instances });
      });
    });
  }

  protected readonly individual = computed(() => this.config()['mode'] === 'individual');
  protected readonly useDropdown = computed(() => this.config()['useDropdown'] === true);
  protected readonly countWord = computed(() => ((this.config()['labelPrefix'] as string) || '').trim() || 'repetitions');

  /** One number from the page's own entry (individual mode), else the form-wide one. */
  protected entryOf(page: string, key: string, fallback: number): number {
    const e = (this.config()['pageEntries'] as { page?: string; [k: string]: unknown }[] | undefined)?.find((x) => x.page === page);
    return typeof e?.[key] === 'number' ? (e[key] as number) : fallback;
  }

  private defaultFor(page: string): number {
    return this.individual() ? this.entryOf(page, 'defaultCount', 1) : ((this.config()['defaultCount'] as number) ?? 1);
  }

  private defaultInstances(): { page: string; index: number; values: Record<string, unknown> }[] {
    const out: { page: string; index: number; values: Record<string, unknown> }[] = [];
    for (const p of this.pages()) for (let i = 0; i < this.defaultFor(p); i++) out.push({ page: p, index: i, values: {} });
    return out;
  }

  /** What the count box shows: the stored count, or the form's default until the first change. */
  protected shownCount(pc: PageCount): number {
    return this.value() == null ? (pc.page === '*' ? this.defaultFor(this.pages()[0] ?? '') : this.defaultFor(pc.page)) : pc.count;
  }

  /** The choices of a dropdown count (legacy useDropdown): the dropdown range, else min..max. */
  protected rangeOf(page: string): PfSelectOption<number>[] {
    const lo = page === '*' ? ((this.config()['dropdownMin'] as number) ?? 0) : this.entryOf(page, 'dropdownMin', 0);
    const hi = page === '*' ? ((this.config()['dropdownMax'] as number) ?? 5) : this.entryOf(page, 'dropdownMax', 5);
    return Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => ({ value: lo + i, label: String(lo + i) }));
  }

  protected typeCount(pc: PageCount, raw: string): void {
    const n = parseInt(raw, 10);
    void this.setCount(pc, Number.isNaN(n) ? this.minCount() : n);
  }

  private readonly pages = computed(() => cfg<string[]>(this.field(), 'pages', []));
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
    await this.setCount(pc, pc.count + delta);
  }

  /** Any count at once (the legacy box); lowering it asks first when the dropped pages hold answers. */
  protected async setCount(pc: PageCount, wanted: number): Promise<void> {
    const next = Math.max(this.minCount(), Math.min(this.maxCount(), Math.floor(wanted)));
    const had = this.value() == null ? this.shownCount(pc) : pc.count;
    if (next === had && this.value() != null) return;
    if (next < had) {
      const dropped = instancesOf(this.value()).filter(
        (i) => i.index >= next && (pc.page === '*' || i.page === pc.page),
      );
      if (dropped.some((i) => Object.values(i.values ?? {}).some(isAnswered))) {
        const ok = await this.dialog.confirm({
          title: next === had - 1 ? `Remove ${pc.title} ${had}?` : `Remove ${had - next} pages?`,
          message: 'The answers on that page will be removed from this case sheet.',
          confirmLabel: 'Remove',
          cancelLabel: 'Keep',
          tone: 'danger',
        });
        if (!ok) return;
      }
    }
    const v = resizeInstances(this.field(), this.value(), next, pc.page === '*' ? undefined : pc.page);
    // legacy keeps an explicit zero (an unset count means the form's default number of pages)
    this.emit(v.instances.length || this.legacy() ? v : undefined);
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
