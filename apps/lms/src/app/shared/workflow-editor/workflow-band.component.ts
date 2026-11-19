import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { WorkflowPage } from './workflow-page';
import { WfMenuComponent, WfMenuItem, WfMenuTriggerDirective } from './wf-menu.component';

/**
 * The band pill's tools for the workflow page: Branch (with "· n changes"), Workflow (pick one; New / Duplicate /
 * Set active live in this menu — no band corner buttons) and "See it as" a role. Shared by the LMS and the console.
 */
@Component({
  selector: 'pf-wf-band-tools',
  standalone: true,
  imports: [SelectComponent, WfMenuComponent, WfMenuTriggerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (page.branches().length > 0) {
      <span class="wfb-l">Branch</span>
      <pf-select class="wfb-sel" size="sm" [options]="branchOptions()" [value]="page.scope() ?? ''" [searchable]="page.branches().length > 8"
                 (valueChange)="page.setScope($event || null)" aria-label="Branch" data-testid="wf-branch"></pf-select>
    }
    <span class="wfb-l">Workflow</span>
    <pf-wf-menu [items]="workflowItems()" heading="Workflows for {{ page.branchName(page.scope()) }}" testId="wf-workflow" align="end" [width]="300"
                (picked)="onWorkflow($event)">
      <button type="button" class="wfb-trigger press" wfMenuTrigger data-testid="wf-workflow" aria-label="Workflow">
        <span class="wfb-trigger__t">{{ workflowLabel() }}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
    </pf-wf-menu>
    <span class="wfb-l">See it as</span>
    <pf-select class="wfb-sel wfb-sel--role" size="sm" [options]="roleOptions()" [value]="page.seeAs()" [searchable]="page.roles().length > 8"
               (valueChange)="page.seeAs.set($event || '')" aria-label="See it as a role" data-testid="wf-seeas-pick"></pf-select>
  `,
  styles: [`
    :host { display: contents; }
    .wfb-l { font-size: 12.5px; color: var(--text-tertiary, #6b7280); white-space: nowrap; }
    .wfb-sel { display: block; min-width: 150px; max-width: 230px; }
    .wfb-sel--role { min-width: 130px; }
    .wfb-trigger {
      display: inline-flex; align-items: center; gap: 8px; height: 34px; max-width: 260px; padding: 0 10px 0 12px; border-radius: 10px;
      border: 1px solid var(--input-border, var(--pf-line, #e5e7eb)); background: var(--input-bg, var(--bg-card-solid, #fff));
      color: var(--text-primary, #111827); font: inherit; font-size: 13px; cursor: pointer;
    }
    .wfb-trigger:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .wfb-trigger__t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    @media (pointer: coarse) { .wfb-trigger { height: 44px; } }
    @media (max-width: 900px) { .wfb-l { display: none; } .wfb-sel { min-width: 120px; } }
  `],
})
export class WorkflowBandToolsComponent {
  protected readonly page = inject(WorkflowPage);

  readonly branchOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All branches (default)' },
    ...this.page.branches().map(b => {
      const n = this.page.branchChanges(b.id);
      return { value: b.id, label: n ? `${b.name} · ${n} ${n === 1 ? 'change' : 'changes'}` : b.name };
    }),
  ]);

  readonly roleOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'Everyone' },
    ...this.page.roles().map(r => ({ value: r, label: r })),
  ]);

  readonly workflowLabel = computed(() => {
    const cur = this.page.current();
    if (!cur) return 'New draft';
    return `${cur.name} · ${cur.isActive ? 'Live' : 'Not live'}`;
  });

  readonly workflowItems = computed<WfMenuItem[]>(() => {
    const p = this.page;
    const list: WfMenuItem[] = p.scopedWorkflows().map(w => ({
      id: 'wf:' + w.id, label: w.name, group: 'Workflows', current: w.id === p.currentId(),
      hint: [w.isActive ? 'Live' : '', w.isSystemDefault ? 'The standard flow we ship' : ''].filter(Boolean).join(' · ') || undefined,
    }));
    return [
      ...list,
      { id: 'new', label: 'New workflow', hint: 'Starts from the live one', group: ' ', disabled: !!p.op() },
      { id: 'duplicate', label: 'Duplicate', disabled: !p.currentId() || !!p.op(), group: ' ' },
      { id: 'activate', label: 'Set active', hint: p.isActive() ? 'This one is live' : 'Makes it the navigation', disabled: !p.currentId() || p.isActive() || !!p.op(), group: ' ' },
    ];
  });

  onWorkflow(id: string): void {
    if (id.startsWith('wf:')) void this.page.selectWorkflow(id.slice(3));
    else if (id === 'new') void this.page.newWorkflow();
    else if (id === 'duplicate') void this.page.duplicate();
    else if (id === 'activate') void this.page.activate();
  }
}

/** The band's title + live status line ("<flow> is live · Save changes the navigation for everyone at once"). */
@Component({
  selector: 'pf-wf-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="wfs" data-testid="wf-status">
      @if (title) { <span class="wfs__t">{{ title }}</span> }
      <span class="wfs__s"><span class="wfs__dot" [class.wfs__dot--live]="page.isActive()" aria-hidden="true"></span>{{ page.statusLine() }}</span>
    </span>
  `,
  inputs: ['title'],
  styles: [`
    :host { display: inline-flex; min-width: 0; }
    .wfs { display: inline-flex; flex-direction: column; min-width: 0; text-align: left; margin-right: 6px; }
    .wfs__t { font-size: 15px; font-weight: 600; color: var(--text-primary, #111827); }
    .wfs__s { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-secondary, #4b5563); }
    .wfs__dot { width: 7px; height: 7px; border-radius: 99px; flex: none; background: var(--text-tertiary, #9ca3af); }
    .wfs__dot--live { background: var(--color-violet-600, #7c3aed); }
    @media (max-width: 900px) { :host { display: none; } }
  `],
})
export class WorkflowStatusComponent {
  protected readonly page = inject(WorkflowPage);
  title = '';
}
