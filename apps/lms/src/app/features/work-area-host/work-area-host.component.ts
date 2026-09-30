import { ChangeDetectionStrategy, Component, Type, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { LabFeaturesService } from '../../core/services/lab-features.service';
import { catalogFor } from '../../shared/models/process-workflow.model';
import { portablePanel } from '../../shared/workflow/portable-panels';
import { CollectBandButtonComponent } from '../../shared/components/collect-band-button/collect-band-button.component';
import { SkeletonCardComponent } from '../../shared/primitives/skeleton-kit.component';
import { PageOpenService } from '../../core/navigation/page-open.service';

interface HostItem { type: string; label: string; hint?: string; iconPath: string[]; route: string; cmp: Type<unknown> | null; }

/**
 * Generic host for a CUSTOM work-area (one that has no bespoke screen). Renders
 * the area's name as the heading and each placed action either as its registered
 * portable PANEL, or — until a panel is built — as a launcher card to the
 * action's real screen. Reached at /w/:menuId from the workflow-driven nav.
 */
@Component({
  selector: 'pf-work-area-host',
  standalone: true,
  imports: [SkeletonCardComponent, NgComponentOutlet, CollectBandButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wah px-4 md:px-8 lg:px-10 pt-6 pb-12">
      @if (menu(); as m) {
        <header class="wah-hd">
          <span class="wah-dot" [style.background]="m.color"></span>
          <h1 class="wah-title">{{ m.name }}</h1>
          <!-- No band on this host: the "Collect" entry point sits at the
               header's right (ND §1), general queue. -->
          <span class="wah-hd__actions"><pf-collect-band-button [area]="m.id" /></span>
        </header>
        @if (items() === null) {
          <!-- The area's panels are still loading (lazy code): their shape,
               never "No actions…" first. -->
          <pf-skeleton-card [lines]="3" label="Loading work area…"></pf-skeleton-card>
        } @else if (items()!.length === 0) {
          <p class="wah-empty">No actions you can access in this area.</p>
        } @else {
          @for (it of items()!; track it.type) {
            <section class="wah-block">
              <header class="wah-block__hd"><span class="wah-dot" [style.background]="m.color"></span>{{ it.label }}</header>
              @if (it.cmp) {
                <ng-container *ngComponentOutlet="it.cmp" />
              } @else {
                <button type="button" class="wah-launch press" (click)="go(it.route, $event)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    @for (p of it.iconPath; track $index) { <path [attr.d]="p" /> }
                  </svg>
                  <span class="wah-launch__l">Open {{ it.label }}</span>
                  @if (it.hint) { <span class="wah-launch__h">{{ it.hint }}</span> }
                </button>
              }
            </section>
          }
        }
      } @else {
        <pf-skeleton-card [lines]="3" label="Loading work area…"></pf-skeleton-card>
      }
    </section>
  `,
  styles: [`
    .wah-hd { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
    .wah-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .wah-hd__actions { margin-left: auto; display: flex; align-items: center; }
    .wah-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--text-primary); }
    .wah-empty { font-size: 13px; color: var(--text-tertiary); padding: 24px 0; }
    .wah-block { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--glass-bg); margin-bottom: 16px; overflow: hidden; }
    .wah-block__hd { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--glass-border); font-size: 13px; font-weight: 700; color: var(--text-primary); }
    .wah-launch { display: flex; align-items: center; gap: 12px; width: 100%; padding: 16px; background: transparent; border: none; cursor: pointer; text-align: left; }
    .wah-launch:hover { background: var(--bg-hover, rgba(255,255,255,0.03)); }
    .wah-launch svg { width: 22px; height: 22px; color: var(--text-secondary); flex-shrink: 0; }
    .wah-launch__l { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .wah-launch__h { font-size: 12px; color: var(--text-tertiary); margin-left: auto; }
  `]
})
export class WorkAreaHostComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageOpen = inject(PageOpenService);
  private readonly auth = inject(AuthService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly features = inject(LabFeaturesService);

  private readonly menuId = toSignal(this.route.paramMap.pipe(map(p => p.get('menuId') ?? '')), { initialValue: '' });
  readonly menu = computed(() => this.process.active()?.categories.find(c => c.id === this.menuId()) ?? null);

  /** null = the panels are still resolving (first open / area switch). */
  private readonly _items = signal<HostItem[] | null>(null);
  readonly items = this._items.asReadonly();

  private readonly wanted = computed(() => {
    const cfg = this.process.active(); const menu = this.menu();
    if (!cfg || !menu) return [] as Omit<HostItem, 'cmp'>[];
    const isSuper = this.auth.permissions().includes('*');
    return cfg.actions
      // Enabled here AND its module entitled (Home Visits ⇒ home collection).
      .filter(a => a.categoryId === menu.id && a.enabled && this.features.actionAvailable(a.type))
      .sort((a, b) => a.order - b.order)
      .map(a => ({ a, e: catalogFor(a.type) }))
      .filter(x => !!x.e && (!x.e.permissions?.length || isSuper || this.auth.hasAnyPermission(x.e.permissions)))
      .map(x => ({ type: x.a.type, label: x.a.label || x.e!.label, hint: x.e!.hint, iconPath: x.e!.iconPath, route: x.e!.route }));
  });

  constructor() {
    this.process.loadActive();
    let gen = 0;
    effect(() => {
      const want = this.wanted();
      const g = ++gen;
      if (!want.length) { this._items.set(this.menu() ? [] : null); return; }
      untracked(() => this._items.set(null));
      Promise.all(want.map(async w => {
        const p = portablePanel(w.type);
        const cmp = p ? await p.load() : null;
        return { ...w, cmp } as HostItem;
      })).then(list => { if (g === gen) this._items.set(list); })
        .catch(() => { if (g === gen) this._items.set([]); });
    });
  }

  /** The pressed launcher turns "held" the same frame until its (lazy)
   *  screen arrives; the destination frame (PageOpenService) covers the rest. */
  go(route: string, ev?: Event) {
    this.pageOpen.markSource(ev?.currentTarget as HTMLElement | null);
    this.router.navigate([route]);
  }
}
