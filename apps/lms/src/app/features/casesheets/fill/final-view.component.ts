import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonRowsComponent } from '@prefrontal/shared';
import { DialogService } from '../../../core/services/dialog.service';
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import { CasesheetNav } from '../data/casesheet-nav';
import { CasesApi } from '../data/cases/cases-api';
import { CaseSession } from '../data/cases/case-session';
import { NarrativeCardComponent } from './narrative-card.component';

/** Desktop (a mouse and a wide screen) shows the PDF itself; tablets show the words and open the PDF full screen (mobile browsers cut PDF frames). */
export function prefersPdfFrame(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: fine) and (min-width: 1280px)').matches;
}

export function pdfFileName(
  patient: string | null | undefined,
  form: string | null | undefined,
  date: string | null | undefined,
): string {
  const bits = [patient, form, date?.slice(0, 10)].filter((b): b is string => !!b && !!b.trim());
  const base =
    bits
      .join(' - ')
      .replace(/[^\p{L}\p{N} ._-]+/gu, '')
      .trim() || 'case-sheet';
  return `${base}.pdf`;
}

/**
 * A finished case sheet: the PDF (in the page on desktop; the words +
 * "Open the PDF" on tablets), then Download / Share (the tablet's share
 * sheet, where the browser has one), Amend (a new draft) and Delete.
 */
@Component({
  selector: 'app-final-view',
  standalone: true,
  imports: [PfIconComponent, SkeletonRowsComponent, NarrativeCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-body pf-body--split">
      <section class="pf-card main" aria-labelledby="fv-h">
        <header class="pf-card__head">
          <span class="pf-card__icon"><pf-icon name="file" [size]="16" /></span>
          <h1 class="pf-card__label" id="fv-h">Case sheet</h1>
          <span class="pf-card__note">Finished {{ finishedOn() }}. Read-only — use Amend to change it.</span>
        </header>
        <div class="pf-card__body fv-body">
          @if (frame()) {
            @if (pdfUrl(); as url) {
              <iframe class="fv-frame" [src]="url" title="Case sheet PDF"></iframe>
            } @else if (pdfError()) {
              <p class="fe-field__hint">{{ pdfError() }}</p>
            } @else {
              <pf-skeleton-rows [rows]="8" label="Opening the PDF" />
            }
          } @else {
            <article class="fv-doc" aria-label="What the case sheet says">
              <app-narrative-card
                [narrative]="session().narrative()"
                [state]="session().narrativeState()"
                [readOnly]="true"
              />
            </article>
          }
        </div>
      </section>
      <aside class="pf-card side" aria-labelledby="fv-act">
        <header class="pf-card__head">
          <span class="pf-card__icon"><pf-icon name="share" [size]="16" /></span>
          <h2 class="pf-card__label" id="fv-act">PDF</h2>
        </header>
        <div class="pf-card__body fv-acts">
          <p class="fv-note">
            {{ nav.isLab ? "The PDF carries the lab's letterhead and your signature." : 'The PDF carries your practice header and signature from Settings.' }}
          </p>
          <button type="button" class="pf-btn pf-btn--secondary fv-btn" [disabled]="busy()" (click)="download()">
            <pf-icon name="download" [size]="18" /> Download
          </button>
          @if (canShare()) {
            <button type="button" class="pf-btn pf-btn--secondary fv-btn" [disabled]="busy()" (click)="share()">
              <pf-icon name="share" [size]="18" /> Share
            </button>
          }
          <button type="button" class="pf-btn pf-btn--secondary fv-btn" [disabled]="busy()" (click)="amend()">
            <pf-icon name="pen" [size]="18" /> Amend
          </button>
          <!-- a lab never deletes a finished sheet (plan §3.1: Amend = a new version); the personal space may -->
          @if (!nav.isLab) {
          <button type="button" class="pf-btn pf-btn--danger fv-btn" [disabled]="busy()" (click)="remove()">
            <pf-icon name="trash" [size]="18" /> Delete
          </button>
          }
          @if (message()) {
            <p class="fe-field__hint" role="status">{{ message() }}</p>
          }
        </div>
        <footer class="pf-card__foot">
          <button type="button" class="pf-btn pf-btn--primary pf-span" [disabled]="busy()" (click)="print()" data-fv-print>
            <pf-icon name="file" [size]="18" /> Print the PDF
          </button>
        </footer>
      </aside>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .fv-body {
        padding: 22px 24px;
      }
      .fv-frame {
        flex: 1 1 auto;
        width: 100%;
        min-height: 70vh;
        border: 1px solid var(--pf-line);
        border-radius: 12px;
        background: #fff;
      }
      .fv-doc {
        max-width: 760px;
      }
      .fv-acts {
        gap: 10px;
      }
      .fv-btn {
        justify-content: flex-start;
      }
      .fv-note {
        margin: 0 0 4px;
        font-size: 13px;
        color: var(--text-tertiary);
      }
    `,
  ],
})
export class FinalViewComponent {
  readonly session = input.required<CaseSession>();
  private readonly api = inject(CasesApi);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly nav = inject(CasesheetNav);

  protected readonly frame = signal(prefersPdfFrame());
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly pdfError = signal('');
  private readonly blob = signal<Blob | null>(null);
  private objectUrl: string | null = null;
  protected readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  protected readonly canShare = signal(typeof navigator !== 'undefined' && typeof navigator.share === 'function');

  protected readonly finishedOn = computed(() => {
    const d = this.session().sheet()?.finalisedAt;
    return d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  });
  private readonly fileName = computed(() => {
    const s = this.session().sheet();
    return pdfFileName(s?.patient.name, s?.formTitle, s?.finalisedAt);
  });

  constructor() {
    effect(() => {
      const s = this.session().sheet();
      if (s?.state === 'final' && this.frame()) untracked(() => void this.loadPdf());
    });
    inject(DestroyRef).onDestroy(() => this.objectUrl && URL.revokeObjectURL(this.objectUrl));
  }

  private async pdf(): Promise<Blob> {
    const have = this.blob();
    if (have) return have;
    const id = this.session().sheet()!.id;
    const b = await this.api.casePdf(id);
    this.blob.set(b);
    return b;
  }

  private async loadPdf(): Promise<void> {
    try {
      const b = await this.pdf();
      this.objectUrl = URL.createObjectURL(b);
      this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
    } catch {
      this.pdfError.set("Couldn't open the PDF just now. Use Download or try again.");
    }
  }

  private async run(work: () => Promise<void>, failure: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      await work();
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') this.message.set(failure);
    } finally {
      this.busy.set(false);
    }
  }

  /** Print through the LMS's one PDF print path (off-screen A4 frame, shared with lab reports) — the bytes came with the session. */
  protected print(): Promise<void> {
    return this.run(async () => {
      const b = await this.pdf();
      printPdfBlobUrl(URL.createObjectURL(b), { revokeOnDone: true });
    }, "Couldn't print the PDF just now. Use Download or try again.");
  }

  protected download(): Promise<void> {
    return this.run(async () => {
      const b = await this.pdf();
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.fileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.message.set('Downloaded.');
    }, "Couldn't download the PDF just now. Please try again.");
  }

  protected share(): Promise<void> {
    return this.run(async () => {
      const b = await this.pdf();
      const file = new File([b], this.fileName(), { type: 'application/pdf' });
      const data: ShareData = { files: [file], title: this.fileName() };
      if (navigator.canShare && !navigator.canShare(data)) {
        await this.download();
        return;
      }
      await navigator.share(data);
    }, "Couldn't share the PDF from this browser. Use Download instead.");
  }

  protected amend(): Promise<void> {
    return this.run(async () => {
      const ok = await this.dialog.confirm({
        title: 'Amend this case sheet?',
        message: 'A new draft starts with the same answers. This finished sheet and its PDF stay as they are.',
        confirmLabel: 'Start the amendment',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
      const draft = await this.api.amendCase(this.session().sheet()!.id);
      await this.router.navigateByUrl(this.nav.sheet(draft.id));
    }, "Couldn't start the amendment just now. Please try again.");
  }

  protected remove(): Promise<void> {
    return this.run(async () => {
      const ok = await this.dialog.confirm({
        title: 'Delete this case sheet?',
        message: 'It disappears from your cases and its PDF is removed after the retention period.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
        tone: 'danger',
      });
      if (!ok) return;
      await this.api.deleteCase(this.session().sheet()!.id);
      await this.router.navigateByUrl(this.nav.list(this.session().sheet()?.patientId));
    }, "Couldn't delete it just now. Please try again.");
  }
}
