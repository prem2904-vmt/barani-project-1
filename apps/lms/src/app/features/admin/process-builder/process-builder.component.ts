import { ChangeDetectionStrategy, Component, Injectable, OnInit, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SettingsSavebarComponent } from '../../../shared/components/setting-row/settings-savebar.component';
import { HasUnsavedChanges, guardUnsavedOnUnload } from '../../../shared/utils/unsaved-changes';
import type { ProcessWorkflowConfig, ProcessWorkflowRecord } from '../../../shared/models/process-workflow.model';
import { WORKFLOW_BACKEND, WorkflowBackend, WorkflowVersion } from '../../../shared/workflow-editor/workflow-backend';
import { WorkflowPage } from '../../../shared/workflow-editor/workflow-page';
import { WorkflowEditorComponent } from '../../../shared/workflow-editor/workflow-editor.component';
import { WorkflowBandToolsComponent, WorkflowStatusComponent } from '../../../shared/workflow-editor/workflow-band.component';

/** The tenant API behind the editor (payloads unchanged; History is the one new read). */
@Injectable()
export class LmsWorkflowBackend implements WorkflowBackend {
  private readonly api = inject(ApiService);
  private readonly svc = inject(ProcessWorkflowService);

  list(): Promise<ProcessWorkflowRecord[]> { return firstValueFrom(this.svc.list()); }
  create(name: string, config: ProcessWorkflowConfig, branchId: string | null) { return firstValueFrom(this.svc.create(name, config, branchId)); }
  update(id: string, name: string, config: ProcessWorkflowConfig, branchId: string | null) { return firstValueFrom(this.svc.update(id, name, config, branchId)); }
  activate(id: string) { return firstValueFrom(this.svc.activate(id)); }
  duplicate(id: string) { return firstValueFrom(this.svc.duplicate(id)); }
  history(id: string): Promise<WorkflowVersion[]> { return firstValueFrom(this.svc.history(id)); }
  async branches() {
    const bs = await firstValueFrom(this.api.get<{ id: string; name: string }[]>('/api/tenants/branches'));
    return (bs ?? []).map(b => ({ id: b.id, name: b.name }));
  }
  async roles() {
    const rs = await firstValueFrom(this.api.get<{ name: string }[]>('/api/roles'));
    return (rs ?? []).map(r => r.name).filter(Boolean);
  }
  /** Role → permission codes for "See it as" (the live nav is permission-driven). Needs manage_users: without it the
   *  page falls back to the roles chosen per area. */
  async rolePermissions(): Promise<Record<string, string[]> | null> {
    try {
      const [perms, roles] = await Promise.all([
        firstValueFrom(this.api.get<{ id: string; code: string }[]>('/api/permissions')),
        firstValueFrom(this.api.get<{ id: string; name: string }[]>('/api/roles')),
      ]);
      const code = new Map((perms ?? []).map(p => [p.id, p.code]));
      const out: Record<string, string[]> = {};
      await Promise.all((roles ?? []).map(async r => {
        const ids = await firstValueFrom(this.api.get<string[]>(`/api/roles/${r.id}/permissions`));
        out[r.name] = (ids ?? []).map(id => code.get(id)).filter((c): c is string => !!c);
      }));
      return Object.keys(out).length ? out : null;
    } catch { return null; }
  }
  liveChanged(): void { this.svc.refreshActive(); }
}

/**
 * Settings › Lab › Work steps — the workflow page (owner-approved redesign, 2026-11-19): work areas → actions → roles,
 * in Test Master's frame. Band: back, the live status line, the ONE Save top-right (+ Unsaved changes + Discard), the
 * search pill with Branch / Workflow / See it as. Body: the shared workflow editor. Payloads unchanged.
 */
@Component({
  selector: 'pf-process-builder',
  standalone: true,
  imports: [HeroBandComponent, SettingsSavebarComponent, WorkflowEditorComponent, WorkflowBandToolsComponent, WorkflowStatusComponent],
  providers: [WorkflowPage, LmsWorkflowBackend, { provide: WORKFLOW_BACKEND, useExisting: LmsWorkflowBackend }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pb pf-band-page px-4 md:px-6 lg:px-8 pt-3 pb-3">
      <pf-hero-band [back]="true" placeholder="Search actions and work areas…" [value]="page.q()" (valueChange)="page.q.set($event)">
        <span band-inline class="pb-searchnote" role="status" aria-live="polite" data-testid="wf-search-note">{{ page.searchNote() }}</span>
        <ng-container band-tools><pf-wf-band-tools></pf-wf-band-tools></ng-container>
        <ng-container band-actions><pf-wf-status></pf-wf-status></ng-container>
      </pf-hero-band>
      <!-- Registers the ONE band Save (top-right) + Unsaved changes + Discard; renders nothing here. -->
      <pf-settings-savebar saveTestId="wf-save" [dirty]="page.dirty()" [saving]="page.saving()" [canSave]="!page.loading()"
                           (save)="page.save()" (discard)="page.discard()"></pf-settings-savebar>
      <div class="pf-band-body pf-band-body--fill pb-body">
        <pf-wf-editor></pf-wf-editor>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; min-height: 0; }
    .pb { height: 100%; display: flex; flex-direction: column; min-height: 0; }
    .pb-body { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; padding-top: 4px; }
    .pb-searchnote { font-size: 12px; color: var(--text-tertiary, #6b7280); white-space: nowrap; padding: 0 6px; }
    @media (max-width: 900px) {
      :host { height: auto; }
      .pb { height: auto; }
      .pb-body { overflow: visible; }
    }
    @media (max-width: 640px) { .pb-searchnote { display: none; } }
  `],
})
export class ProcessBuilderComponent implements OnInit, HasUnsavedChanges {
  protected readonly page = inject(WorkflowPage);
  readonly unsavedLabel = 'the workflow';

  constructor() { guardUnsavedOnUnload(this); }

  ngOnInit(): void { void this.page.init(); }

  hasUnsavedChanges(): boolean { return this.page.dirty(); }
  saveChanges(): Promise<boolean> { return this.page.save(); }
}
