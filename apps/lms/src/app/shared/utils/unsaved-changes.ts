import { DestroyRef, inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
import { DialogService } from '../../core/services/dialog.service';

/**
 * Pages with an explicit Save implement this (owner 2026-11-17: "users forget to Save — ask before they leave").
 * Autosave pages do not. `unsavedLabel` names the page in the prompt ("You changed <label> but haven't saved").
 */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
  saveChanges?(): Promise<boolean> | Observable<boolean>;
  unsavedLabel?: string;
}

export function hasUnsavedChangesContract(c: unknown): c is HasUnsavedChanges {
  return !!c && typeof (c as HasUnsavedChanges).hasUnsavedChanges === 'function';
}

/**
 * Asks "Save your changes?" (DialogService, never window.confirm) when `page` has unsaved changes.
 * Resolves true when the person may leave: nothing changed, Leave without saving, or Save succeeded.
 */
export async function confirmLeaveUnsaved(dialog: DialogService, page: unknown, label?: string): Promise<boolean> {
  if (!hasUnsavedChangesContract(page) || !page.hasUnsavedChanges()) return true;
  const name = label ?? page.unsavedLabel ?? 'this page';
  const canSave = typeof page.saveChanges === 'function';
  const r = await dialog.actions({
    title: 'Save your changes?',
    message: `You changed ${name} but haven't saved.`,
    cancelLabel: 'Stay',
    actions: [
      ...(canSave ? [{ value: 'save', label: 'Save', variant: 'primary' as const }] : []),
      { value: 'leave', label: 'Leave without saving', variant: 'secondary' as const },
    ],
  });
  if (r.action === 'leave') return true;
  if (r.action !== 'save' || !canSave) return false;
  try {
    const res = page.saveChanges!();
    return !!(isObservable(res) ? await firstValueFrom(res) : await res);
  } catch {
    return false;
  }
}

/** The ONE CanDeactivate guard for settings routes: asks only when the routed page implements the contract and is dirty. */
export const unsavedChangesGuard: CanDeactivateFn<unknown> = (component) =>
  hasUnsavedChangesContract(component) ? confirmLeaveUnsaved(inject(DialogService), component) : true;

/**
 * Browser tab close / reload while there are unsaved changes: the browser's own prompt. Call from an injection context.
 */
export function guardUnsavedOnUnload(page: HasUnsavedChanges): void {
  if (typeof window === 'undefined') return;
  const onUnload = (e: BeforeUnloadEvent) => {
    if (!page.hasUnsavedChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onUnload);
  inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', onUnload));
}
