import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { ActionCatalogEntry, catalogFor } from '../../shared/models/process-workflow.model';

/**
 * Menu hub. Shows the ACTIONS the admin placed inside a menu (resolved from
 * /m/:menuId on the active workflow) as launch tiles, filtered to the ones the
 * user can access by permission. Each tile opens its existing screen.
 */
@Component({
  selector: 'pf-menu-hub',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mh px-4 md:px-8 lg:px-10 pt-6 pb-12">
      @if (menu(); as m) {
        <header class="mh-hd">
          <span class="mh-dot" [style.background]="m.color"></span>
          <h1 class="mh-title">{{ m.name }}</h1>
        </header>
        @if (tiles().length === 0) {
          <p class="mh-empty">No actions you can access in this menu.</p>
        } @else {
          <div class="mh-grid">
            @for (t of tiles(); track t.action.id) {
              <button type="button" class="mh-tile" [style.--accent]="m.color" (click)="open(t.entry.route)">
                <span class="mh-ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    @for (p of t.entry.iconPath; track $index) { <path [attr.d]="p" /> }
                  </svg>
                </span>
                <span class="mh-label">{{ t.action.label || t.entry.label }}</span>
                @if (t.entry.hint) { <span class="mh-hint">{{ t.entry.hint }}</span> }
              </button>
            }
          </div>
        }
      } @else {
        <p class="mh-empty">Loading…</p>
      }
    </section>
  `,
  styles: [`
    .mh-hd { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
    .mh-dot { width: 12px; height: 12px; border-radius: 50%; }
    .mh-title { margin: 0; font-size: 24px; font-weight: 700; color: var(--text-primary); }
    .mh-empty { font-size: 14px; color: var(--text-tertiary); padding: 24px 0; }
    .mh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
    .mh-tile { --accent: #7c3aed; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 18px; border-radius: 16px; text-align: left; cursor: pointer; background: var(--glass-bg); border: 1px solid var(--glass-border); transition: transform 0.12s, border-color 0.15s, box-shadow 0.15s; }
    .mh-tile:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: 0 10px 26px rgba(0,0,0,0.28); }
    .mh-tile:active { transform: scale(0.98); }
    .mh-ic { display: inline-flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 12px; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
    .mh-ic svg { width: 23px; height: 23px; }
    .mh-label { font-size: 15px; font-weight: 700; color: var(--text-primary); }
    .mh-hint { font-size: 12px; color: var(--text-tertiary); }
  `]
})
export class MenuHubComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly process = inject(ProcessWorkflowService);

  private readonly menuId = toSignal(this.route.paramMap.pipe(map(p => p.get('menuId') ?? '')), { initialValue: '' });

  constructor() { this.process.loadActive(); }

  readonly menu = computed(() => this.process.active()?.categories.find(c => c.id === this.menuId()) ?? null);

  readonly tiles = computed<{ action: { id: string; type: string; label?: string }; entry: ActionCatalogEntry }[]>(() => {
    const cfg = this.process.active(); const menu = this.menu();
    if (!cfg || !menu) return [];
    const isSuper = this.auth.permissions().includes('*');
    return cfg.actions
      .filter(a => a.categoryId === menu.id && a.enabled)
      .sort((a, b) => a.order - b.order)
      .map(a => ({ action: a, entry: catalogFor(a.type) }))
      .filter((t): t is { action: typeof t.action; entry: ActionCatalogEntry } =>
        !!t.entry && (!t.entry.permissions?.length || isSuper || this.auth.hasAnyPermission(t.entry.permissions)));
  });

  open(route: string) { this.router.navigate([route]); }
}
