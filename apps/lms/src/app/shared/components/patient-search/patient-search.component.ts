import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { Patient } from '../../models/patient.model';
import { AvatarComponent } from '../../primitives/avatar.component';

@Component({
  selector: 'pf-patient-search',
  standalone: true,
  imports: [FormsModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">
      <div class="pf-search-field">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
             class="pf-search-icon" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <path d="m20 20-3.5-3.5"/>
        </svg>
        <input type="text" class="pf-search-input" [placeholder]="placeholder"
               [(ngModel)]="query"
               (input)="onInput()"
               (focus)="_showResults.set(true)"
               (blur)="hideSoon()" />
      </div>

      @if (_showResults() && results().length > 0) {
        <div class="pf-search-dropdown">
          <span class="pf-search-accent" aria-hidden="true"></span>
          <ul>
            @for (p of results(); track p.id) {
              <li>
                <button type="button" class="pf-search-row"
                        (mousedown)="pick(p); $event.preventDefault()">
                  <pf-avatar [name]="p.name" [size]="36"></pf-avatar>
                  <div class="flex-1 min-w-0">
                    <p class="text-[14px] font-semibold truncate"
                       style="color: var(--text-primary);">{{ p.name }}</p>
                    <p class="text-[11.5px] font-mono truncate mt-0.5"
                       style="color: var(--text-tertiary);">
                      @if (p.phone) { {{ p.phone }} · } {{ p.sex }} · {{ p.age }}y
                    </p>
                  </div>
                </button>
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .pf-search-field {
      position: relative;
      display: flex;
      align-items: center;
    }
    .pf-search-icon {
      position: absolute;
      left: 14px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .pf-search-input {
      width: 100%;
      height: 44px;
      padding: 0 14px 0 40px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 14px;
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    }
    .pf-search-input::placeholder { color: var(--text-muted); }
    .pf-search-input:focus {
      outline: none;
      border-color: rgba(168, 85, 247, 0.5);
      background: var(--glass-bg-hover);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.15);
    }

    .pf-search-dropdown {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      margin-top: 8px;
      z-index: 30;
      max-height: 22rem;
      overflow-y: auto;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      overflow-x: hidden;
      animation: pf-ps-in 0.2s ease-out both;
    }

    .pf-search-accent {
      position: absolute;
      top: 0;
      left: 12%;
      right: 12%;
      height: 1px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(168, 85, 247, 0.7) 50%,
        transparent 100%);
    }

    ul { list-style: none; margin: 0; padding: 6px; display: flex; flex-direction: column; gap: 2px; }

    .pf-search-row {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 8px 10px;
      border-radius: 10px;
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s ease;
    }
    .pf-search-row:hover {
      background: linear-gradient(90deg, rgba(124, 58, 237, 0.12), rgba(124, 58, 237, 0.04));
    }

    .pf-search-dropdown::-webkit-scrollbar { width: 6px; }
    .pf-search-dropdown::-webkit-scrollbar-track { background: transparent; }
    .pf-search-dropdown::-webkit-scrollbar-thumb {
      background: var(--glass-border);
      border-radius: 9999px;
    }

    @keyframes pf-ps-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `]
})
export class PatientSearchComponent {
  private readonly api = inject(ApiService);
  @Input() placeholder = 'Search patient by name / phone / ABHA';
  @Output() picked = new EventEmitter<Patient>();

  protected query = '';
  private readonly _results = signal<Patient[]>([]);
  protected readonly _showResults = signal(false);
  readonly results = this._results.asReadonly();
  private _timer?: ReturnType<typeof setTimeout>;

  onInput() {
    clearTimeout(this._timer);
    const q = this.query.trim();
    if (q.length < 2) {
      this._results.set([]);
      return;
    }
    this._timer = setTimeout(() => this.search(q), 200);
  }

  private search(q: string) {
    this.api.get<Patient[]>(`/api/patients/?q=${encodeURIComponent(q)}&limit=10`)
      .subscribe({
        next: list => {
          this._results.set(list ?? []);
          this._showResults.set(true);
        },
        error: () => this._results.set([])
      });
  }

  pick(p: Patient) {
    this.query = p.name;
    this._showResults.set(false);
    this.picked.emit(p);
  }

  hideSoon() {
    setTimeout(() => this._showResults.set(false), 150);
  }
}
