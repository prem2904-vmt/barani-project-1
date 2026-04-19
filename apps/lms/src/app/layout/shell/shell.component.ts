import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastService } from '../../core/services/toast.service';
import { DialogHostComponent } from '../../shared/components/dialog-host/dialog-host.component';
import { ClockComponent } from '../../shared/primitives/clock.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { TopStripComponent } from '../top-strip/top-strip.component';

@Component({
  selector: 'pf-shell',
  standalone: true,
  imports: [RouterOutlet, TopStripComponent, BottomNavComponent, DialogHostComponent, ClockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Ambient canvas comes from body background gradients; we only manage the content stack here. -->
    <div class="min-h-screen flex flex-col">
      <pf-top-strip></pf-top-strip>

      <!-- Ambient clock — sits below the navbar on the right, reading as
           watermark metadata rather than a widget. -->
      <pf-clock size="sm" variant="bare"
                class="pf-floating-clock hidden md:inline-flex"></pf-clock>

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
    .pf-floating-clock {
      position: fixed;
      top: calc(var(--pf-topbar-offset, 80px) + 14px);
      right: 1.25rem;
      z-index: 25;
      pointer-events: none;
      opacity: 0.75;
      transition: opacity 0.2s ease;
    }
    .pf-floating-clock:hover { opacity: 1; }
    @media (min-width: 1024px) {
      .pf-floating-clock { right: 2rem; }
    }
  `]
})
export class ShellComponent {
  readonly toasts = inject(ToastService);
}
