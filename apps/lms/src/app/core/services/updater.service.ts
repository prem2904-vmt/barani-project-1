import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

/** window.electronAPI.updater — electron/preload.js (electron/updater.js in
 *  main). Absent on web / mobile and on a desktop build with no update
 *  channel (no pfDataProfile — see electron/updater-feed.js). */
export interface ElectronUpdaterBridge {
  getState(): Promise<UpdaterState | null>;
  check?(): Promise<UpdaterState | null>;
  restartNow(): Promise<{ ok: boolean; deferred?: boolean; reasons?: string[]; reason?: string } | null>;
  onState(cb: (s: UpdaterState) => void): () => void;
}

export type UpdaterPhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'deferred';

export interface UpdaterState {
  phase: UpdaterPhase;
  version: string | null;
  progress: number | null;
  error: string | null;
  deferReasons?: string[] | null;
}

export function updaterMenuLabel(s: UpdaterState): string {
  switch (s.phase) {
    case 'checking': return 'Checking for updates…';
    case 'downloading': return `Downloading update… ${s.progress || 0}%`;
    case 'ready': return `Restart to install${s.version ? ` v${s.version}` : ''}`;
    case 'deferred': return 'Update ready — waiting for instruments to finish';
    default: return 'Check for updates';
  }
}

function electronUpdaterBridge(): ElectronUpdaterBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { isElectron?: boolean; updater?: ElectronUpdaterBridge } }).electronAPI;
  return api?.isElectron && api.updater ? api.updater : null;
}

/**
 * Desktop self-update, renderer side. Shows up only as the small, dismissible
 * banner (shared/components/update-banner) once a download has FINISHED and
 * passed sha512 verification (phase 'ready') — never while checking or
 * downloading, and never a blocking/native dialog.
 *
 * "Restart now" can come back deferred (an instrument connector session
 * looks busy — electron/updater-guard.js decided, not us): the banner then
 * shows "Analyzer is connected…" and main retries on its own once it isn't,
 * pushing the next state through unprompted.
 */
@Injectable({ providedIn: 'root' })
export class UpdaterService {
  private readonly api = electronUpdaterBridge();
  /** True only in a desktop build with a resolved update channel. */
  readonly available = !!this.api;

  readonly state = signal<UpdaterState>({ phase: 'idle', version: null, progress: null, error: null });

  /** Avatar-menu "Check for updates" — same wording as the tray / application
   *  menu (electron/tray-model.js updaterLabel). */
  readonly menuLabel = computed(() => updaterMenuLabel(this.state()));
  /** Nothing to click while a check / download / deferred restart is running. */
  readonly menuBusy = computed(() => ['checking', 'downloading', 'deferred'].includes(this.state().phase));

  /** Show the banner once a verified download is ready, or while we're
   *  waiting out an active analyzer session to retry the restart. */
  readonly bannerVisible = signal(false);

  constructor() {
    const api = this.api;
    if (!api) return;
    const destroyRef = inject(DestroyRef);
    const off = api.onState((s) => this.apply(s));
    void api.getState().then((s) => { if (s) this.apply(s); }).catch(() => undefined);
    destroyRef.onDestroy(() => off());
  }

  private apply(s: UpdaterState): void {
    this.state.set(s);
    this.bannerVisible.set(s.phase === 'ready' || s.phase === 'deferred');
  }

  /** Check now, or restart to install when an update is ready (main decides;
   *  the instrument-busy guard still applies). */
  async checkNow(): Promise<void> {
    if (!this.api?.check) return;
    try { const s = await this.api.check(); if (s) this.apply(s); } catch { /* main logs it */ }
  }

  /** "Restart now" — may come back deferred; the banner's own caller reads
   *  state() afterwards for the reason, it doesn't need this return value. */
  async restartNow(): Promise<void> {
    if (!this.api) return;
    try { await this.api.restartNow(); } catch { /* main logs it; banner stays as-is */ }
  }

  /** "Later" — hide until the next state push (e.g. the owner's deferred
   *  retry, or a future update). Doesn't cancel autoInstallOnAppQuit. */
  dismiss(): void {
    this.bannerVisible.set(false);
  }
}
