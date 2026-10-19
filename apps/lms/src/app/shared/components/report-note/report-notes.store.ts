import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';

/** The four places a technician note prints (owner 2026-09-30). */
export type ReportNoteScope = 'order' | 'department' | 'profile' | 'test';

export interface ReportNoteSlot {
  /** Department / profile id; null for the order's own note. */
  id: string | null;
  name: string;
  text: string | null;
  editable: boolean;
}

export interface ReportNoteLineSlot {
  /** The ordered line (order-test) id. */
  id: string;
  name: string;
  /** The profile block it prints in (server-resolved, as ORDERED). */
  profileId: string | null;
  /** The department section it prints in (server-resolved routing). */
  departmentId: string | null;
  status?: string | null;
  text: string | null;
  editable: boolean;
}

/** GET /api/orders/{id}/report-notes. `enabled` = this branch's Lab-settings
 *  switch; the server decides every slot's `editable`. */
export interface ReportNotesView {
  enabled: boolean;
  maxLength: number;
  order: ReportNoteSlot;
  departments: ReportNoteSlot[];
  profiles: ReportNoteSlot[];
  tests: ReportNoteLineSlot[];
}

/** A well-formed notes view (an older server / a stub may answer otherwise). */
function isView(v: unknown): v is ReportNotesView {
  const o = v as ReportNotesView | null;
  return !!o && typeof o === 'object' && !Array.isArray(o) && !!o.order
    && Array.isArray(o.tests) && Array.isArray(o.departments) && Array.isArray(o.profiles);
}

/**
 * One order's technician report notes for a screen (provide it on the screen
 * component). The server is the single source: the screen asks this store
 * which slots exist, what they hold and whether they may change, and saves
 * through it — it never re-derives a line's profile or department.
 *
 * Switch off → `enabled()` is false: no editor, no "add" buttons; a note
 * already written still shows read-only (it still prints).
 */
@Injectable()
export class ReportNotesStore {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly orderId = signal<string | null>(null);
  readonly view = signal<ReportNotesView | null>(null);
  /** Slots whose editor is open, as `scope:id` keys. */
  private readonly _open = signal<ReadonlySet<string>>(new Set());
  /** The slot being saved (`scope:id`), or null. */
  readonly saving = signal<string | null>(null);

  readonly enabled = computed(() => !!this.view()?.enabled);
  readonly maxLength = computed(() => this.view()?.maxLength ?? 1000);

  static key(scope: ReportNoteScope, id: string | null | undefined): string {
    return `${scope}:${id ?? ''}`;
  }

  /** Load (or reload) the notes of an order. Silent on failure: the notes
   *  are an extra — a screen must never break because they could not load. */
  async load(orderId: string | null | undefined): Promise<void> {
    if (!orderId) { this.orderId.set(null); this.view.set(null); return; }
    const changed = orderId !== this.orderId();
    this.orderId.set(orderId);
    if (changed) { this.view.set(null); this._open.set(new Set()); }
    try {
      const v = await firstValueFrom(this.api.get<ReportNotesView>(`/api/orders/${orderId}/report-notes`));
      if (this.orderId() === orderId) this.view.set(isView(v) ? v : null);
    } catch { /* no notes UI */ }
  }

  line(orderTestId: string | null | undefined): ReportNoteLineSlot | null {
    return this.view()?.tests.find(t => t.id === orderTestId) ?? null;
  }

  slot(scope: ReportNoteScope, id: string | null | undefined): ReportNoteSlot | ReportNoteLineSlot | null {
    const v = this.view();
    if (!v) return null;
    switch (scope) {
      case 'order': return v.order;
      case 'department': return v.departments.find(d => d.id === id) ?? null;
      case 'profile': return v.profiles.find(p => p.id === id) ?? null;
      case 'test': return v.tests.find(t => t.id === id) ?? null;
    }
  }

  text(scope: ReportNoteScope, id: string | null | undefined): string {
    return this.slot(scope, id)?.text ?? '';
  }

  /** The tech may write here now (switch on + the server says open). */
  canEdit(scope: ReportNoteScope, id: string | null | undefined): boolean {
    return this.enabled() && !!this.slot(scope, id)?.editable;
  }

  /** Worth showing at all: writable, or already holds a note (it prints). */
  shows(scope: ReportNoteScope, id: string | null | undefined): boolean {
    return this.canEdit(scope, id) || !!this.text(scope, id).trim();
  }

  isOpen(scope: ReportNoteScope, id: string | null | undefined): boolean {
    return this._open().has(ReportNotesStore.key(scope, id));
  }

  setOpen(scope: ReportNoteScope, id: string | null | undefined, open: boolean): void {
    const k = ReportNotesStore.key(scope, id);
    const next = new Set(this._open());
    if (open && this.canEdit(scope, id)) next.add(k); else next.delete(k);
    this._open.set(next);
  }

  toggle(scope: ReportNoteScope, id: string | null | undefined): void {
    this.setOpen(scope, id, !this.isOpen(scope, id));
  }

  /** Save one note (empty text clears it). True when saved. */
  async save(scope: ReportNoteScope, id: string | null | undefined, text: string): Promise<boolean> {
    const orderId = this.orderId();
    if (!orderId || this.saving()) return false;
    const k = ReportNotesStore.key(scope, id);
    this.saving.set(k);
    try {
      const v = await firstValueFrom(this.api.put<ReportNotesView>(`/api/orders/${orderId}/report-notes`,
        { scope, key: scope === 'order' ? null : id, text }));
      if (isView(v) && this.orderId() === orderId) this.view.set(v);
      this.setOpen(scope, id, false);
      this.toasts.success(text.trim() ? 'Report note saved' : 'Report note removed');
      return true;
    } catch (e) {
      this.toasts.error(ApiError.from(e).message || 'Could not save the note — retry.');
      return false;
    } finally {
      this.saving.set(null);
    }
  }

  /** Department slots of the given lines (their sections), in first-seen order. */
  departmentsOf(lineIds: readonly string[]): ReportNoteSlot[] {
    const v = this.view();
    if (!v) return [];
    const ids: string[] = [];
    for (const id of lineIds) {
      const d = this.line(id)?.departmentId;
      if (d && !ids.includes(d)) ids.push(d);
    }
    return ids.map(d => v.departments.find(x => x.id === d)).filter((x): x is ReportNoteSlot => !!x);
  }

  /** Profile slots of the given lines, in first-seen order. */
  profilesOf(lineIds: readonly string[]): ReportNoteSlot[] {
    const v = this.view();
    if (!v) return [];
    const ids: string[] = [];
    for (const id of lineIds) {
      const p = this.line(id)?.profileId;
      if (p && !ids.includes(p)) ids.push(p);
    }
    return ids.map(p => v.profiles.find(x => x.id === p)).filter((x): x is ReportNoteSlot => !!x);
  }
}
