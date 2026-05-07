import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReportTemplate } from '../../../shared/models/report.model';
import { LogoMarkComponent } from '../../../shared/primitives/logo-mark.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ReportColumnsEditorComponent } from './report-columns-editor.component';

type Tab = 'branding' | 'layout' | 'columns' | 'footer';

@Component({
  selector: 'pf-report-template',
  standalone: true,
  imports: [
    FormsModule,
    LogoMarkComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    TileComponent,
    ToggleComponent,
    TouchButtonComponent,
    ReportColumnsEditorComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin"
        title="Report Template"
        subtitle="Shapes every printed / WhatsApp report patients receive.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="save()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <path d="M17 21v-8H7v8"/>
            </svg>
          </span>
          Save
        </pf-touch-btn>
      </pf-screen-header>

      <div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        <div>
          <div class="mb-5">
            <pf-segmented
              [options]="tabOptions"
              [value]="tab()"
              size="md"
              (valueChange)="setTab($event)">
            </pf-segmented>
          </div>

          @if (tab() === 'branding') {
            <pf-tile tone="default" padding="lg" class="block">
              <div class="space-y-3">
                <div><label class="pf-label">Lab name</label>
                  <input type="text" class="pf-input" [ngModel]="tpl().labName" (ngModelChange)="patch({ labName: $event })" /></div>
                <div><label class="pf-label">Tagline</label>
                  <input type="text" class="pf-input" [ngModel]="tpl().tagline" (ngModelChange)="patch({ tagline: $event })" /></div>
                <div class="grid grid-cols-2 gap-3">
                  <div><label class="pf-label">Phone</label>
                    <input type="text" class="pf-input" [ngModel]="tpl().phone" (ngModelChange)="patch({ phone: $event })" /></div>
                  <div><label class="pf-label">Email</label>
                    <input type="text" class="pf-input" [ngModel]="tpl().email" (ngModelChange)="patch({ email: $event })" /></div>
                </div>
                <div><label class="pf-label">Address</label>
                  <input type="text" class="pf-input" [ngModel]="tpl().address" (ngModelChange)="patch({ address: $event })" /></div>
                <div><label class="pf-label">Logo URL</label>
                  <input type="text" class="pf-input" [ngModel]="tpl().logoUrl" (ngModelChange)="patch({ logoUrl: $event })" /></div>

                <div class="flex items-center justify-between py-3"
                     style="border-top: 1px solid var(--border-muted); border-bottom: 1px solid var(--border-muted);">
                  <div>
                    <p class="font-semibold text-[14px]" style="color: var(--text-primary);">NABL accredited</p>
                    <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">Display NABL badge on the report header.</p>
                  </div>
                  <pf-toggle
                    [checked]="tpl().nablAccredited"
                    (checkedChange)="patch({ nablAccredited: $event })">
                  </pf-toggle>
                </div>

                <div>
                  <label class="pf-label">NABL number</label>
                  <input type="text" class="pf-input" placeholder="NABL number"
                         [ngModel]="tpl().nablNumber" (ngModelChange)="patch({ nablNumber: $event })"
                         [disabled]="!tpl().nablAccredited" />
                </div>

                <div>
                  <label class="pf-label">Primary color</label>
                  <div class="flex items-center gap-3">
                    <input type="color" class="pf-color-picker"
                           [ngModel]="tpl().primaryColor" (ngModelChange)="patch({ primaryColor: $event })" />
                    <span class="font-mono text-[12px]" style="color: var(--text-secondary);">
                      {{ tpl().primaryColor }}
                    </span>
                  </div>
                </div>
              </div>
            </pf-tile>
          }

          @if (tab() === 'layout') {
            <pf-tile tone="default" padding="lg" class="block">
              <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
                 style="color: var(--text-muted);">Toggle what appears on the report</p>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                @for (f of layoutToggles; track f.key) {
                  <div class="pf-toggle-row">
                    <span class="text-[14px]" style="color: var(--text-primary);">{{ f.label }}</span>
                    <pf-toggle
                      [checked]="getBool(f.key)"
                      size="sm"
                      (checkedChange)="patchBool(f.key, $event)">
                    </pf-toggle>
                  </div>
                }
              </div>
            </pf-tile>
          }

          @if (tab() === 'columns') {
            <!-- Per-department report column structure. The Save button at the
                 top of this screen does NOT save columns — the editor has its
                 own Save button so you can iterate per dept independently. -->
            <pf-report-columns-editor></pf-report-columns-editor>
          }

          @if (tab() === 'footer') {
            <pf-tile tone="default" padding="lg" class="block">
              <div class="space-y-3">
                <div><label class="pf-label">Signature URL</label>
                  <input type="text" class="pf-input" [ngModel]="tpl().signatureUrl" (ngModelChange)="patch({ signatureUrl: $event })" /></div>
                <div><label class="pf-label">Disclaimer</label>
                  <textarea class="pf-input min-h-[88px]" [ngModel]="tpl().disclaimer" (ngModelChange)="patch({ disclaimer: $event })"></textarea></div>

                <div class="pf-toggle-row">
                  <span class="text-[14px]" style="color: var(--text-primary);">Show QR code for online verification</span>
                  <pf-toggle
                    [checked]="tpl().showQrCode"
                    (checkedChange)="patch({ showQrCode: $event })">
                  </pf-toggle>
                </div>
                <div class="pf-toggle-row">
                  <span class="text-[14px]" style="color: var(--text-primary);">Show "Powered by Prefrontal"</span>
                  <pf-toggle
                    [checked]="tpl().showPoweredBy"
                    (checkedChange)="patch({ showPoweredBy: $event })">
                  </pf-toggle>
                </div>
              </div>
            </pf-tile>
          }
        </div>

        <aside class="sticky top-4 h-fit">
          <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2"
             style="color: var(--text-muted);">Live preview</p>
          <div class="pf-preview">
            <div class="flex items-center justify-between pb-3 mb-3 pf-preview-header"
                 [style.border-color]="tpl().primaryColor">
              <div class="flex items-center gap-2">
                @if (tpl().logoUrl && tpl().logoUrl !== '/logo.svg') {
                  <img [src]="tpl().logoUrl" alt="" class="h-10 w-10 object-contain" onerror="this.style.display='none'" />
                } @else {
                  <pf-logo-mark size="md" variant="badge"></pf-logo-mark>
                }
                <div>
                  <p class="text-[14px] font-semibold" [style.color]="tpl().primaryColor">{{ tpl().labName || '[Lab name]' }}</p>
                  <p class="text-[10px]" style="color: #64748b;">{{ tpl().tagline || '' }}</p>
                </div>
              </div>
              @if (tpl().nablAccredited) {
                <span class="pf-preview-badge">NABL {{ tpl().nablNumber || '—' }}</span>
              }
            </div>
            <div class="space-y-1 text-[11px]" style="color: #0f172a;">
              @if (tpl().showPatientName) { <p><strong>Patient:</strong> Sita Raman</p> }
              @if (tpl().showAge) { <p><strong>Age:</strong> 37y, F</p> }
              @if (tpl().showOrderId) { <p><strong>Order:</strong> #ORD-000123</p> }
              @if (tpl().showRefDoctor) { <p><strong>Ref Dr:</strong> Dr. A Sharma</p> }
              @if (tpl().showCollectionDate) { <p><strong>Collected:</strong> 2026-04-18 09:40</p> }
              @if (tpl().showReportDate) { <p><strong>Reported:</strong> 2026-04-18 13:10</p> }
            </div>
            <div class="mt-3 pt-3 text-[11px]" style="border-top: 1px solid #e2e8f0; color: #0f172a;">
              <p class="font-semibold">Haematology — CBC</p>
              <table class="w-full mt-1">
                <tr><td>Haemoglobin</td><td class="text-right">14.2 g/dL</td></tr>
                <tr><td>WBC</td><td class="text-right">8,400 /µL</td></tr>
              </table>
            </div>
            @if (tpl().showSignature) {
              <div class="mt-4 flex justify-between items-end">
                <div class="text-[10px]" style="color: #94a3b8;">{{ tpl().disclaimer?.slice(0, 80) || '' }}</div>
                <div class="text-right text-[11px]" style="color: #0f172a;">
                  <div class="h-8 w-28 mb-1" style="border-bottom: 1px solid #94a3b8;"></div>
                  @if (tpl().showPathologistName) { <p>Dr. K Nair, MD</p> }
                </div>
              </div>
            }
            @if (tpl().showQrCode) {
              <div class="mt-3 text-center">
                <div class="inline-block p-2 rounded" style="background: #ffffff; border: 2px solid #cbd5e1;">
                  <div class="grid grid-cols-6 grid-rows-6 gap-[1px] w-16 h-16">
                    @for (c of qrCells; track $index) {
                      <div [style.background]="c === 1 ? '#0f172a' : 'transparent'"></div>
                    }
                  </div>
                </div>
                <p class="text-[9px] mt-1" style="color: #64748b;">Scan to verify online</p>
              </div>
            }
            @if (tpl().showPoweredBy) {
              <p class="text-center text-[9px] mt-3" style="color: #94a3b8;">Powered by Prefrontal</p>
            }
          </div>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .pf-color-picker {
      height: 40px;
      width: 64px;
      border-radius: 10px;
      border: 1px solid var(--glass-border);
      cursor: pointer;
      background: var(--glass-bg);
    }
    .pf-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-preview {
      border-radius: 14px;
      border: 1px solid var(--glass-border);
      background: #ffffff;
      color: #0f172a;
      padding: 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    }
    .pf-preview-header { border-bottom: 2px solid; }
    .pf-preview-badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 9999px;
      background: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
    }
  `]
})
export class ReportTemplateComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'branding', label: 'Branding' },
    { value: 'layout',   label: 'Layout' },
    { value: 'columns',  label: 'Report columns' },
    { value: 'footer',   label: 'Footer' }
  ];
  private readonly _tab = signal<Tab>('branding');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); }

  readonly layoutToggles: Array<{ key: keyof ReportTemplate; label: string }> = [
    { key: 'showPatientName',      label: 'Patient name' },
    { key: 'showAge',              label: 'Age & sex' },
    { key: 'showOrderId',          label: 'Order ID' },
    { key: 'showRefDoctor',        label: 'Referring doctor' },
    { key: 'showCollectionDate',   label: 'Collection date' },
    { key: 'showReportDate',       label: 'Report date' },
    { key: 'showAbhaId',           label: 'ABHA ID' },
    { key: 'showMethod',           label: 'Test method' },
    { key: 'showInstrument',       label: 'Instrument used' },
    { key: 'groupByDepartment',    label: 'Group results by department' },
    { key: 'showCriticalFlag',     label: 'Critical value flags' },
    { key: 'showPathologistName',  label: 'Pathologist name' },
    { key: 'showSignature',        label: 'Signature block' }
  ];

  private readonly _tpl = signal<ReportTemplate>({
    id: '', tenantId: '',
    labName: 'Apollo Diagnostics',
    tagline: 'Accurate. On time.',
    address: '', phone: '', email: '', website: '', logoUrl: '/logo.svg',
    nablAccredited: false, nablNumber: '',
    primaryColor: '#7c3aed',
    showPatientName: true, showAge: true, showRefDoctor: true,
    showCollectionDate: true, showReportDate: true, showOrderId: true,
    showAbhaId: false, showMethod: false, showInstrument: false,
    groupByDepartment: true, showCriticalFlag: true, showPathologistName: true,
    showSignature: true, signatureUrl: '', disclaimer: 'Test results should be correlated clinically.',
    showQrCode: true, showPoweredBy: true
  });
  readonly tpl = this._tpl.asReadonly();
  patch(p: Partial<ReportTemplate>) { this._tpl.update(v => ({ ...v, ...p })); }
  getBool(key: keyof ReportTemplate): boolean {
    return !!(this._tpl() as unknown as Record<string, unknown>)[key];
  }
  patchBool(key: keyof ReportTemplate, v: boolean) {
    this.patch({ [key]: v } as Partial<ReportTemplate>);
  }

  readonly qrCells = Array.from({ length: 36 }, (_, i) => (i * 7 + i % 3) % 3 === 0 ? 1 : 0);

  ngOnInit() {
    // Honor `?tab=…` deep-links — admin dashboard's Report Columns tile
    // lands here with `?tab=columns`. Falls back to the default 'branding'.
    const initial = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (initial && this.tabOptions.some(o => o.value === initial)) {
      this._tab.set(initial);
    }

    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({
      next: t => { if (t) this._tpl.set({ ...this._tpl(), ...t }); }
    });
  }

  save() {
    const t = this._tpl();
    this.api.post('/api/config/report-template', {
      labName: t.labName, tagline: t.tagline, address: t.address, phone: t.phone,
      email: t.email, website: t.website, logoUrl: t.logoUrl,
      nablAccredited: t.nablAccredited, nablNumber: t.nablNumber, nablLogoUrl: '',
      primaryColor: t.primaryColor,
      showPatientName: t.showPatientName, showAge: t.showAge, showRefDoctor: t.showRefDoctor,
      showCollectionDate: t.showCollectionDate, showReportDate: t.showReportDate,
      showOrderId: t.showOrderId, showAbhaId: t.showAbhaId,
      showMethod: t.showMethod, showInstrument: t.showInstrument,
      groupByDepartment: t.groupByDepartment,
      showCriticalFlag: t.showCriticalFlag, showPathologistName: t.showPathologistName,
      showSignature: t.showSignature, signatureUrl: t.signatureUrl,
      disclaimer: t.disclaimer, showQrCode: t.showQrCode, showPoweredBy: t.showPoweredBy
    }).subscribe({
      next: () => this.toasts.success('Template saved')
    });
  }
}
