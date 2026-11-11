import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import {
  Answers,
  FE_WIZARD,
  FieldDef,
  FieldHostComponent,
  NarrativeTable,
  NarrativeTableComponent,
  narrativeEntries,
  FormDefinition,
  applyChange,
  isShown,
  linkDisabledKeys,
  pageLookup,
  pageScope,
  setInScope,
} from '@prefrontal/forms-engine';
import { NgTemplateOutlet } from '@angular/common';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SegmentedComponent, SegmentedOption } from '@prefrontal/shared';
import { deskSignal } from '../shared/desk';
import { WizardController } from './wizard';
import { StudioApi } from '../data/studio-api';
import { PreviewSection } from '../data/studio-models';

type Device = 'tablet' | 'phone' | 'both';

/**
 * Preview on a tablet frame (on a computer: tablet, phone, or both side by
 * side, sharing one set of answers): the REAL filler (the same fe-field controls
 * and page wizard doctors use) on the unsaved form, with its own scratch
 * answers, and the narrative those answers write. Nothing is saved.
 */
@Component({
  selector: 'st-preview',
  standalone: true,
  imports: [PfIconComponent, FieldHostComponent, NarrativeTableComponent, SegmentedComponent, NgTemplateOutlet],
  providers: [WizardController, { provide: FE_WIZARD, useExisting: WizardController }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pv-scrim" (click)="closed.emit()" aria-hidden="true"></div>
    <section class="pv st-doctor-size" role="dialog" aria-modal="true" aria-labelledby="pv-h" [attr.data-device]="device()" (keydown.escape)="$event.preventDefault(); closed.emit()">
      <header class="pv-head">
        <span class="pf-card__icon"><pf-icon [name]="device() === 'phone' ? 'phone' : 'tablet'" [size]="16" /></span>
        <h2 class="pv-title" id="pv-h">{{ heading() }}</h2>
        <span class="pv-note">Try it as a doctor would. Nothing is saved.</span>
        @if (desk()) {
          <pf-segmented class="pv-devices" ariaLabel="Show it on" [options]="devices" [value]="device()" (valueChange)="device.set($event)" />
        }
        <button type="button" class="pf-btn pf-btn--secondary" (click)="reset()"><pf-icon name="refresh" [size]="18" /> Start again</button>
        <button type="button" class="pf-btn pf-btn--icon" aria-label="Close the preview" (click)="closed.emit()"><pf-icon name="x" [size]="20" /></button>
      </header>
      <div class="pv-body pf-card__body">
        <div class="pv-frames">
          @if (device() !== 'phone') {
            <div class="pv-device pv-device--tablet">
              @if (device() === 'both') { <span class="pv-cap">Tablet</span> }
              <div class="pv-tablet" data-tablet>
                <ng-container *ngTemplateOutlet="screen" />
              </div>
            </div>
          }
          @if (device() !== 'tablet') {
            <div class="pv-device pv-device--phone">
              @if (device() === 'both') { <span class="pv-cap">Phone</span> }
              <div class="pv-tablet pv-phone" data-phone>
                <ng-container *ngTemplateOutlet="screen" />
              </div>
            </div>
          }
        </div>
        <aside class="pv-words" aria-labelledby="pv-w">
          <h3 class="pv-words__h" id="pv-w">What it writes from these answers</h3>
          @for (e of entries(); track e.kind === 'section' ? e.section.key : 'table:' + e.table.fieldKey) {
            @if (e.kind === 'section') {
              <p class="pv-words__t"><strong>{{ e.section.title }}</strong><br />{{ e.section.content }}</p>
              @for (t of e.section.tables ?? []; track t.fieldKey) {
                <fe-narrative-table [table]="t" [sectionTitle]="e.section.title" />
              }
            } @else {
              <fe-narrative-table [table]="e.table" />
            }
          } @empty {
            <p class="pv-words__t pv-muted">Answer something and the narrative appears here.</p>
          }
        </aside>
      </div>
    </section>

    <!-- one doctor's screen (the real filler), drawn in each frame; both frames share the answers -->
    <ng-template #screen>
      <div class="pv-screen">
        @if (wiz.page(); as wp) {
          <div class="pv-pagehead">
            <span class="pv-pagehead__t">{{ wp.title }}</span>
            <span class="pv-pagehead__n">{{ wiz.index() + 1 }} / {{ wiz.pages().length }}</span>
          </div>
          <div class="fe-grid pv-fields">
            @for (f of fields(); track f.key) {
              <fe-field [field]="f" [scope]="scope()" [lookup]="lookup()" [setValue]="setter" [lockedKeys]="locked()" />
            } @empty {
              <p class="fe-field__hint">Nothing to answer on this page yet.</p>
            }
          </div>
          <div class="pv-foot">
            <button type="button" class="pf-btn pf-btn--secondary" [disabled]="wiz.isFirst()" (click)="wiz.back()"><pf-icon name="chevron-left" [size]="18" /> Back</button>
            @if (wiz.next(); as n) {
              <button type="button" class="pf-btn pf-btn--primary" (click)="wiz.forward()">Next: {{ n.title }} <pf-icon name="chevron-right" [size]="18" /></button>
            } @else {
              <span class="pv-end">Last page</span>
            }
          </div>
        } @else {
          <p class="pv-empty">This case sheet has no pages yet.</p>
        }
      </div>
    </ng-template>
  `,
  styleUrl: './preview.component.scss',
})
export class PreviewComponent {
  readonly definition = input.required<FormDefinition>();
  readonly closed = output<void>();
  protected readonly wiz = inject(WizardController);
  private readonly api = inject(StudioApi);
  private readonly answers = signal<Answers>({});
  protected readonly words = signal<PreviewSection[]>([]);
  private readonly tables = signal<NarrativeTable[]>([]);
  protected readonly entries = computed(() => narrativeEntries(this.words(), this.tables()));
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly desk = deskSignal();
  protected readonly devices: SegmentedOption<Device>[] = [
    { value: 'both', label: 'Side by side' },
    { value: 'tablet', label: 'Tablet' },
    { value: 'phone', label: 'Phone' },
  ];
  /** A computer opens on both frames side by side; a tablet shows the tablet. */
  protected readonly device = signal<Device>(this.desk() && typeof innerWidth === 'number' && innerWidth >= 1280 ? 'both' : 'tablet');
  protected readonly heading = computed(() =>
    this.device() === 'both' ? 'Preview on a tablet and a phone' : this.device() === 'phone' ? 'Preview on a phone' : 'Preview on a tablet',
  );

  constructor() {
    effect(() => {
      const d = this.definition();
      untracked(() => this.wiz.start(d, {}, null));
    });
    effect(() => {
      const a = this.answers();
      untracked(() => this.write(a));
    });
  }

  protected readonly locked = computed(() => linkDisabledKeys(this.definition()));
  protected readonly scope = computed<Answers>(() => {
    const wp = this.wiz.page();
    return wp ? pageScope(wp, this.wiz.answers()) : {};
  });
  protected readonly lookup = computed(() => {
    const wp = this.wiz.page();
    return wp ? pageLookup(wp, this.wiz.answers()) : () => undefined;
  });
  protected readonly fields = computed<FieldDef[]>(() => {
    const wp = this.wiz.page();
    const get = this.lookup();
    return wp ? wp.page.fields.filter((f) => isShown(f.showWhen, get)) : [];
  });

  protected readonly setter = (key: string, value: unknown) => {
    const wp = this.wiz.page();
    if (!wp) return;
    const prev = this.wiz.answers();
    const next = applyChange(this.definition(), prev, setInScope(wp, prev, key, value));
    this.wiz.answers.set(next);
    this.answers.set(next);
  };

  protected reset(): void {
    this.wiz.start(this.definition(), {}, null);
    this.answers.set({});
  }

  private write(a: Answers): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (!Object.keys(a).length) {
        this.words.set([]);
        this.tables.set([]);
        return;
      }
      try {
        const p = await this.api.livePreview(this.definition(), a);
        this.words.set(p.sections);
        this.tables.set(p.tables ?? []);
      } catch {
        /* the words wait for the network */
      }
    }, 300);
  }
}
