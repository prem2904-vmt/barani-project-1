import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PrinterService, LabelPrinterState } from './printer.service';
import { PrintConfigService } from './print-config.service';
import { LabelData } from './label-render';
import { DialogService, DialogAction } from '../services/dialog.service';
import { ToastService } from '../services/toast.service';
import { OrderSample } from '../../shared/models/order.model';
import { Patient, patientDisplayName } from '../../shared/models/patient.model';
import { tubeDepartmentCodes } from '../../shared/utils/shared-tube';
import { labelTubeLine } from '../../features/frontdesk/post-payment/label-card.component';

/** The route of the per-station Printing setup (label printer, label size). */
export const PRINTING_SETTINGS_ROUTE = '/printing';

/** Dialog copy — exported so specs (and docs) pin the exact wording. */
export const NO_LABEL_PRINTER_TITLE = 'No label printer connected on this device';

type LabelPatient = Pick<Patient, 'displayName' | 'firstName' | 'fathersName' | 'age' | 'dateOfBirth' | 'sex' | 'mrn'> & { title?: string | null };

/** One "Print label" request from any screen. */
export interface TubeLabelJob {
  /** The tubes to label (one label each). */
  samples: OrderSample[];
  /** Patient for every label; falls back to each sample's `order.patient`. */
  patient?: LabelPatient | null;
  /** Name to print when neither patient carries one. */
  fallbackName?: string;
  /**
   * WEB BROWSER ONLY, and only after the user explicitly picks "Print via
   * system dialog" (now, or remembered via "Don't ask again"): render the
   * `.pf-print-label` cards and run the label-sized `printTubeLabels()` path.
   * Never invoked automatically, never on Electron / the native app.
   */
  systemPrint: () => void;
}

export type LabelPrintOutcome =
  | 'printed'     // every label went to the label printer
  | 'partial'     // some labels printed, some failed
  | 'failed'      // printer reachable but every label failed
  | 'system'      // web: the user chose the label-sized system dialog
  | 'no-printer'  // nothing printed (dialog dismissed / sent to setup)
  | 'empty';      // no tubes

/**
 * LabelPrintService — the ONE entry point every "Print label" button calls.
 *
 * Owner 2026-09-28: "print label is only for the printer". Tube labels go
 * straight to this station's label printer; when there is none (or it's
 * off) NOTHING prints — a dialog explains and offers Set up / Retry. Only a
 * plain web browser (which can't reach a label printer at all) may offer the
 * label-sized system print dialog, and only when the user picks it.
 *
 * Other prints (reports, invoices, the patient ID card, inventory / stores
 * labels) don't use this and are unaffected.
 */
@Injectable({ providedIn: 'root' })
export class LabelPrintService {
  private readonly printer = inject(PrinterService);
  private readonly printConfig = inject(PrintConfigService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  async printTubeLabels(job: TubeLabelJob): Promise<LabelPrintOutcome> {
    if (!job.samples?.length) {
      this.toasts.warning('No tubes to label');
      return 'empty';
    }
    for (;;) {
      const state = await this.printer.labelPrinterState();

      // Web only: the user already chose the system dialog as this device's
      // label route ("Don't ask again"). Electron / native ignore it.
      if (state.platform === 'web' && this.printConfig.config().labelRoute === 'system') {
        job.systemPrint();
        return 'system';
      }

      let offline = false;
      if (state.configured) {
        const r = await this.sendDirect(job);
        if (!r.offline) return r.outcome;
        offline = true;
      }

      const { action, checked } = await this.askNoPrinter(state, offline);
      if (action === 'retry' && offline) continue;
      if (action === 'setup') {
        void this.router.navigate([PRINTING_SETTINGS_ROUTE]);
        return 'no-printer';
      }
      if (action === 'system' && state.platform === 'web') {
        if (checked) this.printConfig.setLabelRoute('system');
        job.systemPrint();
        return 'system';
      }
      return 'no-printer';
    }
  }

  /** The label content for one tube (what the direct printer renders). */
  labelData(s: OrderSample, patient?: LabelPatient | null, fallbackName?: string): LabelData {
    const p = (patient ?? s.order?.patient ?? null) as LabelPatient | null;
    const code = s.barcode ?? s.id;
    const mrn = p?.mrn ?? undefined;
    return {
      code,
      qrValue: mrn ? `${mrn}|${code}` : code,
      // Just the name — age/sex + MRN print as their own parts of the label.
      patientName: (p && patientDisplayName(p)) || fallbackName || 'Patient',
      ageSex: labelAgeSex(p),
      mrn,
      deptCode: tubeDepartmentCodes(s),
      tube: labelTubeLine(s),
      outsourced: !!s.outsourcedVendorId,
    };
  }

  /** Stream every label to the printer. Stops at the first "can't reach the
   *  printer" failure so the dialog (with Retry) takes over. */
  private async sendDirect(job: TubeLabelJob): Promise<{ outcome: LabelPrintOutcome; offline: boolean }> {
    const opts = this.printConfig.labelOpts();
    const n = job.samples.length;
    this.toasts.info(`Printing ${n} label${n > 1 ? 's' : ''}…`);
    let ok = 0, fail = 0;
    for (const s of job.samples) {
      const res = await this.printer
        .printLabelData(this.labelData(s, job.patient, job.fallbackName), opts)
        .catch((e: unknown) => ({ ok: false, direct: true, offline: false, error: (e as Error)?.message }));
      if (res.ok) { ok++; continue; }
      if (res.offline && ok === 0) return { outcome: 'no-printer', offline: true };
      fail++;
      if (res.error) this.toasts.error(res.error);
    }
    if (ok) this.toasts.success(`Printed ${ok} label${ok > 1 ? 's' : ''}`);
    else this.toasts.error('Label print failed');
    return { outcome: fail === 0 ? 'printed' : ok ? 'partial' : 'failed', offline: false };
  }

  private askNoPrinter(state: LabelPrinterState, offline: boolean) {
    const web = state.platform === 'web';
    const actions: DialogAction[] = [];
    let message: string;
    if (offline && state.name) {
      message = `"${state.name}" isn't responding. Turn it on and check its cable or Bluetooth, then retry. Labels print only on the label printer.`;
      actions.push({ value: 'setup', label: 'Set up label printer', variant: 'secondary' });
      actions.push({ value: 'retry', label: 'Retry', variant: 'primary' });
    } else if (web) {
      message = 'Labels print only on a label printer. This browser can\'t reach one directly — use the Prefrontal desktop or tablet app, or print through the system dialog on a label-sized page.';
      actions.push({ value: 'setup', label: 'Set up label printer', variant: 'primary' });
    } else {
      message = 'Labels print only on this station\'s label printer. Connect one in Printing, then print again.';
      actions.push({ value: 'setup', label: 'Set up label printer', variant: 'primary' });
    }
    // Secondary, explicit, web-only — never the default and never automatic.
    if (web) actions.unshift({ value: 'system', label: 'Print via system dialog', variant: 'secondary' });
    return this.dialog.actions({
      title: NO_LABEL_PRINTER_TITLE,
      message,
      icon: 'printer',
      actions,
      cancelLabel: 'Cancel',
      checkbox: web ? { label: 'Don\'t ask again on this device — use the system dialog for labels' } : undefined,
    });
  }
}

/** "52Y M" — age + sex initial for the label's name line. */
export function labelAgeSex(p: Pick<Patient, 'age' | 'dateOfBirth' | 'sex'> | null | undefined): string {
  if (!p) return '';
  let age = p.age ?? null;
  if (age == null && p.dateOfBirth) {
    const d = new Date(p.dateOfBirth), now = new Date();
    age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  }
  const s = p.sex ? p.sex.charAt(0).toUpperCase() : '';
  return [age != null ? `${age}Y` : null, s].filter(Boolean).join(' ');
}
