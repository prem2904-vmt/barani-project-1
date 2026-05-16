import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { Patient, patientDisplayName } from '../../models/patient.model';
import { AvatarComponent } from '../../primitives/avatar.component';
import { LoadingLogoComponent } from '../loading-logo/loading-logo.component';

type SearchState = 'idle' | 'hint' | 'loading' | 'empty' | 'results';

@Component({
  selector: 'pf-patient-search',
  standalone: true,
  imports: [AvatarComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <!-- Pulsing halo behind the field — draws the eye on the Frontdesk
           landing so the patient search is the unambiguous next action.
           Pauses the animation while the field is focused so it doesn't
           distract the user mid-type. -->
      <span class="pulse" aria-hidden="true" [class.pulse--paused]="_focused()"></span>
      <div class="field" [class.field-focused]="_focused()">
        <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <path d="m20 20-3.5-3.5"/>
        </svg>
        <input type="text"
               [placeholder]="placeholder"
               [value]="query()"
               (input)="onInput($event)"
               (focus)="onFocus()"
               (blur)="onBlur()"
               (keydown.escape)="close()"
               (keydown.arrowdown)="nudge($event, 1)"
               (keydown.arrowup)="nudge($event, -1)"
               (keydown.enter)="pickHighlighted($event)" />
        @if (query().length > 0) {
          <button type="button" class="field-clear" aria-label="Clear" (mousedown)="clear(); $event.preventDefault()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/>
              <path d="m6 6 12 12"/>
            </svg>
          </button>
        }
        @if (state() === 'loading') {
          <span class="field-spinner">
            <pf-loading-logo size="micro" color="purple" [inline]="true"></pf-loading-logo>
          </span>
        }
        <!-- Trailing-action slot. Projected actions sit at the right edge of
             the field, after the clear/spinner. Frontdesk uses this for the
             Advanced-search trigger so it lives inside the search bar. -->
        <span class="field-trail">
          <ng-content select="[trailing]"></ng-content>
        </span>
      </div>

      @if (open()) {
        <div class="panel" role="listbox">
          <span class="panel-accent" aria-hidden="true"></span>

          @switch (state()) {
            @case ('hint') {
              <div class="panel-state">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 16v-4"/><path d="M12 8h.01"/><circle cx="12" cy="12" r="10"/>
                </svg>
                <span>Type at least <strong>2 characters</strong> to search</span>
              </div>
            }
            @case ('loading') {
              <div class="panel-state">
                <pf-loading-logo size="xs" color="purple" [inline]="true"></pf-loading-logo>
                <span>Searching for "<strong>{{ query() }}</strong>"…</span>
              </div>
            }
            @case ('empty') {
              <div class="panel-state">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
                </svg>
                <span>No patient matches "<strong>{{ query() }}</strong>"</span>
              </div>
            }
            @case ('results') {
              <ul>
                @for (p of results(); track p.id; let i = $index) {
                  <li>
                    <button type="button"
                            class="row"
                            [class.row-active]="i === _highlight()"
                            (mouseenter)="_highlight.set(i)"
                            (mousedown)="pick(p); $event.preventDefault()">
                      <pf-avatar [name]="name(p)" [size]="36"></pf-avatar>
                      <div class="row-text">
                        <p class="row-name">{{ name(p) }}</p>
                        <p class="row-meta">
                          @if (p.phone) { {{ p.phone }} · }
                          {{ p.sex ?? '—' }} · {{ p.age ?? '—' }}y
                        </p>
                      </div>
                      @if (i === _highlight()) {
                        <svg class="row-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                        </svg>
                      }
                    </button>
                  </li>
                }
              </ul>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .wrap { position: relative; width: 100%; }

    /* ── Pulsing halo behind the field ──────────────────────── */
    .pulse {
      position: absolute;
      inset: -6px;
      border-radius: 22px;
      pointer-events: none;
      background: linear-gradient(135deg,
        rgba(124, 58, 237, 0.55),
        rgba(236, 72, 153, 0.55));
      opacity: 0;
      filter: blur(14px);
      animation: pf-ps-pulse 2.4s ease-in-out infinite;
      z-index: 0;
    }
    .pulse--paused { animation: none; opacity: 0; }

    @keyframes pf-ps-pulse {
      0%, 100% { opacity: 0.18; transform: scale(1); }
      50%      { opacity: 0.45; transform: scale(1.03); }
    }
    @media (prefers-reduced-motion: reduce) {
      .pulse { animation: none; opacity: 0.2; }
    }

    /* ── Field ──────────────────────────────────────────────── */
    .field {
      position: relative;
      display: flex;
      align-items: center;
      height: 60px;
      padding: 0 56px 0 56px;
      background: var(--glass-bg);
      border: 1.5px solid var(--glass-border);
      border-radius: 18px;
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      z-index: 1;
    }
    .field:hover { border-color: var(--glass-border-hover); }
    .field.field-focused {
      border-color: rgba(168, 85, 247, 0.7);
      background: var(--glass-bg-hover);
      box-shadow: 0 0 0 6px rgba(124, 58, 237, 0.18);
    }
    .field input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text-primary);
      font-size: 16px;
      font-weight: 500;
      letter-spacing: 0.01em;
    }
    .field input::placeholder { color: var(--text-muted); font-weight: 400; }
    .field-icon {
      position: absolute;
      left: 20px;
      width: 22px;
      height: 22px;
      color: var(--text-muted);
      pointer-events: none;
      transition: color 0.15s ease, transform 0.2s ease;
    }
    .field.field-focused .field-icon {
      color: #a855f7;
      transform: scale(1.05);
    }

    .field-clear {
      position: absolute;
      right: 52px;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      background: transparent;
      color: var(--text-muted);
      border: 0;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .field-clear:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    /* When no trailing slot is in use, the clear button reverts to the
       original right-edge slot (no trailing icon to dodge). */
    .field:not(:has(.field-trail > *)) .field-clear { right: 16px; }

    .field-spinner, .panel-spinner {
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      border: 2px solid rgba(168, 85, 247, 0.3);
      border-top-color: rgba(168, 85, 247, 0.9);
      animation: pf-ps-spin 0.8s linear infinite;
      display: inline-block;
    }
    .field-spinner { position: absolute; right: 56px; }
    .field:not(:has(.field-trail > *)) .field-spinner { right: 20px; }

    /* Trailing slot — pinned to the right edge of the field, sits above the
       background. Children render naturally; consumers style their own
       buttons. Empty when no content is projected (no width / no border). */
    .field-trail {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .field-trail:empty { display: none; }

    @keyframes pf-ps-spin { to { transform: rotate(360deg); } }

    /* ── Panel ──────────────────────────────────────────────── */
    .panel {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 12px);
      z-index: 50;
      max-height: 22rem;
      overflow-y: auto;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      animation: pf-ps-in 0.18s ease-out both;
    }
    .panel-accent {
      position: absolute;
      top: 0;
      left: 12%;
      right: 12%;
      height: 1px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(168, 85, 247, 0.7) 50%,
        transparent 100%);
      pointer-events: none;
    }

    .panel-state {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      color: var(--text-secondary);
      font-size: 13px;
    }
    .panel-state svg { color: var(--text-muted); flex-shrink: 0; }
    .panel-state strong { color: var(--text-primary); font-weight: 600; }

    ul {
      list-style: none;
      margin: 0;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 8px 10px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s ease;
    }
    .row:hover, .row.row-active {
      background: linear-gradient(90deg, rgba(124, 58, 237, 0.14), rgba(124, 58, 237, 0.04));
    }
    .row-text { flex: 1; min-width: 0; }
    .row-name {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-meta {
      margin: 2px 0 0;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }
    .row-arrow { color: #c4b5fd; flex-shrink: 0; }

    .panel::-webkit-scrollbar { width: 6px; }
    .panel::-webkit-scrollbar-track { background: transparent; }
    .panel::-webkit-scrollbar-thumb { background: var(--glass-border); border-radius: 9999px; }

    @keyframes pf-ps-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { animation: none; }
      .field-spinner, .panel-spinner { animation: none; }
    }
  `]
})
export class PatientSearchComponent {
  private readonly api = inject(ApiService);
  protected readonly name = patientDisplayName;

  @Input() placeholder = 'Search patient by name, MRN, phone, or ABHA';
  @Output() picked = new EventEmitter<Patient>();

  protected readonly query = signal('');
  protected readonly _focused = signal(false);
  protected readonly _highlight = signal<number>(-1);

  private readonly _results = signal<Patient[]>([]);
  private readonly _loading = signal(false);
  readonly results = this._results.asReadonly();

  /** Compose the current search state for the dropdown body. */
  readonly state = computed<SearchState>(() => {
    const q = this.query().trim();
    if (q.length === 0) return 'idle';
    if (q.length < 2) return 'hint';
    if (this._loading()) return 'loading';
    if (this._results().length === 0) return 'empty';
    return 'results';
  });

  readonly open = computed(() => this.state() !== 'idle');

  private _timer?: ReturnType<typeof setTimeout>;
  private _blurTimer?: ReturnType<typeof setTimeout>;

  onFocus() {
    if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = undefined; }
    this._focused.set(true);
  }

  onBlur() {
    this._blurTimer = setTimeout(() => this._focused.set(false), 180);
  }

  onInput(ev: Event) {
    const value = (ev.target as HTMLInputElement).value;
    this.query.set(value);
    clearTimeout(this._timer);
    const q = value.trim();
    if (q.length < 2) {
      this._results.set([]);
      this._loading.set(false);
      this._highlight.set(-1);
      return;
    }
    this._loading.set(true);
    this._timer = setTimeout(() => this.search(q), 220);
  }

  private search(q: string) {
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(q)}&limit=10`)
      .subscribe({
        next: list => {
          this._results.set(list ?? []);
          this._loading.set(false);
          this._highlight.set(list && list.length > 0 ? 0 : -1);
        },
        error: () => {
          this._results.set([]);
          this._loading.set(false);
        }
      });
  }

  clear() {
    this.query.set('');
    this._results.set([]);
    this._loading.set(false);
    this._highlight.set(-1);
  }

  close() {
    this.query.set('');
    this._results.set([]);
    this._focused.set(false);
  }

  pick(p: Patient) {
    this.query.set(patientDisplayName(p));
    this._results.set([]);
    this._focused.set(false);
    this.picked.emit(p);
  }

  pickHighlighted(ev: Event) {
    const list = this._results();
    const i = this._highlight();
    if (i >= 0 && i < list.length) {
      ev.preventDefault();
      this.pick(list[i]);
    }
  }

  nudge(ev: Event, delta: number) {
    const n = this._results().length;
    if (!n) return;
    ev.preventDefault();
    const i = this._highlight();
    const next = i < 0 ? (delta === 1 ? 0 : n - 1) : (i + delta + n) % n;
    this._highlight.set(next);
  }
}
