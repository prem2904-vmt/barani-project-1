import { InjectionToken } from '@angular/core';

/**
 * The dialog the engine asks (never window.confirm / window.prompt). Prepare's engine injected its pf-kit COPY of
 * the LMS DialogService; here the lib cannot reach into the app, so it asks this token and the LMS app provides it
 * with its own DialogService (`{ provide: FeDialog, useExisting: DialogService }` in app.config.ts). The request
 * shapes below are the subset of the LMS `DialogRequest` the engine uses (a typed mirror; the app spec
 * `fe-dialog.provider.spec.ts` proves the LMS service satisfies it).
 */
export interface FeDialogRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  items?: string[];
  question?: string;
  placeholder?: string;
  initialValue?: string;
  multiline?: boolean;
  inputType?: 'text' | 'number' | 'email' | 'tel';
  required?: boolean;
  checkbox?: { label: string; initial?: boolean };
}

export interface FeDialogAction {
  value: string;
  label: string;
  variant?: 'primary' | 'secondary';
  requiresCheck?: boolean;
}

export interface FeDialogActionResult {
  action: string | null;
  checked: boolean;
}

export interface FeDialogApi {
  prompt(req: FeDialogRequest): Promise<string | null>;
  confirm(req: FeDialogRequest): Promise<boolean>;
  alert(req: Omit<FeDialogRequest, 'cancelLabel'>): Promise<void>;
  actions(req: FeDialogRequest & { actions: FeDialogAction[] }): Promise<FeDialogActionResult>;
}

/**
 * Not provided ⇒ every question is answered "no" (confirm false, prompt null, no action): a missing provider can
 * never make the engine delete or overwrite a doctor's answers. The app always provides the real one.
 */
class RefusingDialog implements FeDialogApi {
  prompt(): Promise<string | null> { return Promise.resolve(null); }
  confirm(): Promise<boolean> { return Promise.resolve(false); }
  alert(): Promise<void> { return Promise.resolve(); }
  actions(): Promise<FeDialogActionResult> { return Promise.resolve({ action: null, checked: false }); }
}

export const FeDialog = new InjectionToken<FeDialogApi>('FeDialog', {
  providedIn: 'root',
  factory: () => new RefusingDialog(),
});
