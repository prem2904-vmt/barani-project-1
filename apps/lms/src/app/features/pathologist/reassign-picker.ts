import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { OrderTest } from '../../shared/models/order.model';

/** One validator the result can go to (GET /api/validation/{id}/reassign-options). */
export interface ReassignOption { id: string; name: string; assigned: boolean }

/**
 * Reassign picker (replaces the old "paste the user GUID" prompt): the
 * server lists the active validators who COVER this result's department
 * (its validator pool, unassigned consultants, admins) minus the caller;
 * the user picks one in a DialogService choice — never a native control.
 * Resolves the chosen user id, or null (cancelled / nobody to pick).
 */
export async function pickReassignee(
  api: ApiService, dialog: DialogService, toasts: ToastService, t: OrderTest,
): Promise<string | null> {
  let options: ReassignOption[];
  try {
    options = (await firstValueFrom(api.get<ReassignOption[]>(`/api/validation/${t.id}/reassign-options`))) ?? [];
  } catch (e) {
    toasts.error(ApiError.from(e).message);
    return null;
  }
  if (!options.length) {
    toasts.error('No other validator covers this department.');
    return null;
  }
  const current = options.find(o => o.assigned);
  return dialog.choose({
    title: 'Reassign to another validator',
    message: `${t.test?.name ?? 'This result'} goes to their queue and they get a notification.`,
    confirmLabel: 'Reassign',
    choices: options.map(o => ({ value: o.id, label: o.name, hint: o.assigned ? 'Currently assigned' : undefined })),
    initialChoice: (options.find(o => !o.assigned) ?? current ?? options[0]).id,
  });
}
