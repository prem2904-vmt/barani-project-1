import { signal, computed } from '@angular/core';
import { readFileSync } from 'node:fs';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { REPORT_TABS, ReportTemplateComponent } from './report-template.component';
import { REPORT_FIND, findReportSettings } from './report-find';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';

/**
 * Report design is ONE page (owner 2026-11-17, "why don't we include all in one"): the band keeps one tab
 * strip — the design tabs plus Technician notes and Sending — a search pill that finds a setting on any tab,
 * and one save state. No "Report options" button or second page. Methods run against stubs (no TestBed),
 * the template is checked from the source.
 */
const SRC = readFileSync('apps/lms/src/app/features/admin/report-template/report-template.component.ts', 'utf8');
const TEMPLATE = SRC.slice(SRC.indexOf('template: `'), SRC.indexOf('styles: [`'));
const proto = ReportTemplateComponent.prototype as any;

describe('Report design — one page, one band', () => {
  it('one tab strip: the six design tabs, then Technician notes and Sending', () => {
    expect(REPORT_TABS).toEqual(['letterhead', 'patient', 'columns', 'table', 'sequence', 'footer', 'notes', 'sending']);
    // The Settings panel and the old Lab links read the same two ids on the same page.
    expect(LAB_PAGES.reportOptions.path).toBe('/admin/reports');
    expect(LAB_PAGES.reportOptions.categories.map(c => c.id)).toEqual(['notes', 'sending']);
  });

  it('the band has the search pill + the tabs, and no Report options button or second segmented', () => {
    expect(TEMPLATE).not.toContain('rt-report-options');
    expect(TEMPLATE).not.toContain('Report options');
    expect(TEMPLATE).not.toMatch(/<pf-hero-band[^>]*\[tabsOnly\]/);
    expect(TEMPLATE).toMatch(/<pf-hero-band[^>]*placeholder="Find a report setting"/);
    expect((TEMPLATE.match(/<pf-segmented class="pf-hb-tabs/g) ?? []).length).toBe(1);
  });

  it('never two Save buttons: notes and sending report into the ONE band save state', () => {
    expect((TEMPLATE.match(/\(click\)="save\(\)"/g) ?? []).length).toBe(1);
    expect(TEMPLATE).toContain('(savingChange)="sendingSaving.set($event)"');
    expect(TEMPLATE).toMatch(/@if \(optionsSaving\(\)\)[\s\S]{0,200}Saving…/);
  });

  it('notes and sending render in the same body frame as the other tabs', () => {
    const work = TEMPLATE.slice(TEMPLATE.indexOf('<div class="pf-rt-work">'), TEMPLATE.indexOf('<aside class="pf-rt-aside"'));
    expect(work).toContain("@case ('notes')");
    expect(work).toContain("@case ('sending')");
    expect(work).toContain('<pf-report-sending-card');
    expect(work).toContain('data-testid="ls-tech-notes"');
  });
});

describe('Report design › Technician notes', () => {
  const make = (patch: () => unknown) => {
    const toasts = { success: vi.fn(), error: vi.fn() };
    const api = { get: vi.fn(() => of({ techReportNotes: true })), patch: vi.fn(patch) };
    const self: any = { api, toasts, techNotes: signal<boolean | null>(null), notesSaving: signal(0), sendingSaving: signal(false), notesLoading: false };
    self.optionsSaving = computed(() => self.notesSaving() > 0 || self.sendingSaving());
    return { self, api, toasts };
  };

  it('reads the branch switch once', () => {
    const m = make(() => of({}));
    proto.loadTechNotes.call(m.self);
    proto.loadTechNotes.call(m.self);
    expect(m.api.get).toHaveBeenCalledTimes(1);
    expect(m.api.get).toHaveBeenCalledWith('/api/tenants/branch-lab-config');
    expect(m.self.techNotes()).toBe(true);
  });

  it('PATCHes only techReportNotes, and says so', () => {
    const m = make(() => of({}));
    m.self.techNotes.set(false);
    proto.setTechNotes.call(m.self, true);
    expect(m.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { techReportNotes: true });
    expect(m.self.techNotes()).toBe(true);
    expect(m.self.notesSaving()).toBe(0);
    expect(m.toasts.success).toHaveBeenCalledWith('Technicians can now add notes that print on the report');
  });

  it('a failed save puts the switch back and says why', () => {
    const m = make(() => throwError(() => ({ message: 'Server said no' })));
    m.self.techNotes.set(false);
    proto.setTechNotes.call(m.self, true);
    expect(m.self.techNotes()).toBe(false);
    expect(m.toasts.error).toHaveBeenCalled();
    expect(m.self.notesSaving()).toBe(0);
  });

  it('the band save state reads "Saving…" while notes or sending save', () => {
    const m = make(() => of({}));
    expect(m.self.optionsSaving()).toBe(false);
    m.self.notesSaving.set(1);
    expect(m.self.optionsSaving()).toBe(true);
    m.self.notesSaving.set(0); m.self.sendingSaving.set(true);
    expect(m.self.optionsSaving()).toBe(true);
  });
});

describe('Report design › band search', () => {
  it('finds a setting on any tab by its plain name or a nearby word', () => {
    expect(findReportSettings('whatsapp')[0]).toMatchObject({ label: 'WhatsApp Auto', tab: 'sending' });
    expect(findReportSettings('tech notes')[0]).toMatchObject({ tab: 'notes' });
    expect(findReportSettings('age')[0]).toMatchObject({ label: 'Age and sex', tab: 'patient', heading: 'Age & sex' });
    expect(findReportSettings('uhid').map(h => h.label)).toEqual(['Field names']);
    expect(findReportSettings('zebra').map(h => h.tab)).toEqual(['table']);
  });

  it('nothing typed = nothing listed; at most eight', () => {
    expect(findReportSettings('   ')).toEqual([]);
    expect(findReportSettings('e').length).toBeLessThanOrEqual(8);
  });

  it('every heading it scrolls to exists on the page, and every tab is a real tab', () => {
    for (const h of REPORT_FIND) {
      expect(REPORT_TABS).toContain(h.tab);
      if (h.heading) expect(TEMPLATE.replace(/&amp;/g, '&'), h.heading).toContain(`<h4 class="pf-rtb-h">${h.heading}</h4>`);
    }
  });

  it('copy: no emoji, no "AI"', () => {
    const copy = REPORT_FIND.map(h => h.label).join(' ');
    expect(copy).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(copy).not.toMatch(/\bAI\b/);
  });
});
