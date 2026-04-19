import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastService } from '../../core/services/toast.service';
import { AmbientBgComponent } from '../../shared/components/ambient-bg/ambient-bg.component';
import { DialogHostComponent } from '../../shared/components/dialog-host/dialog-host.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { TopStripComponent } from '../top-strip/top-strip.component';

@Component({
  selector: 'pf-shell',
  standalone: true,
  imports: [RouterOutlet, TopStripComponent, BottomNavComponent, DialogHostComponent, AmbientBgComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Flowing ambient background: DNA gradients + drifting pulse/helix/glyphs. -->
    <pf-ambient-bg></pf-ambient-bg>

    <!-- Everything above sits in a stacking context on top of the ambient. -->
    <div class="shell-stack">
      <pf-top-strip></pf-top-strip>

      <main class="flex-1 relative pb-tab-nav">
        <router-outlet></router-outlet>
      </main>

      <pf-bottom-nav></pf-bottom-nav>

      <!-- Themed prompt / confirm overlay (replaces window.prompt/confirm). -->
      <pf-dialog-host></pf-dialog-host>

      <!-- Toasts -->
      <div class="pointer-events-none fixed bottom-24 right-4 flex flex-col gap-2 z-[60]
                  sm:bottom-28">
        @for (t of toasts.toasts(); track t.id) {
          <div class="pointer-events-auto min-w-64 max-w-sm rounded-xl px-3.5 py-2.5 text-sm shadow-lg border glass-card-elevated slide-up"
               [class.border-emerald-400]="t.level === 'success'"
               [class.border-red-400]="t.level === 'error'"
               [class.border-amber-400]="t.level === 'warning'">
            <span class="mr-2">
              @switch (t.level) {
                @case ('success') { ✅ }
                @case ('error')   { ❌ }
                @case ('warning') { ⚠️ }
                @default          { ℹ️ }
              }
            </span>
            <span style="color: var(--text-primary);">{{ t.message }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .shell-stack {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
  `]
})
export class ShellComponent {
  readonly toasts = inject(ToastService);
}
