import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { BranchLabConfigService } from './branch-lab-config.service';
import { ProcessWorkflowService } from './process-workflow.service';
import { OutsourcingService } from './outsourcing.service';
import { DraftShelfService } from './draft-shelf.service';
import { PatientProfileService } from './patient-profile.service';
import { HttpActivityService } from './http-activity.service';
import { ZoomTransitionService, prefersReducedMotion } from '../navigation/zoom-transition';
import { MIN_BRANCH_MS } from '../../shared/utils/min-duration';
import { ViewStateService } from '../../shared/services/view-state.service';

/** The veil + content phases of one branch switch. */
export type BranchSwitchPhase = 'idle' | 'out' | 'loading' | 'in';

/** Out: the current screen recedes and the veil (destination skeleton) rises. */
export const BRANCH_OUT_MS = 280;
/** In: the veil lifts and the new branch's screen zooms up into place. */
export const BRANCH_IN_MS = 420;
/** Never hold the veil longer than this — a stuck call must not trap the UI. */
export const BRANCH_MAX_WAIT_MS = 6000;
/** The internal, componentless route the re-scope hops through (never shown
 *  in the address bar) so the target screen is re-created and its guards
 *  re-run under the new branch. */
export const BRANCH_HOP_PATH = '_branch';

/**
 * IN-APP BRANCH SWITCH (owner, 2026-09-27: "when I switch branch it feels
 * vague and takes time — switch branch needs an animation too").
 *
 * WHY IT WAS SLOW: the switch did `window.location.reload()`. Every switch
 * re-downloaded + re-parsed the bundle, restored the session, re-pulled
 * /api/auth/me, the tenant, entitlements, the directory, the workflow and the
 * lab config one after another, reconnected the work-events hub, and only
 * then re-rendered the screen — seconds of white page and the boot spinner.
 *
 * NOW: nothing reloads. The active branch changes in place (the interceptor
 * reads it live for X-Active-Branch; the work-events hub already rejoins the
 * branch group on change), only the BRANCH-scoped caches are refreshed (lab
 * config + active workflow, fetched in parallel; outsourced rows and the
 * draft shelf cleared), and the routed screen is re-created through an
 * internal hop so its guards and first loads run under the new branch.
 * Tenant-wide state (session, /me, entitlements, tenant, directory, chat)
 * stays warm — that is the speed-up.
 *
 * MOTION: out (screen recedes + dims, destination skeleton rises) → loading
 * (skeleton held until the new screen's requests settle, at least
 * MIN_BRANCH_MS overall so it never flickers) → in (veil lifts, screen zooms
 * up). A screen that needs no fetch skips the hold and just plays out → in.
 * Reduced motion: no movement, a quick cross-fade only.
 */
@Injectable({ providedIn: 'root' })
export class BranchSwitchService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly outsourcing = inject(OutsourcingService);
  private readonly drafts = inject(DraftShelfService);
  private readonly profile = inject(PatientProfileService);
  private readonly activity = inject(HttpActivityService);
  private readonly zoom = inject(ZoomTransitionService);
  private readonly viewState = inject(ViewStateService);

  private readonly _phase = signal<BranchSwitchPhase>('idle');
  private readonly _target = signal<{ id: string; name: string } | null>(null);
  private readonly _announce = signal('');

  readonly phase = this._phase.asReadonly();
  /** The branch being switched TO (null when idle). */
  readonly target = this._target.asReadonly();
  /** Busy: a switch is in progress (the switcher UI disables itself). */
  readonly busy = computed(() => this._phase() !== 'idle');
  /** The veil (destination skeleton) is up. */
  readonly veil = computed(() => this._phase() === 'out' || this._phase() === 'loading');
  /** Polite live-region text ("Switching to Salem…" → "Now in Salem"). */
  readonly announcement = this._announce.asReadonly();

  /** Timing seams (specs run with fake timers / reduced motion). */
  wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
  now = (): number => Date.now();
  reducedMotion = (): boolean => prefersReducedMotion();

  /**
   * Switch to `branchId` in place. Resolves true when the switch happened,
   * false when it was refused (not one of the user's branches, already
   * active, or a switch already running).
   */
  async switchTo(branchId: string): Promise<boolean> {
    if (this.busy()) return false;
    const branches = this.auth.user()?.branches ?? [];
    const b = branches.find(x => x.id === branchId);
    if (!b || branchId === this.auth.activeBranchId()) return false;

    const reduced = this.reducedMotion();
    const started = this.now();
    this._target.set({ id: b.id, name: b.name });
    this._announce.set(`Switching to ${b.name}…`);
    this.zoom.disarm();
    this.pinVeil(false);
    this._phase.set('out');
    await this.wait(reduced ? 0 : BRANCH_OUT_MS);

    // Re-scope in place (no page reload).
    if (!this.auth.setActiveBranch(branchId, { reload: false })) { this.finish(); return false; }
    this.profile.close();
    this.drafts.clearAll();
    // Screens come back on their defaults in the new branch (filters, tabs, dates).
    this.viewState.clear();
    this.outsourcing.reset();
    this.labCfg.reset();
    this.labCfg.ensureLoaded();          // parallel with the workflow below
    this.process.refreshActive();

    this._phase.set('loading');
    this.pinVeil(true);
    const url = this.router.url;
    let ok = false;
    try {
      await this.router.navigateByUrl('/' + BRANCH_HOP_PATH, { skipLocationChange: true });
      ok = (await this.router.navigateByUrl(url, { replaceUrl: true })) !== false;
    } catch {
      ok = false;
    }
    if (!ok) {
      // Whatever went wrong, the old, always-correct path still works.
      try { window.location.reload(); } catch { /* SSR/native guard */ }
      return true;
    }

    // Hold the skeleton until the new screen's data has landed — but only
    // if it is actually loading. A screen with nothing to fetch (cached)
    // goes straight to the zoom-in with the same motion.
    if (this.activity.busy()) {
      await this.activity.whenIdle({ quietMs: 120, maxMs: BRANCH_MAX_WAIT_MS });
      const left = started + MIN_BRANCH_MS - this.now();
      if (left > 0 && !reduced) await this.wait(left);
    }

    this._phase.set('in');
    this._announce.set(`Now working in ${b.name}`);
    this.focusMain();
    await this.wait(reduced ? 0 : BRANCH_IN_MS);
    this.finish();
    return true;
  }

  private finish(): void {
    this._phase.set('idle');
    this._target.set(null);
  }

  /** Pin the veil over the VISIBLE part of the scrolling <main> (it is
   *  absolutely positioned inside the scroller). `toTop`: the new screen
   *  starts at the top, so scroll there and pin the veil with it. */
  private pinVeil(toTop: boolean): void {
    if (typeof document === 'undefined') return;
    const main = document.querySelector<HTMLElement>('main.shell-main');
    if (!main) return;
    if (toTop) main.scrollTop = 0;
    main.style.setProperty('--pf-bs-top', `${main.scrollTop}px`);
    if (main.clientHeight > 0) main.style.setProperty('--pf-bs-h', `${main.clientHeight}px`);
    else main.style.removeProperty('--pf-bs-h');
  }

  /** Put keyboard/screen-reader focus at the top of the new screen. */
  private focusMain(): void {
    if (typeof document === 'undefined') return;
    const main = document.querySelector<HTMLElement>('main.shell-main');
    if (!main) return;
    const heading = main.querySelector<HTMLElement>('h1, [role="heading"][aria-level="1"]');
    const el = heading ?? main;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch { /* detached */ }
  }
}
