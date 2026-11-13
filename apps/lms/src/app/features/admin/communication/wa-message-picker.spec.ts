import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { WaMessageChoice, WaMessageMenu, WaSettings, waFillTemplate } from '../../../core/services/whatsapp.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { WaMessagePickerComponent } from './wa-message-picker.component';

/**
 * Lab settings → WhatsApp → the message picker: only the APPROVED templates
 * the server lists, as labels (never codes); the language as a chip when
 * there is one, a pf-select when several; a live WhatsApp-style preview
 * rendered from the server's components with the lab's name; the PDF variant
 * only when approved (pending ones named in a hint); a pick PUTs code +
 * language; no native controls.
 */

const LINK_BODY = 'Hello {{1}}, your lab test report from {{2}} is ready. Tap the button below to view your report.';
const PDF_BODY = 'Hello {{1}}, your lab test report from {{2}} is ready. Your report is attached. You can also tap the button below to view it online.';

const LINK = (over: Partial<WaMessageChoice> = {}): WaMessageChoice => ({
  kind: 'link', code: 'lab_report_ready', label: 'Report ready — link', status: 'APPROVED', approved: true,
  languages: [{ code: 'en', label: 'English' }],
  components: { header: null, body: LINK_BODY, footer: null, buttons: [{ type: 'URL', text: 'View report' }] },
  ...over,
});
const PDF = (over: Partial<WaMessageChoice> = {}): WaMessageChoice => ({
  kind: 'pdf', code: 'lab_report_pdf', label: 'Report ready — PDF + link', status: 'APPROVED', approved: true,
  languages: [{ code: 'en', label: 'English' }],
  components: { header: { format: 'DOCUMENT' }, body: PDF_BODY, footer: null, buttons: [{ type: 'URL', text: 'View report' }] },
  ...over,
});
const MENU = (over: Partial<WaMessageMenu> = {}): WaMessageMenu => ({
  sender: 'tenant', senderLine: 'Micro World Labs +91 98765 43210', kind: 'link', code: 'lab_report_ready', language: 'en', chosenKind: null,
  labName: 'Micro World Labs', templates: [LINK()], pending: [],
  sample: { bodyParams: ['Asha', 'Micro World Labs'], buttonUrl: 'https://reports.example/reports/public/abc', documentFilename: 'Report-Asha-2026-09-29.pdf' },
  ...over,
});
const SETTINGS = (message: WaMessageMenu | null): WaSettings => ({
  autoSendEnabled: true, sendUpdatedReports: false, message,
  sender: { source: 'tenant', state: 'connected', status: 'connected', tokenStored: true, canConnect: true },
  platform: { enabled: true, configured: true, webhookConfigured: true, defaultTemplateName: 'lab_report_ready', defaultTemplateLanguage: 'en' },
});

function make(menu: WaMessageMenu | null, opts: { canEdit?: boolean; putFails?: boolean } = {}) {
  const api = {
    get: vi.fn(() => of(SETTINGS(menu))),
    post: vi.fn(() => of({})),
    put: vi.fn((_url: string, body: { templateCode?: string; templateLanguage?: string | null }) => opts.putFails
      ? throwError(() => new ApiError('Pick one of the messages listed for your WhatsApp number.', 'invalid_template'))
      : of(SETTINGS(menu ? { ...menu, code: body.templateCode ?? menu.code, chosenKind: body.templateCode === 'lab_report_pdf' ? 'pdf' : 'link',
        kind: body.templateCode === 'lab_report_pdf' ? 'pdf' : 'link', language: body.templateLanguage ?? menu.language } : null))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    imports: [WaMessagePickerComponent],
    providers: [{ provide: ApiService, useValue: api }, { provide: ToastService, useValue: toasts }],
  });
  const f = TestBed.createComponent(WaMessagePickerComponent);
  f.componentRef.setInput('settings', SETTINGS(menu));
  f.componentRef.setInput('canEdit', opts.canEdit ?? true);
  const changed = vi.fn();
  f.componentInstance.changed.subscribe(changed);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { f, el, q, api, toasts, changed, cmp: f.componentInstance };
}

/** The pf-select's rendered option labels (its trigger + list). */
const optionLabels = (host: HTMLElement) => [...host.querySelectorAll('[role="option"], .pf-dd__opt, li')].map(o => o.textContent!.trim());

describe('WhatsApp message picker', () => {
  it('lists only the approved templates as labels (never codes), the language as a chip, and previews the body with the lab name', () => {
    const p = make(MENU({ pending: [{ kind: 'pdf', label: 'Report ready — PDF + link', status: 'PENDING' }] }));
    const picker = p.q('wa-message-picker')!;
    expect(picker.getAttribute('data-kind')).toBe('link');
    const sel = p.q('wmp-message')!;
    expect(sel.tagName.toLowerCase()).toBe('pf-select');
    expect(sel.textContent).toContain('Report ready — link');
    expect(picker.textContent).not.toContain('lab_report_ready');
    expect(picker.textContent).not.toContain('lab_report_pdf');
    // One language → a read-only chip, no dropdown.
    expect(p.q('wmp-language')).toBeNull();
    expect(p.q('wmp-language-chip')!.textContent).toContain('English');
    // The pending PDF variant is named, not offered.
    expect(p.q('wmp-pending')!.textContent).toContain('Report ready — PDF + link');
    expect(p.q('wmp-pending')!.textContent).toContain("waiting for Meta's review");
    // Preview: body from the server's components, filled with the sample; the button; the sender.
    expect(p.q('wmp-body')!.textContent).toBe('Hello Asha, your lab test report from Micro World Labs is ready. Tap the button below to view your report.');
    expect(p.q('wmp-doc')).toBeNull();
    expect(p.q('wmp-button')!.textContent).toContain('View report');
    expect(p.q('wmp-from')!.textContent).toContain('Sent from: Micro World Labs +91 98765 43210');
    // Never a native control.
    expect(p.el.querySelector('select, datalist, input[type="text"], textarea')).toBeNull();
  });

  it('the PDF variant appears once approved and is the automatic choice; its preview shows the document chip with the filename', () => {
    const p = make(MENU({ kind: 'pdf', code: 'lab_report_pdf', templates: [LINK(), PDF()] }));
    expect(p.q('wa-message-picker')!.getAttribute('data-kind')).toBe('pdf');
    expect(p.q('wmp-message')!.textContent).toContain('Report ready — PDF + link');
    expect(p.q('wmp-doc')!.textContent).toContain('Report-Asha-2026-09-29.pdf');
    expect(p.q('wmp-doc')!.textContent).toContain('PDF');
    expect(p.q('wmp-body')!.textContent).toContain('Your report is attached');
    expect(p.q('wmp-pending')).toBeNull();
  });

  it('picking a message PUTs its code + language and emits the server copy; a refused pick toasts and reverts', () => {
    const p = make(MENU({ kind: 'pdf', code: 'lab_report_pdf', templates: [LINK(), PDF()] }));
    p.cmp.pick('lab_report_ready');
    p.f.detectChanges();
    expect(p.api.put).toHaveBeenCalledWith('/api/whatsapp/settings',
      { autoSendEnabled: true, sendUpdatedReports: false, templateCode: 'lab_report_ready', templateLanguage: 'en' });
    expect(p.changed).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ kind: 'link' }) }));
    expect(p.toasts.success).toHaveBeenCalledWith('Patients will get "Report ready — link"');
    TestBed.resetTestingModule();

    const bad = make(MENU({ templates: [LINK(), PDF()] }), { putFails: true });
    bad.cmp.pick('lab_report_pdf');
    bad.f.detectChanges();
    expect(bad.toasts.error).toHaveBeenCalledWith('Pick one of the messages listed for your WhatsApp number.');
    expect(bad.changed).not.toHaveBeenCalled();
    expect(bad.q('wmp-message')!.textContent).toContain('Report ready — link');   // reverted
  });

  it('several approved languages → a Language dropdown with readable names; picking one PUTs it', () => {
    const p = make(MENU({ templates: [LINK({ languages: [{ code: 'en', label: 'English' }, { code: 'ta', label: 'Tamil' }] })] }));
    expect(p.q('wmp-language-chip')).toBeNull();
    const lang = p.q('wmp-language')!;
    expect(lang.tagName.toLowerCase()).toBe('pf-select');
    expect(lang.textContent).toContain('English');
    p.cmp.pickLanguage('ta');
    expect(p.api.put).toHaveBeenCalledWith('/api/whatsapp/settings',
      { autoSendEnabled: true, sendUpdatedReports: false, templateCode: 'lab_report_ready', templateLanguage: 'ta' });
  });

  it('read-only (no permission): the dropdown is disabled and a pick does nothing', () => {
    const p = make(MENU({ templates: [LINK(), PDF()] }), { canEdit: false });
    expect(p.q('wmp-message')!.querySelector('button, [role="combobox"]')?.hasAttribute('disabled') ?? true).toBe(true);
    p.cmp.pick('lab_report_pdf');
    expect(p.api.put).not.toHaveBeenCalled();
  });

  it('shared number: the platform template says it is sent from the shared number; nothing approved shows a chip; no menu renders nothing', () => {
    const p = make(MENU({ sender: 'platform', senderLine: "Prefrontal's shared number", templates: [LINK({ code: 'report_ready' })] }));
    expect(p.q('wmp-from')!.textContent).toContain("Prefrontal's shared number");
    TestBed.resetTestingModule();
    const none = make(MENU({ templates: [], pending: [{ kind: 'link', label: 'Report ready — link', status: 'REJECTED', reason: 'INVALID_FORMAT' }] }));
    expect(none.q('wmp-none')!.textContent).toContain('No approved message yet');
    expect(none.q('wmp-pending')!.textContent).toContain('was rejected by Meta (INVALID_FORMAT)');
    expect(none.q('wmp-preview')).toBeNull();
    TestBed.resetTestingModule();
    const old = make(null);
    expect(old.q('wa-message-picker')).toBeNull();
  });

  it('fills {{n}} placeholders from the sample in order', () => {
    expect(waFillTemplate('Hi {{1}}, from {{2}}. {{3}}', ['Asha', 'Micro World'])).toBe('Hi Asha, from Micro World. ');
  });
});
