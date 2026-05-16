import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PlatformService } from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';

/** Small reusable image-upload tile used by the report-template editor
 *  for the lab logo, NABL badge, and signature scans. POSTs the file to
 *  /api/uploads/image, then emits the returned URL via (urlChange). */
@Component({
  selector: 'pf-image-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-image-drop">
      <div class="pf-image-thumb">
        @if (url) {
          <img [src]="resolvedSrc()" alt="" onerror="this.style.display='none'" />
        } @else {
          <span class="text-[10px] uppercase tracking-wider" style="color: var(--text-tertiary);">No image</span>
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
        <p class="text-[10px] mt-1" style="color: var(--text-tertiary);">
          PNG / JPG / SVG / WEBP · max 5 MB
        </p>
      </div>
    </div>
  `,
  styles: [`
    .pf-image-drop { display: flex; align-items: center; gap: 12px;
      padding: 10px; border: 1px dashed var(--glass-border); border-radius: 10px;
      background: var(--glass-bg); }
    .pf-image-thumb { width: 64px; height: 64px; flex-shrink: 0;
      border-radius: 8px; background: rgba(255,255,255,0.06);
      display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .pf-image-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .pf-file-btn { display: inline-block; padding: 6px 12px; border-radius: 8px;
      background: rgba(168,85,247,0.12); color: #c4b5fd; cursor: pointer;
      font-size: 12px; font-weight: 600; border: 1px solid rgba(168,85,247,0.3); }
    .pf-file-btn:hover { background: rgba(168,85,247,0.20); }
    .pf-remove-link { margin-left: 8px; background: transparent; border: none;
      color: #ef4444; cursor: pointer; font-size: 12px; text-decoration: underline; }
  `]
})
export class ImageUploadComponent {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly toasts = inject(ToastService);

  @Input() url?: string | null;
  @Output() urlChange = new EventEmitter<string>();

  readonly uploading = signal<boolean>(false);

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

  async onPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = ''; // allow re-picking the same file
    if (file.size > 5 * 1024 * 1024) {
      this.toasts.error('File too large — max 5 MB');
      return;
    }
    this.uploading.set(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const baseUrl = this.platform.getApiUrl();
      const resp = await this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(
        `${baseUrl}/api/uploads/image`, fd).toPromise();
      if (resp?.success && resp.data?.url) {
        this.urlChange.emit(resp.data.url);
      } else {
        this.toasts.error(resp?.message ?? 'Upload failed');
      }
    } catch (err) {
      this.toasts.error('Upload failed — ' + ((err as Error).message ?? ''));
    } finally {
      this.uploading.set(false);
    }
  }
}
