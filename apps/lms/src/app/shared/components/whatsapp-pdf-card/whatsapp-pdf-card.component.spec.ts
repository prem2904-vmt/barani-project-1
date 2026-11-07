import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { WaPdfCard, WhatsAppManualService } from '../../../core/services/whatsapp-manual.service';
import { WhatsAppPdfCardComponent } from './whatsapp-pdf-card.component';

/** WhatsApp Chat on web / phones: the "Report PDF" card beside the chat. */
const CARD = (o: Partial<WaPdfCard> = {}): WaPdfCard => ({
  name: 'report-AB.pdf', blob: new Blob(['%PDF-1.4']), text: 'Dear Asha, ... https://x/reports/public/t', canShare: false, chatUrl: null, mode: 'popup', ...o,
});

function setup(card: WaPdfCard | null, bridge: unknown = null) {
  TestBed.configureTestingModule({ imports: [WhatsAppPdfCardComponent] });
  const svc = TestBed.inject(WhatsAppManualService);
  svc.pdfCard.set(card);
  const f = TestBed.createComponent(WhatsAppPdfCardComponent);
  f.componentInstance.bridge = (() => bridge) as never;
  f.detectChanges();
  return { f, svc, el: f.nativeElement as HTMLElement };
}
afterEach(() => TestBed.resetTestingModule());
const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;

describe('WhatsAppPdfCardComponent', () => {
  it('nothing to show → nothing rendered', () => {
    expect(setup(null).el.querySelector('[data-testid="wa-pdf-card"]')).toBeNull();
  });

  it('no file share: Download PDF is the primary, with the paperclip hint; no Share button', () => {
    const { el } = setup(CARD());
    expect(q(el, 'wa-pdf-share')).toBeNull();
    const dl = q(el, 'wa-pdf-download')!;
    expect(dl.className).toContain('pf-btn--primary');
    expect(q(el, 'wa-pdf-card-hint')!.textContent).toContain('paperclip');
    expect(el.textContent).toContain('report-AB.pdf');
  });

  it('file share: Share PDF is the primary, Download PDF the secondary', () => {
    const { el, svc } = setup(CARD({ canShare: true }));
    const share = vi.spyOn(svc, 'sharePdf').mockResolvedValue(true);
    expect(q(el, 'wa-pdf-share')!.className).toContain('pf-btn--primary');
    expect(q(el, 'wa-pdf-download')!.className).toContain('pf-btn--secondary');
    q(el, 'wa-pdf-share')!.click();
    expect(share).toHaveBeenCalled();
  });

  it('phone: Share PDF primary, the chat with the link secondary, as a bottom card', () => {
    const { el, svc } = setup(CARD({ canShare: true, mode: 'phone', chatUrl: 'https://wa.me/91' }));
    const open = vi.spyOn(svc, 'openChatFromCard').mockImplementation(() => {});
    expect(el.querySelector('.pf-wpc--phone')).not.toBeNull();
    expect(q(el, 'wa-pdf-chat')!.className).toContain('pf-btn--tertiary');
    q(el, 'wa-pdf-chat')!.click();
    expect(open).toHaveBeenCalled();
  });

  it('close hides it; an SVG icon, no emoji, no "AI"', () => {
    const { el, svc, f } = setup(CARD({ canShare: true }));
    expect(el.querySelectorAll('svg').length).toBeGreaterThan(1);
    expect(el.textContent).not.toMatch(/\bAI\b|[\u{1F300}-\u{1FAFF}]/u);
    q(el, 'wa-pdf-card-close')!.click();
    f.detectChanges();
    expect(svc.pdfCard()).toBeNull();
    expect(el.querySelector('[data-testid="wa-pdf-card"]')).toBeNull();
  });

  it('the desktop app shows no card (its docked panel carries the PDF strip)', () => {
    expect(setup(CARD(), {}).el.querySelector('[data-testid="wa-pdf-card"]')).toBeNull();
  });
});
