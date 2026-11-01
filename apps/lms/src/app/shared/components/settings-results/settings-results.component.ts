import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsEntry } from '../../utils/settings-catalog';

/**
 * Settings search results — ONE row per hit (PF-PATTERN §6: ranked top to
 * bottom), each with where it lives. The first row is the one Enter opens, so
 * it is marked. Used by /admin and /admin/manage.
 */
@Component({
  selector: 'pf-settings-results',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="pf-sr__count pf-num" role="status">
      {{ hits().length }} {{ hits().length === 1 ? 'match' : 'matches' }} for “{{ query() }}”
    </p>
    @if (hits().length) {
      <ul class="pf-sr" aria-label="Settings search results">
        @for (h of hits(); track h.title + h.href; let first = $first) {
          <li>
            <a [routerLink]="h.href" [queryParams]="h.queryParams ?? null"
               class="pf-row pf-sr__row press" [class.pf-sr__row--top]="first"
               [attr.data-testid]="'settings-hit'">
              <span class="pf-card__icon pf-sr__ic">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="h.icon"/></svg>
              </span>
              <span class="pf-sr__text">
                <span class="pf-sr__t">{{ h.title }}</span>
                <span class="pf-sr__s">{{ h.section }}</span>
              </span>
              @if (first) {
                <span class="pf-sr__enter" aria-hidden="true">Enter</span>
              }
              <svg class="pf-sr__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
        }
      </ul>
    } @else {
      <p class="pf-band-empty" data-testid="settings-empty">No settings match “{{ query() }}”.</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-sr__count { margin: 0 0 10px; font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
    .pf-sr { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-sr__row { gap: 12px; min-height: 56px; padding: 10px 14px; text-decoration: none; }
    .pf-sr__row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-sr__row--top { border-color: var(--pf-sel-border); }
    .pf-sr__ic { width: 36px; height: 36px; border-radius: 10px; flex: none; }
    .pf-sr__text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-sr__t { font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-sr__s { font-size: 12px; line-height: 1.4; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .pf-sr__enter {
      flex: none; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--pf-line);
      font-size: 11px; font-weight: 600; color: var(--text-tertiary);
    }
    .pf-sr__arrow { flex: none; color: var(--text-muted); }
    @media (hover: none) { .pf-sr__enter { display: none; } }
    @media (pointer: coarse) { .pf-sr__row { min-height: 56px; } }
  `],
})
export class SettingsResultsComponent {
  readonly hits = input.required<SettingsEntry[]>();
  readonly query = input<string>('');
}
