import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { User, userDisplayName } from '../../../shared/models/user.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

// Lightweight supervisor delegation picker. Lists active users in the
// tenant; on pick, fires (chose) with the target user id. The caller
// wires the API call (so this component stays agnostic about the
// OrderTest it's delegating).

@Component({
  selector: 'pf-delegate-modal',
  standalone: true,
  imports: [AvatarComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-dl" role="dialog" aria-modal="true" aria-label="Delegate test">
      <div class="pf-dl__backdrop" (click)="cancelled.emit()"></div>
      <div class="pf-dl__card" (click)="$event.stopPropagation()">
        <header class="pf-dl__head">
          <div>
            <span class="pf-dl__eyebrow">Supervisor · Delegate</span>
            <h2 class="pf-dl__title">Delegate "{{ testName }}"</h2>
            <p class="pf-dl__sub">Pick the tech who'll take over. They must scan the vial before entering results.</p>
          </div>
          <button type="button" class="pf-dl__close press" (click)="cancelled.emit()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </header>

        <div class="pf-dl__search">
          <input #q type="text" class="pf-dl__input"
                 placeholder="Search by name or email…"
                 (input)="setQuery(q.value)" />
        </div>

        <ul class="pf-dl__list" role="listbox">
          @for (u of filtered(); track u.id) {
            <li>
              <button type="button" class="pf-dl__item press" (click)="chose.emit(u.id)">
                <pf-avatar [name]="u.displayName" [size]="36"></pf-avatar>
                <div class="min-w-0 flex-1 text-left">
                  <p class="pf-dl__name">{{ u.displayName }}</p>
                  <p class="pf-dl__meta">{{ u.email }}</p>
                </div>
              </button>
            </li>
          } @empty {
            <li class="pf-dl__empty">
              @if (loading()) {
                <div class="flex justify-center py-2">
                  <pf-loading-logo size="sm" color="purple"
                                   [showText]="true" text="Loading…"></pf-loading-logo>
                </div>
              }
              @else { No matching user. }
            </li>
          }
        </ul>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-dl { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 80; }
    .pf-dl__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); }
    .pf-dl__card {
      position: relative;
      width: 100%; max-width: 440px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 18px;
      box-shadow: 0 30px 90px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    .pf-dl__head { position: relative; padding: 18px 20px 14px; }
    .pf-dl__eyebrow {
      font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted);
    }
    .pf-dl__title { margin: 4px 0 0; font-size: 17px; font-weight: 600; color: var(--text-primary); }
    .pf-dl__sub { margin: 4px 0 0; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-dl__close {
      position: absolute; top: 12px; right: 12px; width: 30px; height: 30px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9999px; background: transparent; border: none; cursor: pointer;
      color: var(--text-muted);
    }
    .pf-dl__close:hover { background: var(--bg-hover); color: var(--text-primary); }

    .pf-dl__search { padding: 0 16px 10px; }
    .pf-dl__input {
      width: 100%; padding: 10px 12px; border-radius: 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary); font-size: 13.5px;
    }
    .pf-dl__input:focus {
      outline: none; border-color: rgba(168, 85, 247, 0.6);
      box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.15);
    }

    .pf-dl__list {
      list-style: none; margin: 0; padding: 6px; max-height: 320px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 2px;
      border-top: 1px solid var(--glass-border);
    }
    .pf-dl__item {
      display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 8px 10px; border-radius: 10px;
      background: transparent; border: none; cursor: pointer; text-align: left;
    }
    .pf-dl__item:hover { background: var(--bg-hover); }
    .pf-dl__name { margin: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-dl__meta { margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-dl__empty {
      padding: 16px; text-align: center; font-size: 12.5px; color: var(--text-muted);
    }

    /* ── Cross-platform overrides (additive; desktop >=1024px untouched) ── */

    /* Phone: stop iOS focus-zoom on the search input (needs >=16px) and
       give the dialog a little vertical room with its scrollable list,
       sized to dvh rather than letting the card outgrow the screen. */
    @media (max-width: 640px) {
      .pf-dl__input { font-size: 16px; }
      .pf-dl__card { max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
      .pf-dl__list { max-height: none; flex: 1 1 auto; min-height: 0; }
    }

    /* Touch: bump the small close button to a comfortable tap target. */
    @media (pointer: coarse) {
      .pf-dl__close { width: 44px; height: 44px; }
    }

    /* Touch: neutralise sticky hover after tap. */
    @media (hover: none) {
      .pf-dl__close:hover { background: transparent; color: var(--text-muted); }
      .pf-dl__item:hover { background: transparent; }
    }

    /* Capacitor native: the dialog is full-bleed fixed; keep its padded
       bounds clear of the notch / home indicator so the card and its
       list never sit under the status bar or bottom inset. */
    :host-context(html.cap-native) .pf-dl {
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
    }
  `]
})
export class DelegateModalComponent implements OnInit {
  @Input() testName = 'Test';
  @Output() chose = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly api = inject(ApiService);
  private readonly _users = signal<User[]>([]);
  private readonly _query = signal('');
  readonly loading = signal(true);

  readonly filtered = () => {
    const q = this._query().trim().toLowerCase();
    const list = this._users().filter(u => u.isActive);
    if (!q) return list;
    return list.filter(u => userDisplayName(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  };

  ngOnInit() {
    this.api.get<User[]>('/api/users/').subscribe({
      next: l => { this._users.set(l ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  setQuery(v: string) { this._query.set(v); }
}
