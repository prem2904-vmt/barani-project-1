import { TestBed } from '@angular/core/testing';
import { renderBandPage } from '../admin-band.spec-helpers';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ReportTemplateComponent } from './report-template.component';

/** The report letterhead's lab name + logo come from Organization profile; the rest of the letterhead is its own. */
describe('Report design — letterhead name and logo follow the Organization profile', () => {
  const make = (tenant: unknown, stored: Record<string, unknown>) => renderBandPage(ReportTemplateComponent, {
    getFor: (url) => url === '/api/config/report-template' ? stored
      : url === '/api/tenants/departments' ? [] : url.startsWith('/api/workflows/') ? { configJson: '{}' } : null,
    providers: [{ provide: TenantStateService, useValue: { tenant: () => tenant, ensureLoaded: () => undefined, update: () => undefined } }],
  });
  afterEach(() => TestBed.resetTestingModule());

  it('shows the profile name + logo over a stale stored copy, without making the page "unsaved"', () => {
    const p = make({ name: 'Arun Labs', logoUrl: '/uploads/a.png' }, { labName: 'Old Name', logoUrl: '/uploads/old.png', tagline: 'Careful' });
    p.f.detectChanges();
    expect(p.cmp.tpl().labName).toBe('Arun Labs');
    expect(p.cmp.tpl().logoUrl).toBe('/uploads/a.png');
    expect(p.cmp.tpl().tagline).toBe('Careful');
    expect(p.cmp.dirty()).toBe(false);
  });

  it('a save posts the profile name + logo beside the letterhead\'s own fields', () => {
    const p = make({ name: 'Arun Labs', logoUrl: '/uploads/a.png' }, { labName: 'Old Name', logoUrl: '', tagline: 'Careful', nablNumber: 'MC-1' });
    p.f.detectChanges();
    p.cmp.save();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/report-template', expect.objectContaining({ labName: 'Arun Labs', logoUrl: '/uploads/a.png', tagline: 'Careful', nablNumber: 'MC-1' }));
  });

  it('an empty profile never blanks what the template already has', () => {
    const p = make({ name: 'Arun Labs', logoUrl: '' }, { labName: 'Old Name', logoUrl: '/uploads/keep.png' });
    p.f.detectChanges();
    expect(p.cmp.tpl().labName).toBe('Arun Labs');
    expect(p.cmp.tpl().logoUrl).toBe('/uploads/keep.png');
  });
});
