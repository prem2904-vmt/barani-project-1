import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { PadOption, entryAction, padSuggest } from './pad';

/**
 * A pad row's entry field (consult v11): an always-visible dashed 42px field
 * — the same look as the Rx entry — with word-start suggestions in a dropdown
 * under it (↑ ↓ move, Enter adds the highlighted one, Esc clears) and a few
 * one-tap chips beneath. Free text is added with Enter where the row allows
 * it (diagnosis, advice). The host owns the options and what "add" means.
 */
@Component({
  selector: 'pf-pad-add',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pa">
      <label class="pa__in">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input #inp type="text" [value]="q()" (input)="onInput(inp.value)" (keydown)="onKey($event)" (blur)="blurSoon()" (focus)="focused.set(true)"
               [placeholder]="placeholder()" [attr.aria-label]="placeholder()" role="combobox" [attr.aria-expanded]="open()" autocomplete="off" spellcheck="false" />
      </label>
      @if (open()) {
        <div class="pa__sug" role="listbox" [attr.aria-label]="placeholder()">
          @for (o of hits(); track o.id; let i = $index) {
            <button type="button" role="option" class="pa__sg" [class.act]="i === active()" [attr.aria-selected]="i === active()"
                    (mousedown)="$event.preventDefault()" (mouseenter)="active.set(i)" (click)="choose(o)">
              <b>{{ o.label }}</b>@if (o.meta) { <span class="pf-num">{{ o.meta }}</span> }
            </button>
          }
          @if (allowFree() && q().trim() && !exact()) {
            <button type="button" role="option" class="pa__sg" [class.act]="active() === hits().length" (mousedown)="$event.preventDefault()" (click)="addFree()">
              <b>Add “{{ q().trim() }}” as written</b>
            </button>
          }
        </div>
      }
      @if (quick().length) {
        <div class="pa__quick" role="group" [attr.aria-label]="quickLabel()">
          @for (o of quick(); track o.id) {
            <button type="button" class="pa__chip" (click)="choose(o)">+ {{ o.label }}@if (o.meta) { <small class="pf-num">{{ o.meta }}</small> }</button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pa { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .pa__in { flex: 1 1 320px; min-width: 0; display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 12px; border-radius: 10px; color: var(--text-tertiary);
      border: 1px dashed color-mix(in srgb, var(--color-primary, #7c3aed) 45%, var(--pf-line)); background: var(--pf-in-tint); }
    .pa__in:focus-within { border-style: solid; border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); }
    .pa__in input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; font: inherit; font-size: 14px; color: var(--text-primary); }
    .pa__in input::placeholder { color: var(--text-tertiary); }
    .pa__sug { position: absolute; left: 0; right: 0; top: 48px; z-index: 25; display: grid; padding: 8px; max-height: 320px; overflow-y: auto;
      border-radius: 12px; background: var(--pf-card-bg); border: 1px solid var(--pf-line); box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18); }
    :host-context(html.dark) .pa__sug { box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5); }
    .pa__sg { display: flex; align-items: baseline; gap: 12px; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 8px; background: none;
      color: var(--text-primary); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .pa__sg b { font-weight: 600; }
    .pa__sg span { font-size: 12.5px; color: var(--violet-text, #6d28d9); }
    .pa__sg.act, .pa__sg:hover { background: var(--pf-chip-bg); }
    /* The one-tap chips sit on the field's line when they fit, else wrap below. */
    .pa__quick { flex: 0 1 auto; display: flex; flex-wrap: wrap; gap: 8px; }
    .pa__chip { display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--pf-line); background: none;
      font: inherit; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
    .pa__chip small { font-size: 11.5px; color: var(--text-tertiary); }
    .pa__chip:hover { border-color: var(--color-violet-600, #7c3aed); color: var(--text-primary); }
    .pa__chip:focus-visible, .pa__sg:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    @media (max-width: 760px) { .pa__in input { font-size: 16px; } }
  `],
})
export class PadAddComponent {
  readonly placeholder = input('Add…');
  readonly options = input<PadOption[]>([]);
  /** Ids already on the row (never suggested again). */
  readonly exclude = input<string[]>([]);
  readonly quick = input<PadOption[]>([]);
  readonly quickLabel = input('Suggestions');
  readonly allowFree = input(false);
  readonly pick = output<PadOption>();
  readonly free = output<string>();
  /** The text as typed (the host may search the server with it). */
  readonly query = output<string>();

  readonly q = signal('');
  readonly active = signal(0);
  readonly focused = signal(false);
  private readonly inp = viewChild<ElementRef<HTMLInputElement>>('inp');

  readonly hits = computed(() => padSuggest(this.options(), this.q(), new Set(this.exclude())));
  readonly exact = computed(() => this.hits().some(o => o.label.toLowerCase() === this.q().trim().toLowerCase()));
  readonly open = computed(() => this.focused() && !!this.q().trim() && (this.hits().length > 0 || this.allowFree()));

  focus() { this.inp()?.nativeElement.focus(); }
  onInput(v: string) { this.q.set(v); this.active.set(0); this.query.emit(v); }
  blurSoon() { setTimeout(() => this.focused.set(false), 120); }
  onKey(e: KeyboardEvent) {
    const n = this.hits().length + (this.allowFree() && this.q().trim() && !this.exact() ? 1 : 0);
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); this.active.set((this.active() + 1) % n); return; }
    if (e.key === 'ArrowUp' && n) { e.preventDefault(); this.active.set((this.active() - 1 + n) % n); return; }
    if (e.key === 'Escape') { this.q.set(''); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const o = this.hits()[this.active()];
    const act = entryAction('Enter', { hasPick: !!o, parsed: false, text: this.q(), allowFree: this.allowFree(), composer: false });
    if (act === 'add' && o) this.choose(o); else if (act === 'free') this.addFree();
  }
  choose(o: PadOption) { this.pick.emit(o); this.reset(); }
  addFree() { const t = this.q().trim(); if (t) { this.free.emit(t); this.reset(); } }
  private reset() { this.q.set(''); this.active.set(0); this.query.emit(''); queueMicrotask(() => this.focus()); }
}
