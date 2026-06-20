import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ToastService } from '../../../core/services/toast.service';

interface PatientDocument {
  id: string;
  documentType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  notes?: string | null;
  uploadedAt: string;
}

const DOC_TYPES = [
  { value: 'photo', label: 'Photo' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'report', label: 'Report / scan' },
  { value: 'id_proof', label: 'ID proof' },
  { value: 'consent', label: 'Consent form' },
  { value: 'other', label: 'Other' },
];

/**
 * Patient documents tab — upload photos/scans/prescriptions, list them, delete.
 * Files are stored in object storage (Spaces) server-side; the list returns
 * short-lived pre-signed URLs so PHI is never public.
 */
@Component({
  selector: 'pf-patient-documents',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <div class="flex flex-wrap items-end gap-3 p-4 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]">
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">Type</label>
          <select class="pf-input !py-2" [ngModel]="docType()" (ngModelChange)="docType.set($event)">
            @for (t of types; track t.value) { <option [value]="t.value">{{ t.label }}</option> }
          </select>
        </div>
        <div class="flex-1 min-w-[160px]">
          <label class="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">Note (optional)</label>
          <input class="pf-input !py-2" [ngModel]="note()" (ngModelChange)="note.set($event)" placeholder="e.g. fasting sample" />
        </div>
        <label class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer transition-colors"
               [class.opacity-50]="busy()">
          {{ busy() ? 'Uploading…' : 'Upload file' }}
          <input type="file" class="hidden" accept="image/*,application/pdf" [disabled]="busy()"
                 (change)="onPick($event)" />
        </label>
      </div>

      @if (loading()) {
        <p class="text-sm text-[var(--text-tertiary)]">Loading documents…</p>
      } @else if (!docs().length) {
        <div class="p-8 text-center rounded-xl border border-dashed border-[var(--glass-border)]">
          <p class="text-sm text-[var(--text-tertiary)]">No documents yet. Upload a photo, prescription or scan.</p>
        </div>
      } @else {
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          @for (d of docs(); track d.id) {
            <div class="group relative rounded-xl overflow-hidden border border-[var(--glass-border)] bg-[var(--bg-card-solid)]">
              <a [href]="d.url" target="_blank" rel="noopener" class="block aspect-square bg-[var(--glass-bg)] flex items-center justify-center">
                @if (isImage(d)) {
                  <img [src]="d.url" [alt]="d.fileName" class="w-full h-full object-cover" loading="lazy" />
                } @else {
                  <svg class="w-10 h-10 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
                  </svg>
                }
              </a>
              <div class="p-2">
                <p class="text-xs font-semibold text-[var(--text-primary)] truncate" [title]="d.fileName">{{ d.fileName }}</p>
                <p class="text-[10px] text-[var(--text-muted)]">{{ label(d.documentType) }} · {{ kb(d.sizeBytes) }}</p>
              </div>
              <button type="button" title="Delete"
                      class="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-600"
                      (click)="remove(d)">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PatientDocumentsComponent {
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);

  readonly patientId = input.required<string>();
  protected readonly types = DOC_TYPES;
  protected readonly docs = signal<PatientDocument[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly docType = signal('report');
  protected readonly note = signal('');

  private readonly base = computed(() => `${environment.apiUrl}/api/patients/${this.patientId()}/documents`);

  constructor() {
    // input() is available synchronously for required inputs by first CD; load on init.
    queueMicrotask(() => this.load());
  }

  private async load() {
    this.loading.set(true);
    try {
      const r: any = await firstValueFrom(this.http.get(this.base()));
      this.docs.set(r?.data ?? []);
    } catch { this.docs.set([]); }
    this.loading.set(false);
  }

  async onPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('documentType', this.docType());
      if (this.note().trim()) fd.append('notes', this.note().trim());
      const r: any = await firstValueFrom(this.http.post(this.base(), fd));
      if (r?.success && r.data) {
        this.docs.update(list => [r.data, ...list]);
        this.note.set('');
        this.toasts.success('Document uploaded');
      } else {
        this.toasts.error(r?.error?.message ?? 'Upload failed');
      }
    } catch (e: any) {
      this.toasts.error(e?.error?.error?.message ?? 'Upload failed — is storage configured?');
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }

  async remove(d: PatientDocument) {
    if (!confirm(`Delete "${d.fileName}"?`)) return;
    try {
      await firstValueFrom(this.http.delete(`${this.base()}/${d.id}`));
      this.docs.update(list => list.filter(x => x.id !== d.id));
    } catch { this.toasts.error('Delete failed'); }
  }

  isImage(d: PatientDocument) { return (d.contentType || '').startsWith('image/'); }
  label(type: string) { return DOC_TYPES.find(t => t.value === type)?.label ?? type; }
  kb(bytes: number) { return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
}
