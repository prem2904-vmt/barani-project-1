import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PharmacyApi, type PharmacyDrugRow } from './pharmacy.api';
import { needsPrescription, scheduleLabel, unitWords } from './pharmacy-math';

/**
 * Add-a-drug search (generic or brand) over the tenant's EFFECTIVE drug
 * catalogue with this branch's sellable stock. One result per row (ND §6),
 * ↑/↓ + Enter, Esc closes. Emits the picked drug and clears.
 */
@Component({
  selector: 'pf-pharmacy-drug-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <div class="ph-add">
      <label class="ph-add__box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ph-muted"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <span class="sr-only">{{ placeholder() }}</span>
        <input #box type="text" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list"
               [attr.aria-expanded]="open()" [attr.aria-controls]="listId" [placeholder]="placeholder()"
               [value]="q()" (input)="onInput($any($event.target).value)" (focus)="open.set(q().length > 0)"
               (blur)="close()" (keydown.arrowDown)="move($event, 1)" (keydown.arrowUp)="move($event, -1)"
               (keydown.enter)="enter($event)" (keydown.escape)="open.set(false)" />
      </label>
      @if (open()) {
        <div class="ph-add__list pf-anim-in" [class.ph-add__list--down]="down()" role="listbox" [id]="listId" aria-label="Drugs">
          @for (d of results(); track d.id; let i = $index) {
            <button type="button" class="ph-add__opt" role="option" [attr.aria-selected]="i === hi()"
                    (mouseenter)="hi.set(i)" (mousedown)="$event.preventDefault()" (click)="pick(d)">
              <span class="ph-row__main">
                <span class="ph-row__name">{{ d.name }} <span class="ph-sch" [attr.data-rx]="rx(d)">{{ sch(d) }}</span></span>
                <span class="ph-row__meta">{{ d.generic || '—' }}{{ d.strength ? ' · ' + d.strength : '' }}</span>
              </span>
              <span class="ph-row__end">
                <span class="pf-num" [class.ph-muted]="!(d.onHand ?? 0)">{{ (d.onHand ?? 0) ? stock(d) : 'No stock' }}</span>
              </span>
            </button>
          } @empty {
            <p class="ph-sub" style="margin:0;padding:10px">{{ busy() ? 'Searching…' : 'No drug matches “' + q() + '”.' }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`:host { height: auto; } .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }`],
})
export class PharmacyDrugPickerComponent {
  private readonly api = inject(PharmacyApi);
  readonly placeholder = input('Add a drug — generic or brand');
  /** Open the list below the field (default: above, for a footer field). */
  readonly down = input(false);
  readonly picked = output<PharmacyDrugRow>();

  protected readonly q = signal('');
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly results = signal<PharmacyDrugRow[]>([]);
  protected readonly hi = signal(0);
  protected readonly listId = 'ph-drugs-' + Math.random().toString(36).slice(2, 8);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  private readonly term$ = new Subject<string>();

  constructor() {
    this.term$.pipe(
      debounceTime(180), distinctUntilChanged(),
      switchMap(t => {
        if (t.trim().length < 1) return of([] as PharmacyDrugRow[]);
        this.busy.set(true);
        return this.api.searchDrugs(t.trim(), 20).pipe(catchError(() => of([] as PharmacyDrugRow[])));
      }),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe(r => { this.busy.set(false); this.results.set(r); this.hi.set(0); });
  }

  protected rx(d: PharmacyDrugRow) { return needsPrescription(d.schedule); }
  protected sch(d: PharmacyDrugRow) { return scheduleLabel(d.schedule); }
  protected stock(d: PharmacyDrugRow) { return unitWords(d.onHand ?? 0, d.unit, d.form) + ' in stock'; }

  protected onInput(v: string) { this.q.set(v); this.open.set(v.length > 0); this.term$.next(v); }
  protected close() { setTimeout(() => this.open.set(false), 120); }
  protected move(e: Event, d: number) {
    e.preventDefault();
    const n = this.results().length;
    if (!n) return;
    this.open.set(true);
    this.hi.set((this.hi() + d + n) % n);
  }
  protected enter(e: Event) {
    e.preventDefault();
    const d = this.results()[this.hi()];
    if (d) this.pick(d);
  }
  pick(d: PharmacyDrugRow) {
    this.picked.emit(d);
    this.q.set('');
    this.results.set([]);
    this.open.set(false);
    this.term$.next('');
    this.box()?.nativeElement.focus();
  }
}
