import { InjectionToken } from '@angular/core';
import type { ProcessWorkflowConfig, ProcessWorkflowRecord } from './wf-model';

/** One saved version (History). `kind`: create | save | duplicate | baseline (the state before versions were kept). */
export interface WorkflowVersion {
  id: string;
  version: number;
  name: string;
  at: string;
  by?: string | null;
  kind: string;
  configJson: string;
}

/**
 * Where the workflow editor reads and writes. The LMS page talks to the tenant API (`/api/process-workflows`); the
 * admin console's page talks to the platform API for the chosen tenant. Same payloads either way.
 */
export interface WorkflowBackend {
  list(): Promise<ProcessWorkflowRecord[]>;
  create(name: string, config: ProcessWorkflowConfig, branchId: string | null): Promise<ProcessWorkflowRecord>;
  update(id: string, name: string, config: ProcessWorkflowConfig, branchId: string | null): Promise<ProcessWorkflowRecord>;
  activate(id: string): Promise<ProcessWorkflowRecord>;
  duplicate(id: string): Promise<ProcessWorkflowRecord>;
  /** Saved versions, newest first. */
  history(id: string): Promise<WorkflowVersion[]>;
  branches(): Promise<{ id: string; name: string }[]>;
  roles(): Promise<string[]>;
  /** Role name → permission codes, or null when this surface can't read them ("See it as" then uses the roles chosen
   *  for each area). */
  rolePermissions(): Promise<Record<string, string[]> | null>;
  /** The live workflow changed (save of the active one / Set active): refresh what drives the navigation. */
  liveChanged?(): void;
}

export const WORKFLOW_BACKEND = new InjectionToken<WorkflowBackend>('WORKFLOW_BACKEND');
