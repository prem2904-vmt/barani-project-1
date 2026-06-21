import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';
import { v4 as uuid } from 'uuid';
import { ApiService } from '../../../core/services/api.service';
import {
  ConditionalRoute,
  ConditionRule,
  FieldType,
  StepType,
  WorkflowConfig,
  WorkflowConfigRecord,
  WorkflowField,
  WorkflowStep,
  WorkflowTransition
} from '../../../shared/models/workflow.model';

export interface DeletedFieldSnapshot {
  field: WorkflowField;
  stepId: string;
  index: number;
}

export interface DeletedStepSnapshot {
  step: WorkflowStep;
  index: number;
}

const UNDO_TIMEOUT_MS = 5000;

@Injectable({ providedIn: 'root' })
export class WorkflowBuilderService {
  private readonly api = inject(ApiService);

  // ── state ──────────────────────────────────────────────────────────
  private readonly _workflow = signal<WorkflowConfig | null>(null);
  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _selectedStepId = signal<string | null>(null);
  private readonly _selectedFieldId = signal<string | null>(null);
  private readonly _isDirty = signal<boolean>(false);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  // ── transient undo ─────────────────────────────────────────────────
  private readonly _lastDeletedField = signal<DeletedFieldSnapshot | null>(null);
  private readonly _lastDeletedStep = signal<DeletedStepSnapshot | null>(null);
  private _undoFieldTimer: ReturnType<typeof setTimeout> | null = null;
  private _undoStepTimer: ReturnType<typeof setTimeout> | null = null;

  // ── readonly exposure ──────────────────────────────────────────────
  readonly workflow = this._workflow.asReadonly();
  readonly record = this._record.asReadonly();
  readonly selectedStepId = this._selectedStepId.asReadonly();
  readonly selectedFieldId = this._selectedFieldId.asReadonly();
  readonly isDirty = this._isDirty.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly lastDeletedField = this._lastDeletedField.asReadonly();
  readonly lastDeletedStep = this._lastDeletedStep.asReadonly();

  // ── computed ───────────────────────────────────────────────────────
  readonly selectedStep = computed<WorkflowStep | null>(() => {
    const id = this._selectedStepId();
    if (!id) return null;
    return this._workflow()?.steps.find(s => s.id === id) ?? null;
  });

  readonly selectedField = computed<WorkflowField | null>(() => {
    const stepId = this._selectedStepId();
    const fieldId = this._selectedFieldId();
    if (!stepId || !fieldId) return null;
    return this._workflow()?.steps
      .find(s => s.id === stepId)
      ?.fields.find(f => f.id === fieldId) ?? null;
  });

  /** id → field.name lookup for condition builders. */
  readonly fieldIdToNameMap = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const step of this._workflow()?.steps ?? []) {
      for (const field of step.fields) map.set(field.id, field.name);
    }
    return map;
  });

  /** Flat list of all fields across all steps — handy for condition pickers. */
  readonly allFields = computed<WorkflowField[]>(() => {
    const out: WorkflowField[] = [];
    for (const step of this._workflow()?.steps ?? []) out.push(...step.fields);
    return out;
  });

  // ── loading ────────────────────────────────────────────────────────
  loadWorkflow(screenName: string): Observable<WorkflowConfig> {
    this._isLoading.set(true);
    this._error.set(null);
    return this.api.get<WorkflowConfigRecord>(`/api/workflows/${screenName}`).pipe(
      map(record => {
        this._record.set(record);
        const cfg = this.parseConfig(record);
        this._workflow.set(cfg);
        this._selectedStepId.set(cfg.steps[0]?.id ?? null);
        this._selectedFieldId.set(null);
        this._isDirty.set(false);
        this._isLoading.set(false);
        return cfg;
      }),
      catchError((err: unknown) => {
        this._isLoading.set(false);
        this._error.set(err instanceof HttpErrorResponse ? err.message : 'Could not load workflow');
        return throwError(() => err);
      })
    );
  }

  clear(): void {
    this._workflow.set(null);
    this._record.set(null);
    this._selectedStepId.set(null);
    this._selectedFieldId.set(null);
    this._isDirty.set(false);
    this._error.set(null);
    this.cancelUndo();
  }

  // ── selection ──────────────────────────────────────────────────────
  selectStep(stepId: string | null): void {
    this._selectedStepId.set(stepId);
    this._selectedFieldId.set(null);
  }
  selectField(fieldId: string | null): void {
    this._selectedFieldId.set(fieldId);
  }

  // ── workflow-level ─────────────────────────────────────────────────
  updateWorkflow(updates: Partial<WorkflowConfig>): void {
    const current = this._workflow();
    if (!current) return;
    this._workflow.set({ ...current, ...updates });
    this._isDirty.set(true);
  }

  // ── steps ──────────────────────────────────────────────────────────
  addStep(title: string, type: StepType = 'entry'): WorkflowStep {
    const current = this._workflow();
    if (!current) throw new Error('No workflow loaded');

    const name = this.uniqueStepName(this.toSnakeCase(title), current.steps);
    const step: WorkflowStep = {
      id: uuid(),
      name,
      title,
      type,
      isRequired: true,
      canSkip: false,
      isStandard: false,
      fields: [],
      afterStep: { defaultNextStep: null }
    };

    const steps = [...current.steps, step];
    this._workflow.set({ ...current, steps });
    this._isDirty.set(true);
    this._selectedStepId.set(step.id);
    return step;
  }

  updateStep(stepId: string, updates: Partial<WorkflowStep>): void {
    this.mutateSteps(steps => steps.map(s => s.id === stepId ? { ...s, ...updates } : s));
  }

  deleteStep(stepId: string): void {
    const current = this._workflow();
    if (!current) return;
    const index = current.steps.findIndex(s => s.id === stepId);
    if (index < 0) return;
    const step = current.steps[index];
    // Fully customisable: standard steps can be deleted like custom ones.
    this.mutateSteps(steps => steps.filter(s => s.id !== stepId));
    if (this._selectedStepId() === stepId) {
      this._selectedStepId.set(this._workflow()?.steps[0]?.id ?? null);
    }

    this.startFieldUndoClear();
    this._lastDeletedStep.set({ step, index });
    if (this._undoStepTimer) clearTimeout(this._undoStepTimer);
    this._undoStepTimer = setTimeout(() => this._lastDeletedStep.set(null), UNDO_TIMEOUT_MS);
  }

  reorderSteps(fromIndex: number, toIndex: number): void {
    this.mutateSteps(steps => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return steps;
      if (fromIndex >= steps.length || toIndex >= steps.length) return steps;
      const next = [...steps];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  undoDeleteStep(): void {
    const snap = this._lastDeletedStep();
    if (!snap) return;
    this.mutateSteps(steps => {
      const next = [...steps];
      next.splice(Math.min(snap.index, next.length), 0, snap.step);
      return next;
    });
    this._lastDeletedStep.set(null);
    if (this._undoStepTimer) clearTimeout(this._undoStepTimer);
    this._undoStepTimer = null;
  }

  // ── fields ─────────────────────────────────────────────────────────
  addField(stepId: string, fieldConfig: Partial<WorkflowField>): WorkflowField {
    const current = this._workflow();
    if (!current) throw new Error('No workflow loaded');
    const step = current.steps.find(s => s.id === stepId);
    if (!step) throw new Error('Step not found');

    const title = fieldConfig.title ?? 'New field';
    const name = fieldConfig.name
      ? this.uniqueFieldName(fieldConfig.name, step.fields)
      : this.uniqueFieldName(this.toSnakeCase(title), step.fields);

    const type = (fieldConfig.type ?? 'text') as FieldType;
    const isStandard = fieldConfig.isStandard ?? false;
    const storageKey = fieldConfig.storageKey ?? (isStandard ? name : `metadata.${name}`);

    const field: WorkflowField = {
      id: uuid(),
      name,
      title,
      type,
      isStandard,
      isRequired: fieldConfig.isRequired ?? false,
      isEditable: fieldConfig.isEditable ?? true,
      width: fieldConfig.width ?? 'full',
      showWhen: fieldConfig.showWhen,
      validation: fieldConfig.validation,
      options: fieldConfig.options,
      dataSource: fieldConfig.dataSource,
      storageKey,
      unit: fieldConfig.unit,
      referenceRanges: fieldConfig.referenceRanges,
      criticalLow: fieldConfig.criticalLow,
      criticalHigh: fieldConfig.criticalHigh,
      normalValue: fieldConfig.normalValue,
      defaultValue: fieldConfig.defaultValue,
      placeholder: fieldConfig.placeholder,
      helperText: fieldConfig.helperText
    };

    this.mutateStep(stepId, s => ({ ...s, fields: [...s.fields, field] }));
    this._selectedFieldId.set(field.id);
    return field;
  }

  updateField(stepId: string, fieldId: string, updates: Partial<WorkflowField>): void {
    this.mutateStep(stepId, s => ({
      ...s,
      fields: s.fields.map(f => f.id === fieldId ? { ...f, ...updates } : f)
    }));
  }

  deleteField(stepId: string, fieldId: string): void {
    const current = this._workflow();
    if (!current) return;
    const step = current.steps.find(s => s.id === stepId);
    if (!step) return;
    const index = step.fields.findIndex(f => f.id === fieldId);
    if (index < 0) return;
    const field = step.fields[index];
    // Fully customisable: standard fields can be deleted like custom ones.
    this.mutateStep(stepId, s => ({ ...s, fields: s.fields.filter(f => f.id !== fieldId) }));
    if (this._selectedFieldId() === fieldId) this._selectedFieldId.set(null);

    this.startStepUndoClear();
    this._lastDeletedField.set({ field, stepId, index });
    if (this._undoFieldTimer) clearTimeout(this._undoFieldTimer);
    this._undoFieldTimer = setTimeout(() => this._lastDeletedField.set(null), UNDO_TIMEOUT_MS);
  }

  reorderFields(stepId: string, fromIndex: number, toIndex: number): void {
    this.mutateStep(stepId, s => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return s;
      if (fromIndex >= s.fields.length || toIndex >= s.fields.length) return s;
      const fields = [...s.fields];
      const [moved] = fields.splice(fromIndex, 1);
      fields.splice(toIndex, 0, moved);
      return { ...s, fields };
    });
  }

  undoDeleteField(): void {
    const snap = this._lastDeletedField();
    if (!snap) return;
    this.mutateStep(snap.stepId, s => {
      const fields = [...s.fields];
      fields.splice(Math.min(snap.index, fields.length), 0, snap.field);
      return { ...s, fields };
    });
    this._lastDeletedField.set(null);
    if (this._undoFieldTimer) clearTimeout(this._undoFieldTimer);
    this._undoFieldTimer = null;
  }

  // ── conditions ─────────────────────────────────────────────────────
  addConditionToField(stepId: string, fieldId: string, condition: ConditionRule): void {
    this.updateField(stepId, fieldId, (() => {
      const current = this.findField(stepId, fieldId);
      const list = [...(current?.showWhen ?? []), condition];
      return { showWhen: list };
    })());
  }

  setFieldConditions(stepId: string, fieldId: string, conditions: ConditionRule[] | undefined): void {
    this.updateField(stepId, fieldId, { showWhen: conditions });
  }

  addConditionToStep(stepId: string, condition: ConditionRule): void {
    const current = this.findStep(stepId);
    const list = [...(current?.showWhen ?? []), condition];
    this.updateStep(stepId, { showWhen: list });
  }

  setStepShowConditions(stepId: string, conditions: ConditionRule[] | undefined): void {
    this.updateStep(stepId, { showWhen: conditions });
  }

  addSkipConditionToStep(stepId: string, condition: ConditionRule): void {
    const current = this.findStep(stepId);
    const list = [...(current?.skipWhen ?? []), condition];
    this.updateStep(stepId, { skipWhen: list });
  }

  setStepSkipConditions(stepId: string, conditions: ConditionRule[] | undefined): void {
    this.updateStep(stepId, { skipWhen: conditions });
  }

  updateStepTransition(stepId: string, transition: WorkflowTransition): void {
    this.updateStep(stepId, { afterStep: transition });
  }

  setConditionalRoutes(stepId: string, routes: ConditionalRoute[]): void {
    const step = this.findStep(stepId);
    if (!step) return;
    this.updateStep(stepId, {
      afterStep: { ...step.afterStep, conditionalRoutes: routes }
    });
  }

  // ── persistence ────────────────────────────────────────────────────
  saveDraft(changeSummary?: string): Observable<void> {
    const record = this._record();
    const cfg = this._workflow();
    if (!record || !cfg) return throwError(() => new Error('No workflow loaded'));

    const body = { configJson: JSON.stringify(cfg), changeSummary };
    return this.api.post<void>(`/api/workflows/${record.screenName}`, body).pipe(
      tap(() => this._isDirty.set(false))
    );
  }

  publish(changeSummary?: string): Observable<void> {
    const record = this._record();
    const cfg = this._workflow();
    if (!record || !cfg) return throwError(() => new Error('No workflow loaded'));

    const saveBody = { configJson: JSON.stringify(cfg), changeSummary };
    return this.api.post<void>(`/api/workflows/${record.screenName}`, saveBody).pipe(
      map(() => undefined),
      tap(() => {
        this._isDirty.set(false);
      }),
      // then publish
      tap(() => {
        this.api.post<void>(`/api/workflows/${record.screenName}/publish`, {}).subscribe({
          next: () => {
            const existing = this._record();
            if (existing) this._record.set({ ...existing, status: 'published', version: existing.version + 1 });
          }
        });
      })
    );
  }

  resetToDefault(): Observable<void> {
    // No backend endpoint yet. Re-load (which pulls the currently published config)
    // then mark dirty so the UI clearly indicates "not saved".
    const record = this._record();
    if (!record) return of(void 0);
    return this.loadWorkflow(record.screenName).pipe(map(() => undefined));
  }

  // ── internal helpers ───────────────────────────────────────────────
  private parseConfig(record: WorkflowConfigRecord): WorkflowConfig {
    try {
      const parsed = JSON.parse(record.configJson);
      return {
        id: parsed.id ?? uuid(),
        name: parsed.name ?? record.screenName,
        title: parsed.title ?? record.screenName,
        module: parsed.module ?? record.module,
        screenName: record.screenName,
        version: record.version,
        status: record.status,
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        globalConditions: Array.isArray(parsed.globalConditions) ? parsed.globalConditions : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions : []
      };
    } catch {
      return {
        id: uuid(),
        name: record.screenName,
        title: record.screenName,
        module: record.module,
        screenName: record.screenName,
        version: record.version,
        status: record.status,
        steps: [],
        globalConditions: [],
        actions: []
      };
    }
  }

  private mutateSteps(fn: (steps: WorkflowStep[]) => WorkflowStep[]): void {
    const current = this._workflow();
    if (!current) return;
    this._workflow.set({ ...current, steps: fn(current.steps) });
    this._isDirty.set(true);
  }

  private mutateStep(stepId: string, fn: (s: WorkflowStep) => WorkflowStep): void {
    this.mutateSteps(steps => steps.map(s => s.id === stepId ? fn(s) : s));
  }

  private findStep(stepId: string): WorkflowStep | null {
    return this._workflow()?.steps.find(s => s.id === stepId) ?? null;
  }
  private findField(stepId: string, fieldId: string): WorkflowField | null {
    return this.findStep(stepId)?.fields.find(f => f.id === fieldId) ?? null;
  }

  private uniqueStepName(base: string, existing: WorkflowStep[]): string {
    return this.uniqueName(base, existing.map(s => s.name));
  }
  private uniqueFieldName(base: string, existing: WorkflowField[]): string {
    return this.uniqueName(base, existing.map(f => f.name));
  }
  private uniqueName(base: string, taken: string[]): string {
    const set = new Set(taken);
    if (!set.has(base)) return base;
    let n = 2;
    while (set.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  private toSnakeCase(str: string): string {
    return str.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private cancelUndo(): void {
    if (this._undoFieldTimer) clearTimeout(this._undoFieldTimer);
    if (this._undoStepTimer) clearTimeout(this._undoStepTimer);
    this._undoFieldTimer = null;
    this._undoStepTimer = null;
    this._lastDeletedField.set(null);
    this._lastDeletedStep.set(null);
  }

  /** Clears a pending field-undo when a step delete happens right after. */
  private startStepUndoClear(): void {
    if (this._undoFieldTimer) {
      clearTimeout(this._undoFieldTimer);
      this._undoFieldTimer = null;
      this._lastDeletedField.set(null);
    }
  }
  /** Clears a pending step-undo when a field delete happens right after. */
  private startFieldUndoClear(): void {
    if (this._undoStepTimer) {
      clearTimeout(this._undoStepTimer);
      this._undoStepTimer = null;
      this._lastDeletedStep.set(null);
    }
  }
}
