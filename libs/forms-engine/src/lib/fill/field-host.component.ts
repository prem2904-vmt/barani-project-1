import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Type, computed, effect, inject, input, signal } from '@angular/core';
import { IconName, PfIconComponent } from '../kit';
import { optionChosen } from '../core/pages';
import { Lookup, isShown } from '../core/rules';
import { Answers, FieldDef, OptionDef } from '../core/types';
import { FE_KINDS, KindFill, feId, kindControl } from './contract';
import { followUpsInside } from './option-layout';

/**
 * One field on the page: its label, its control (from the kind registry)
 * and, under it, the follow-up questions of each chosen option, opened
 * inline in a quiet panel ("Nasal block — Side · For").
 */
@Component({
  selector: 'fe-field',
  standalone: true,
  imports: [NgComponentOutlet, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fe-field',
    '[class]': 'widthClass()',
    '[attr.data-field]': 'field().key',
    '[attr.data-kind]': 'field().kind',
    '[class.fe-field--missing]': 'missing()',
    '[class.fe-field--ynrow]': 'ynRow()',
  },
  template: `
    <!-- the question and its control; a Yes / No question is ONE card row (legacy yesno-na: question left, pills right) -->
    <div class="fe-field__row">
    <div class="fe-field__head">
      <span class="fe-field__lbl" [id]="labelId">{{ field().label }}</span>
      @if (field().required) {
        <span class="fe-field__req" aria-label="required" title="Required"></span>
      }
      @if (linked()) {
        <span class="fe-field__note">Filled from another answer</span>
      } @else if (fixed()) {
        <span class="fe-field__note">Filled in by the form</span>
      }
    </div>
    @if (control(); as c) {
      <ng-container
        [ngComponentOutlet]="c"
        [ngComponentOutletInputs]="{
          field: field(),
          value: value(),
          disabled: locked() || fixed(),
          set: setter,
          labelId: labelId,
          scope: scope(),
          lookup: lookup(),
          setKey: setValue(),
          lockedKeys: lockedKeys(),
          missingKeys: missingKeys(),
        }"
      />
    } @else if (spec()) {
      @if (loadFailed()) {
        <div class="fe-later" role="note" data-load-failed>
          <span class="fe-later__icon" aria-hidden="true"><pf-icon name="cloud-off" [size]="20" /></span>
          <span class="fe-later__txt">
            <span class="fe-later__title">This part could not be opened</span>
            <span class="fe-later__body">Check the connection; it opens by itself when Prepare is reachable again.</span>
          </span>
          <button type="button" class="pf-btn pf-btn--secondary" (click)="retry()">Try again</button>
        </div>
      } @else {
        <div class="fe-loading" role="status" aria-label="Opening this part"></div>
      }
    } @else {
      <div class="fe-later" role="note" [attr.data-later]="later().kind">
        <span class="fe-later__icon" aria-hidden="true"><pf-icon [name]="later().icon" [size]="20" /></span>
        <span class="fe-later__txt">
          <span class="fe-later__title">{{ later().title }}</span>
          <span class="fe-later__body">This part is skipped for now and won't print. Everything else on this page works as usual.</span>
        </span>
      </div>
    }
    </div>
    @if (field().helper) {
      <p class="fe-field__hint">{{ field().helper }}</p>
    }
    @if (missing()) {
      <p class="fe-field__err" role="alert">Please answer this one.</p>
    }
    @for (o of openOptions(); track o.key) {
      <div class="fe-follow" role="group" [attr.data-follow]="o.key" [attr.aria-label]="o.label + ': follow-up'">
        <span class="fe-follow__title">{{ o.label }}</span>
        <div class="fe-grid">
          @for (sub of shownSubs(o); track sub.key) {
            <fe-field
              [field]="sub"
              [scope]="scope()"
              [lookup]="lookup()"
              [setValue]="setValue()"
              [lockedKeys]="lockedKeys()"
              [missingKeys]="missingKeys()"
            />
          }
        </div>
      </div>
    }
  `,
})
export class FieldHostComponent {
  private readonly kinds = inject(FE_KINDS);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly field = input.required<FieldDef>();
  /** The answers this field reads and writes (the sheet, a repeated page, or a repeat row). */
  readonly scope = input.required<Answers>();
  readonly lookup = input.required<Lookup>();
  readonly setValue = input.required<(key: string, value: unknown) => void>();
  readonly lockedKeys = input<ReadonlySet<string>>(new Set());
  readonly missingKeys = input<ReadonlySet<string>>(new Set());

  protected readonly labelId = feId('fe-lbl');
  protected readonly spec = computed(() => this.kinds[this.field().kind] ?? null);
  /** A heavy kind's control arrives a moment later (loaded on first use); the plain kinds are there straight away. */
  private readonly loadedControl = signal<{ spec: unknown; c: Type<KindFill> } | null>(null);
  protected readonly loadFailed = signal(false);
  private readonly attempt = signal(0);
  protected readonly control = computed<Type<KindFill> | null>(() => {
    const s = this.spec();
    if (!s) return null;
    if (s.component) return s.component;
    const l = this.loadedControl();
    return l && l.spec === s ? l.c : null;
  });
  protected readonly value = computed(() => this.scope()[this.field().key] ?? null);
  protected readonly linked = computed(() => this.lockedKeys().has(this.field().key));
  protected readonly locked = this.linked;
  /** The form locks this field (legacy `disabled`): shown, not changeable. */
  protected readonly fixed = computed(() => this.field().config?.['disabled'] === true);
  /** A kind that comes with a later phase (images, drawings, grids): a calm note in plain words, never an error. */
  protected readonly later = computed(() => laterKind(this.field()));
  protected readonly missing = computed(() => this.missingKeys().has(this.field().key));
  /** Legacy yesno-na: the Yes / No buttons sit on the question's own card row (not for a switch or a tick box). */
  protected readonly ynRow = computed(() => {
    const f = this.field();
    const d = f.config?.['display'];
    return f.kind === 'yesno' && d !== 'switch' && d !== 'check' && !!this.spec();
  });
  protected readonly widthClass = computed(() => `fe-field fe-w-${this.field().width ?? 'full'}`);

  protected readonly setter = (v: unknown) => this.setValue()(this.field().key, v);

  protected readonly openOptions = computed<OptionDef[]>(() => {
    // legacy cards open their follow-ups inside the chosen card (the kind draws them)
    if (followUpsInside(this.field())) return [];
    const v = this.value();
    return (this.field().options ?? []).filter((o) => (o.subFields?.length ?? 0) > 0 && optionChosen(v, o.key));
  });

  private seenOpen: Set<string> | null = null;

  constructor() {
    effect(() => {
      const s = this.spec();
      this.attempt();
      if (!s || s.component) return;
      const c = kindControl(s);
      if (!(c instanceof Promise)) {
        this.loadedControl.set({ spec: s, c });
        return;
      }
      this.loadFailed.set(false);
      c.then(
        (cls) => this.loadedControl.set({ spec: s, c: cls }),
        () => this.loadFailed.set(true),
      );
    });
    // A newly chosen option opens its follow-up questions: bring them into view and put the cursor in the
    // first text box (legacy multiselect-expand focused the first sub-field after 150 ms). Never on load.
    effect(() => {
      const keys = this.openOptions().map((o) => o.key);
      const before = this.seenOpen;
      this.seenOpen = new Set(keys);
      if (!before) return;
      const fresh = keys.find((k) => !before.has(k));
      if (!fresh) return;
      setTimeout(() => {
        const panel = this.host.nativeElement.querySelector<HTMLElement>(`[data-follow="${cssEscape(fresh)}"]`);
        if (!panel) return;
        panel.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        panel.querySelector<HTMLElement>('input.fe-text__input, textarea.fe-text__input')?.focus({ preventScroll: true });
      }, 150);
    });
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected shownSubs(o: OptionDef): FieldDef[] {
    const get = this.lookup();
    return (o.subFields ?? []).filter((s) => isShown(s.showWhen, get));
  }
}

/** The plain-words note for a kind Prepare does not fill yet (prepare-parity.md section L). */
export function laterKind(f: FieldDef): { kind: string; icon: IconName; title: string } {
  const legacy = String(f.config?.['legacyType'] ?? f.kind).toLowerCase();
  const what = (title: string, icon: IconName) => ({ kind: legacy, icon, title: `${title} come to Prepare soon` });
  if (legacy === 'scribblepad') return what('Drawings', 'pen');
  if (legacy === 'imageinfo') return what('Marked pictures', 'image');
  if (legacy === 'imagegallery') return what('Photos', 'image');
  if (legacy === 'eom' || legacy === 'eyefields') return what('Eye diagrams', 'eye');
  // tables are filled since Phase 5; a form brought in before that still holds the old field
  if (legacy === 'multitextbox') return { kind: legacy, icon: 'k-grid', title: 'Bring this form in again to fill this table' };
  return what('Answers of this type', 'info');
}

function cssEscape(v: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');
}
