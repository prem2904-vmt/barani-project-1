import {
  ChangeDetectionStrategy, Component, ElementRef, effect, input, signal, viewChild,
} from '@angular/core';

/**
 * Renders a PDF (blob: or http URL) to fit-to-width canvases via pdf.js — the
 * same approach the report viewer uses — so reports/documents fit any screen
 * (mobile included) instead of overflowing inside a raw <iframe> PDF viewer.
 * Each page is drawn at container-width × devicePixelRatio for crispness and
 * CSS-scaled to 100%. `maxPages` (0 = all) caps pages for compact previews.
 */
@Component({
  selector: 'pf-pdf-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-pdfc" #host>
      @if (loading()) { <span class="pf-pdfc__spin"></span> }
      @if (error()) { <p class="pf-pdfc__err">Couldn't render this file.</p> }
    </div>
  `,
  styles: [`
    /* The host is a custom element (defaults to inline) — force block + full
       width + min-width:0 so canvases scale to the container, not overflow. */
    :host { display: block; width: 100%; min-width: 0; max-width: 100%; }
    .pf-pdfc { width: 100%; min-width: 0; max-width: 100%; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    /* ::ng-deep so the rule reaches the imperatively-created canvas (which has
       no scoped attribute) — same pattern as the report viewer. */
    .pf-pdfc ::ng-deep canvas, .pf-pdfc canvas { width: 100%; max-width: 100%; height: auto; display: block; border-radius: 6px; box-shadow: 0 2px 14px rgba(0,0,0,0.28); background: #fff; }
    .pf-pdfc__spin { width: 26px; height: 26px; border-radius: 50%; border: 2.5px solid rgba(168,85,247,0.3); border-top-color: #a855f7; animation: pf-pdfc-spin .7s linear infinite; margin: 24px; }
    .pf-pdfc__err { color: var(--text-tertiary); font-size: 12px; padding: 20px; }
    @keyframes pf-pdfc-spin { to { transform: rotate(360deg); } }
  `],
})
export class PdfCanvasComponent {
  readonly src = input.required<string>();
  readonly maxPages = input<number>(0);
  private readonly hostEl = viewChild<ElementRef<HTMLDivElement>>('host');
  readonly loading = signal(false);
  readonly error = signal(false);
  private token = 0;

  constructor() {
    effect(() => { const s = this.src(); this.hostEl(); if (s) queueMicrotask(() => this.render(s)); });
  }

  private async render(src: string) {
    const host = this.hostEl()?.nativeElement;
    if (!host) return;
    const my = ++this.token;
    this.loading.set(true); this.error.set(false);
    host.querySelectorAll('canvas').forEach(c => c.remove());
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjs: any = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
      // Fetch the bytes ourselves (works for blob: and same-origin URLs) and
      // hand pdf.js the raw data — same recipe as the report viewer.
      const buf = await fetch(src).then(r => r.arrayBuffer());
      if (my !== this.token) return;
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      if (my !== this.token) return;
      const cssWidth = Math.max(host.clientWidth || 0, 300);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const limit = this.maxPages() > 0 ? Math.min(this.maxPages(), doc.numPages) : doc.numPages;
      for (let i = 1; i <= limit; i++) {
        if (my !== this.token) return;
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = (cssWidth / base.width) * dpr;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        // Inline styles: the canvas is created imperatively, so Angular's
        // scoped component CSS never matches it — set the fit-width sizing here.
        canvas.style.cssText = 'width:100%;max-width:100%;height:auto;display:block;border-radius:6px;box-shadow:0 2px 14px rgba(0,0,0,0.28);background:#fff;';
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        if (my !== this.token) return;
        host.appendChild(canvas);
      }
    } catch { this.error.set(true); }
    finally { if (my === this.token) this.loading.set(false); }
  }
}
