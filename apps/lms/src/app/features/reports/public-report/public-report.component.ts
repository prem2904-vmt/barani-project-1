import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { shareLink } from '../../../shared/utils/report-share';
import {
  ReportLinkInfo, ReportSummary, VerifiedReport, clock, mismatchMessage, reportFileName, safeLogoUrl, summarise, telHref,
} from './public-report.util';

/** Every screen the page can be on. */
export type PublicReportView =
  | 'loading'    // reading the link (skeleton)
  | 'invalid'    // unknown token
  | 'expired'    // the link's 30 days are up
  | 'verify'     // identity step (the ONLY way in)
  | 'locked'     // too many wrong answers — wait, or call the lab
  | 'opening'    // verified; preparing the PDF (skeleton)
  | 'ready'      // the report card: Download / View / Share
  | 'not-ready'; // verified, but the lab has not released a PDF yet

interface ApiEnvelope<T> { success?: boolean; data?: T; error?: string; message?: string }

/**
 * PUBLIC patient report page — the link patients get on WhatsApp
 * (`lab_report_ready` → /reports/public/{token}) and the report QR.
 *
 * No login, no app chrome: the lab's identity, then the identity step (last
 * digits of the phone / DOB as DDMM / invoice number — checked on the SERVER,
 * which counts wrong answers per link and locks it out), then one card with
 * the report's details and a big Download. Nothing about the patient is on
 * screen — or fetched — before the server accepts the answer.
 */
@Component({
  selector: 'pf-public-report',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pr', lang: 'en' },
  templateUrl: './public-report.component.html',
  styleUrl: './public-report.component.scss',
})
export class PublicReportComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  private readonly api = environment.apiUrl.replace(/\/$/, '');
  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  protected readonly view = signal<PublicReportView>('loading');
  protected readonly link = signal<ReportLinkInfo | null>(null);
  protected readonly result = signal<VerifiedReport | null>(null);
  protected readonly summary = computed<ReportSummary | null>(() => {
    const r = this.result();
    return r ? summarise(r) : null;
  });

  // ── identity step ──
  protected readonly secret = signal('');
  protected readonly mode = signal<'digits' | 'invoice'>('digits');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly lockLeft = signal(0);
  private lockTimer: ReturnType<typeof setInterval> | null = null;

  // ── report actions ──
  /** The PDF when we hold its bytes (rendered here, or fetched for Share). */
  private blob: Blob | null = null;
  private blobUrl: string | null = null;
  protected readonly viewUrl = signal<string | null>(null);
  protected readonly downloading = signal(false);
  protected readonly note = signal<string | null>(null);

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('secretInput');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('readyHeading');

  // ── lab identity (from the link, then from the verified payload) ──
  protected readonly labName = computed(() =>
    this.link()?.lab?.name?.trim() || this.result()?.org?.trim() || 'Your lab');
  protected readonly hasLab = computed(() => !!(this.link()?.lab?.name?.trim() || this.result()?.org?.trim()));
  protected readonly labPhone = computed(() => this.link()?.lab?.phone?.trim() || null);
  protected readonly labTel = computed(() => telHref(this.labPhone()));
  protected readonly logo = computed(() => safeLogoUrl(this.link()?.lab?.logoUrl, this.api));
  protected readonly logoFailed = signal(false);
  protected readonly initials = computed(() =>
    this.labName().split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || 'L');

  protected readonly fileName = computed(() => {
    const r = this.result(); const s = this.summary();
    return r?.fileName || reportFileName(s?.name, s?.date ?? null);
  });

  protected readonly placeholder = computed(() => this.mode() === 'digits' ? 'e.g. 3210' : 'e.g. INV-001234');

  ngOnInit(): void {
    // A private, per-patient page: never indexed, never leak the token-bearing
    // URL to another site through the Referer header.
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow, noarchive' });
    this.meta.updateTag({ name: 'referrer', content: 'no-referrer' });
    this.title.setTitle('Your lab report');

    this.destroyRef.onDestroy(() => {
      this.stopLockTimer();
      if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
      this.meta.removeTag("name='robots'");
      this.meta.removeTag("name='referrer'");
    });

    void this.loadLink();
  }

  /** Lab identity + link state. An older API without this call (404) or a
   *  network hiccup still lands on the identity step — verify decides. */
  private async loadLink(): Promise<void> {
    // Hand-off from the tracking page: the patient already verified there and
    // the answer rides in navigation state — go straight to the report.
    const carried = (typeof history !== 'undefined' ? history.state as { secret?: unknown } | null : null)?.secret;
    const linkCall = firstValueFrom(this.http.get<ApiEnvelope<ReportLinkInfo>>(`${this.api}/api/public/report/${encodeURIComponent(this.token)}`))
      .then(res => (res?.success && res.data ? res.data : null))
      .catch(() => null);

    if (typeof carried === 'string' && carried.trim()) {
      this.secret.set(carried.trim());
      this.view.set('opening');
      void linkCall.then(info => { if (info) this.link.set(info); });
      await this.verify();
      return;
    }

    const info = await linkCall;
    this.link.set(info);
    if (info?.lab?.name) this.title.setTitle(`Your lab report · ${info.lab.name}`);
    if (info?.state === 'invalid') { this.view.set('invalid'); return; }
    if (info?.state === 'expired') { this.view.set('expired'); return; }
    if ((info?.lockedSeconds ?? 0) > 0) { this.startLock(info!.lockedSeconds!); return; }
    this.view.set('verify');
  }

  protected setMode(m: 'digits' | 'invoice'): void {
    if (this.mode() === m) return;
    this.mode.set(m);
    this.secret.set('');
    this.error.set(null);
    queueMicrotask(() => this.input()?.nativeElement.focus());
  }

  /** Keep the field above the on-screen keyboard (it opens after focus). */
  protected onInput(e: Event): void {
    this.secret.set((e.target as HTMLInputElement).value);
    if (this.error()) this.error.set(null);
  }

  protected onSubmit(e: Event): void {
    e.preventDefault();
    void this.verify();
  }

  protected onFocus(): void {
    setTimeout(() => this.input()?.nativeElement.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 320);
  }

  async verify(): Promise<void> {
    const secret = this.secret().trim();
    if (!secret || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<VerifiedReport & { attemptsLeft?: number; retryAfterSeconds?: number }>>(
        `${this.api}/api/public/report/${encodeURIComponent(this.token)}/verify`, { secret }));
      if (res?.success && res.data) {
        this.secret.set('');
        await this.open(res.data);
        return;
      }
      if (res?.error === 'locked') {
        this.startLock(res.data?.retryAfterSeconds ?? 60);
        return;
      }
      if (this.view() === 'opening') this.view.set('verify');   // hand-off answer no longer matches
      this.error.set(mismatchMessage(res?.data?.attemptsLeft));
      this.secret.set('');
      queueMicrotask(() => this.input()?.nativeElement.focus());
    } catch (e) {
      if (this.view() === 'opening') this.view.set('verify');
      const status = (e as HttpErrorResponse)?.status;
      this.error.set(status === 429
        ? 'Too many tries from this network. Wait a minute and try again.'
        : "Couldn't reach the lab right now. Check your connection and try again.");
    } finally {
      this.busy.set(false);
    }
  }

  /** Verified: pick the PDF source, then show the report card. */
  private async open(data: VerifiedReport): Promise<void> {
    this.result.set(data);
    this.view.set('opening');
    if (data.reportPdfUrl) {
      this.viewUrl.set(data.reportPdfUrl);
      this.showReady();
      void this.prefetchForShare(data.reportPdfUrl);
      return;
    }
    if (data.report?.data) {
      const ok = await this.renderFromSnapshot(data);
      if (ok) { this.showReady(); return; }
    }
    this.view.set('not-ready');
  }

  private showReady(): void {
    this.view.set('ready');
    setTimeout(() => this.heading()?.nativeElement.focus(), 0);
  }

  /** No archived PDF: build it here from the verified snapshot with the same
   *  renderer the staff app uses (lazy — only this rare path loads jsPDF). */
  private async renderFromSnapshot(data: VerifiedReport): Promise<boolean> {
    try {
      const { buildReportPdf, preloadReportImages } = await import('../../../shared/utils/report-pdf');
      const baseInput = {
        report: data.report as { id: string; type: string; createdAt?: string; data?: string | null },
        template: (data.template ?? null) as never,
        resolvedLayouts: {},
      };
      const imageCache = await preloadReportImages(baseInput, environment.apiUrl, data.assetUrls);
      this.setBlob(buildReportPdf({ ...baseInput, imageCache }).output('blob'));
      return true;
    } catch (e) {
      console.error('[public-report] client render failed', e);
      return false;
    }
  }

  private setBlob(blob: Blob): void {
    this.blob = blob;
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = URL.createObjectURL(blob);
    if (!this.result()?.reportPdfUrl) this.viewUrl.set(this.blobUrl);
  }

  /** Share-a-file needs the bytes in hand at tap time (iOS drops the user
   *  gesture across a slow fetch). Only where file sharing exists; a storage
   *  bucket without CORS simply leaves Share on the link. */
  private async prefetchForShare(url: string): Promise<void> {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.canShare !== 'function' || typeof File === 'undefined') return;
    try {
      const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (!r.ok) return;
      const b = await r.blob();
      if (b.size > 0) { this.blob = b; }
    } catch { /* cross-origin without CORS — link share only */ }
  }

  // ── actions ──

  /** Save the PDF as a real file with a readable name. */
  protected download(): void {
    const r = this.result();
    if (!r || this.downloading()) return;
    this.downloading.set(true);
    setTimeout(() => this.downloading.set(false), 1600);
    if (this.blob) { saveBlob(this.blob, this.fileName()); return; }
    // The API signs an attachment URL with the file name — a cross-origin
    // <a download> is ignored by browsers, the Content-Disposition is not.
    if (r.reportPdfDownloadUrl) { clickLink(r.reportPdfDownloadUrl); return; }
    if (r.reportPdfUrl) { clickLink(r.reportPdfUrl, true); }
  }

  protected async share(): Promise<void> {
    const title = `Lab report · ${this.labName()}`;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (this.blob && typeof File !== 'undefined' && typeof nav.canShare === 'function') {
      const file = new File([this.blob], this.fileName(), { type: 'application/pdf' });
      if (nav.canShare({ files: [file] })) {
        try { await nav.share({ files: [file], title }); return; }
        catch (e) { if ((e as { name?: string })?.name === 'AbortError') return; }
      }
    }
    // The page link itself is safe to share: it still asks for the answer.
    const out = await shareLink({ title, text: `${title} — open the link to view it.`, url: location.href });
    if (out === 'copied') this.flash('Link copied');
    else if (out === 'failed') this.flash("Couldn't share on this device");
  }

  protected partnerUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `${this.api}${url}`;
  }

  protected onLogoError(): void { this.logoFailed.set(true); }

  // ── lockout ──

  private startLock(seconds: number): void {
    this.stopLockTimer();
    this.error.set(null);
    this.lockLeft.set(Math.max(1, Math.ceil(seconds)));
    this.view.set('locked');
    this.lockTimer = setInterval(() => {
      const left = this.lockLeft() - 1;
      if (left <= 0) {
        this.stopLockTimer();
        this.lockLeft.set(0);
        this.view.set('verify');
      } else {
        this.lockLeft.set(left);
      }
    }, 1000);
  }

  private stopLockTimer(): void {
    if (this.lockTimer) { clearInterval(this.lockTimer); this.lockTimer = null; }
  }

  protected readonly lockClock = computed(() => clock(this.lockLeft()));

  private flash(msg: string): void {
    this.note.set(msg);
    setTimeout(() => this.note.set(null), 2400);
  }

  protected formatDate(d: Date | null): string {
    if (!d) return '';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}

/** Save bytes as a file: an object URL + <a download> (iOS 13+ Safari,
 *  Android Chrome, desktop). */
export function saveBlob(blob: Blob, fileName: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Follow a URL from a tap (keeps the user gesture; attachments download
 *  without leaving the page, `newTab` opens the browser's viewer). */
export function clickLink(href: string, newTab = false, doc: Document = document): void {
  const a = doc.createElement('a');
  a.href = href;
  a.rel = 'noopener noreferrer';
  if (newTab) a.target = '_blank';
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
}
