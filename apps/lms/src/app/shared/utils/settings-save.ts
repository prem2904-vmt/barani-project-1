import { Injectable, computed, signal } from '@angular/core';

/** One page's (or one card's) save: what the band-corner Save reads and calls. */
export interface SettingsSaveReg {
  dirty: () => boolean;
  saving: () => boolean;
  canSave: () => boolean;
  canDiscard: () => boolean;
  testId: () => string;
  save: () => void;
  discard: () => void;
}

/**
 * The Settings Save lives in the band's TOP-RIGHT corner (owner 2026-11-17: "the nav bar always causes confusion" —
 * nothing clickable at the bottom next to the bottom nav). Every `pf-settings-savebar` on screen registers here; the
 * visible band renders ONE Save (disabled until something changed, so it never jumps) + Discard (tertiary, while
 * dirty) that act on every registered card / tab at once. Without a band (unit fixtures) the bar renders in place.
 */
@Injectable({ providedIn: 'root' })
export class SettingsSaveService {
  readonly regs = signal<SettingsSaveReg[]>([]);
  /** Bands that can host the Save (non-hosted pf-hero-band instances on screen). */
  readonly bands = signal(0);
  readonly present = computed(() => this.regs().length > 0);
  readonly dirty = computed(() => this.regs().some(r => r.dirty()));
  readonly saving = computed(() => this.regs().some(r => r.saving()));
  readonly canSave = computed(() => this.regs().some(r => r.dirty() && r.canSave()));
  readonly canDiscard = computed(() => this.regs().some(r => r.dirty() && r.canDiscard()));
  /** One registration keeps its own test id (e2e); several share `savebar-save`. */
  readonly testId = computed(() => (this.regs().length === 1 ? this.regs()[0].testId() : 'savebar-save'));

  register(r: SettingsSaveReg): () => void {
    this.regs.update(list => [...list, r]);
    return () => this.regs.update(list => list.filter(x => x !== r));
  }
  addBand(): () => void {
    this.bands.update(n => n + 1);
    return () => this.bands.update(n => Math.max(0, n - 1));
  }
  /** Save every changed card / tab of the page. */
  saveAll(): void { for (const r of this.regs()) if (r.dirty() && r.canSave()) r.save(); }
  discardAll(): void { for (const r of this.regs()) if (r.dirty() && r.canDiscard()) r.discard(); }
}
