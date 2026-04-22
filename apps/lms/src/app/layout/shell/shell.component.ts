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

      <main class="shell-main relative">
        <router-outlet></router-outlet>
      </main>

      <pf-bottom-nav></pf-bottom-nav>

      <!-- Themed prompt / confirm overlay (replaces window.prompt/confirm). -->
      <pf-dialog-host></pf-dialog-host>

      <!-- Toasts -->
      <div class="pointer-events-none fixed bottom-24 right-4 flex flex-col gap-3 z-[60] sm:bottom-28">
        @for (t of toasts.toasts(); track t.id) {
          <div class="pointer-events-auto toast-item flex items-center w-full max-w-xs p-4 rounded-lg shadow-lg"
               role="alert">

            <!-- Icon badge -->
            <div class="toast-icon inline-flex items-center justify-center flex-shrink-0 w-8 h-8 rounded-lg"
                 [attr.data-level]="t.level">
              @switch (t.level) {
                @case ('success') {
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 8.207-4 4a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L9 10.586l3.293-3.293a1 1 0 0 1 1.414 1.414Z"/></svg>
                }
                @case ('error') {
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 11.793a1 1 0 1 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 1.414-1.414L10 8.586l2.293-2.293a1 1 0 0 1 1.414 1.414L11.414 10l2.293 2.293Z"/></svg>
                }
                @case ('warning') {
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM10 15a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-4a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5Z"/></svg>
                }
                @default {
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM10 15a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-4a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5Z"/></svg>
                }
              }
            </div>

            <!-- Message -->
            <div class="ms-3 text-sm font-normal toast-msg">{{ t.message }}</div>

            <!-- Close -->
            <button type="button"
                    class="toast-close ms-auto -mx-1.5 -my-1.5 inline-flex items-center justify-center h-8 w-8 rounded-lg p-1.5"
                    (click)="toasts.dismiss(t.id)"
                    aria-label="Close">
              <svg class="w-3 h-3" fill="none" viewBox="0 0 14 14">
                <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"/>
              </svg>
            </button>

          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .shell-stack {
      position: relative;
      z-index: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* main holds the routed feature; it does NOT scroll — the feature host does.
     * Bottom padding leaves room for the floating bottom-nav pill on mobile + tablet. */
    .shell-main {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      padding-bottom: var(--tab-nav-total-height, 0px);
    }
    @media (min-width: 1280px) {
      .shell-main { padding-bottom: 0; }
    }

    /* Toast */
    .toast-item {
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      animation: toast-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .toast-msg { color: var(--text-primary); }

    /* Icon badge per level */
    .toast-icon[data-level='success'] { background: rgba(16, 185, 129, 0.18); color: #34d399; }
    .toast-icon[data-level='error']   { background: rgba(239, 68, 68, 0.18);  color: #f87171; }
    .toast-icon[data-level='warning'] { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }
    .toast-icon[data-level='info']    { background: rgba(99, 102, 241, 0.18); color: #818cf8; }

    /* Close button */
    .toast-close {
      color: var(--text-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .toast-close:hover {
      background: var(--glass-bg-hover);
      color: var(--text-primary);
    }

    @keyframes toast-in {
      from { opacity: 0; transform: translateX(16px) scale(0.97); }
      to   { opacity: 1; transform: translateX(0)    scale(1); }
    }
  `]
})
export class ShellComponent {
  readonly toasts = inject(ToastService);
}
