import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BranchSwitchService } from '../../../core/services/branch-switch.service';
import { SkeletonComponent } from '../../primitives/skeleton.component';
import { SkeletonRowsComponent } from '../../primitives/skeleton-kit.component';

/**
 * Branch-switch veil: the DESTINATION skeleton (a work screen's band + its
 * main card of rows) that rises over the receding screen while the new
 * branch's data loads, with a caption naming where you are going. Mounted
 * once, inside the shell's <main>; BranchSwitchService drives it.
 */
@Component({
  selector: 'pf-branch-veil',
  standalone: true,
  imports: [SkeletonComponent, SkeletonRowsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-bveil',
    '[attr.data-phase]': 'svc.phase()',
  },
  template: `
    <div class="pf-bveil__page">
      <div class="pf-bveil__band">
        <pf-skeleton variant="line" width="180px" height="18px"></pf-skeleton>
        <span class="pf-bveil__sp"></span>
        <div class="pf-bveil__cap" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/>
          </svg>
          <span>Switching to <strong>{{ name() }}</strong></span>
        </div>
        <span class="pf-bveil__sp"></span>
        <pf-skeleton variant="pill" width="120px" height="36px"></pf-skeleton>
        <pf-skeleton variant="pill" width="96px" height="36px"></pf-skeleton>
      </div>
      <div class="pf-bveil__card">
        <pf-skeleton-rows [rows]="7" [label]="'Loading ' + name() + '…'"></pf-skeleton-rows>
      </div>
    </div>
  `,
  styles: [`
    /* Mounted only while a switch runs: it rises on mount (out), holds
       (loading), and lifts away (in) before it unmounts. */
    :host {
      position: absolute; inset: 0; z-index: 30;
      display: flex; flex-direction: column; align-items: stretch;
      /* Frosted page: the receding screen stays faintly visible (dimmed, not
         cleared) behind the destination skeleton. */
      background: color-mix(in srgb, var(--bg-primary, #0a0a15) 84%, transparent);
      -webkit-backdrop-filter: blur(10px) saturate(1.05);
      backdrop-filter: blur(10px) saturate(1.05);
      animation: pf-bveil-fade 280ms cubic-bezier(0.32, 0.72, 0, 1) both;
      transition: opacity 240ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    :host([data-phase='in']) { opacity: 0; pointer-events: none; }
    .pf-bveil__page {
      flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px;
      padding: 12px clamp(16px, 2.5vw, 40px) 24px;
      animation: pf-bveil-settle 420ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }
    .pf-bveil__band {
      display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 0 16px;
      border-radius: 18px; border: 1px solid var(--glass-border, rgba(127, 127, 127, 0.14));
      background: var(--glass-bg, transparent);
    }
    .pf-bveil__sp { flex: 1; }
    .pf-bveil__card {
      border-radius: 18px; border: 1px solid var(--glass-border, rgba(127, 127, 127, 0.14));
      background: var(--glass-bg, transparent); overflow: hidden;
    }
    /* The caption sits IN the band (always in view, never under a bar). */
    .pf-bveil__cap {
      display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; flex: none;
      padding: 7px 14px; border-radius: 999px; font-size: 13px; color: var(--text-secondary, inherit);
      background: var(--surface-elevated, var(--glass-bg-hover, rgba(127, 127, 127, 0.12)));
      border: 1px solid var(--glass-border, rgba(127, 127, 127, 0.18));
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.10);
      animation: pf-bveil-cap 360ms 60ms cubic-bezier(0.34, 1.36, 0.64, 1) both;
    }
    .pf-bveil__cap strong { color: var(--text-primary, inherit); font-weight: 600; }
    @keyframes pf-bveil-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-bveil-settle { from { opacity: 0; transform: scale(1.025); } to { opacity: 1; transform: none; } }
    @keyframes pf-bveil-cap { from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: none; } }
    @media (max-width: 640px) { .pf-bveil__band > pf-skeleton { display: none; } }
    @media (prefers-reduced-motion: reduce) {
      :host { animation: pf-bveil-fade 120ms linear both; transition: opacity 120ms linear; }
      .pf-bveil__page { animation: none; }
      .pf-bveil__cap { animation: pf-bveil-fade 120ms linear both; }
    }
  `],
})
export class BranchVeilComponent {
  protected readonly svc = inject(BranchSwitchService);
  protected readonly name = computed(() => this.svc.target()?.name ?? 'branch');
}
