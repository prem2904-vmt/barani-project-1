import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PlatformService } from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ImageEditorComponent } from '../../../shared/components/image-editor/image-editor.component';

/** Small reusable image-upload tile used by the report-template editor
 *  for the lab logo, NABL badge, and signature scans. POSTs the file to
 *  /api/uploads/image, then emits the returned URL via (urlChange).
 *
 *  Raster picks (PNG/JPG/WEBP) open the crop + resize editor first (OPS-14);
 *  SVG is vector and uploads untouched. */
@Component({
  selector: 'pf-image-upload',
  standalone: true,
  imports: [ImageEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editFile()) {
      <pf-image-editor [file]="editFile()" (applied)="onEdited($event)" (cancelled)="editFile.set(null)"></pf-image-editor>
    }
    <div class="pf-image-drop">
      <div class="pf-image-thumb">
        @if (url) {
          <img [src]="resolvedSrc()" alt="" onerror="this.style.display='none'" />
        } @else {
          <span class="pf-image-none">No image</span>
        }
      </div>
      <div class="flex-1 min-w-0">
        <label class="pf-file-btn">
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                 (change)="onPick($event)" hidden />
          {{ uploading() ? 'Uploading…' : (url ? 'Replace image' : 'Upload image') }}
        </label>
        @if (url) {
          <button type="button" class="pf-remove-link" (click)="clear()">Remove</button>
        }
        <p class="pf-image-hint">
          PNG / JPG / SVG / WEBP · max 5 MB
        </p>
      </div>
    </div>
  `,
  styles: [`
    .pf-image-drop { display: flex; align-items: center; gap: 12px;
      padding: 10px; border: 1px dashed var(--nd-line); border-radius: var(--nd-radius-sm, 10px);
      background: var(--nd-card-bg); }
    .pf-image-none { font-size: 11px; color: var(--text-tertiary); }
    .pf-image-hint { margin: 4px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-image-thumb { width: 64px; height: 64px; flex-shrink: 0;
      border-radius: 8px; background: var(--nd-chip-bg);
      display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .pf-image-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
    /* Kit secondary (outline) button; Remove = tertiary text in error red. */
    .pf-file-btn { display: inline-flex; align-items: center; height: 36px; padding: 0 14px; border-radius: var(--nd-radius-sm, 10px);
      background: transparent; color: var(--violet-text, #6d28d9); cursor: pointer;
      font-size: 13px; font-weight: 600; border: 1px solid var(--color-violet-600, #7c3aed); }
    .pf-remove-link { margin-left: 8px; background: transparent; border: none;
      color: var(--red-text, #b91c1c); cursor: pointer; font-size: 13px; font-weight: 600; }

    /* ── Additive cross-platform overrides only — desktop-web (>=1280)
         stays byte-identical. ──────────────────────────────────────── */

    /* Gate hover so taps on touch devices don't leave a stuck-hover. */
    @media (hover: hover) {
      .pf-file-btn:hover { background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent); }
    }

    /* Coarse pointers: give the upload/remove controls a >=44px tap
       target without changing their look on mouse-driven desktop. */
    @media (pointer: coarse) {
      .pf-file-btn { min-height: 44px; display: inline-flex;
        align-items: center; justify-content: center; }
      .pf-remove-link { display: inline-flex; align-items: center;
        min-height: 44px; }
    }
  `]
})
export class ImageUploadComponent {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly toasts = inject(ToastService);

  @Input() url?: string | null;
  @Output() urlChange = new EventEmitter<string>();

  readonly uploading = signal<boolean>(false);
  /** The raster file currently open in the crop/resize editor (OPS-14). */
  readonly editFile = signal<File | null>(null);

  /** Prepend the API base URL when the stored value is a server-relative
   *  path (i.e. starts with "/uploads/…"). Absolute http(s) URLs pass
   *  through untouched. */
  resolvedSrc(): string {
    const u = this.url ?? '';
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    return `${this.platform.getApiUrl()}${u}`;
  }

  clear() { this.urlChange.emit(''); }

  onPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = ''; // allow re-picking the same file
    if (file.size > 5 * 1024 * 1024) {
      this.toasts.error('File too large — max 5 MB');
      return;
    }
    // SVG is vector — it can't be canvas-cropped, so upload it untouched.
    // Raster images open the crop/resize editor first (OPS-14).
    const isSvg = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
    if (isSvg) { void this.uploadFile(file, file.name); return; }
    this.editFile.set(file);
  }

  /** Editor applied → upload the cropped/resized blob. */
  onEdited(blob: Blob) {
    const f = this.editFile();
    this.editFile.set(null);
    const isJpeg = /jpe?g$/i.test(f?.type ?? '') || /jpe?g$/i.test(f?.name ?? '');
    const base = (f?.name ?? 'image').replace(/\.[^.]+$/, '');
    void this.uploadFile(blob, `${base}.${isJpeg ? 'jpg' : 'png'}`);
  }

  private async uploadFile(data: Blob, filename: string) {
    this.uploading.set(true);
    try {
      const fd = new FormData();
      fd.append('file', data, filename);
      const baseUrl = this.platform.getApiUrl();
      const resp = await this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(
        `${baseUrl}/api/uploads/image`, fd).toPromise();
      if (resp?.success && resp.data?.url) {
        this.urlChange.emit(resp.data.url);
      } else {
        this.toasts.error(resp?.message ?? 'Upload failed');
      }
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.uploading.set(false);
    }
  }
}
