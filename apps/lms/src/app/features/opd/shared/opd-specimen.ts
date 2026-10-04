/**
 * OPD investigations: which of the picked lab tests still need a specimen
 * chosen before the order can go through. Pure logic only — no Angular, no
 * HTTP — reusing the lab's ONE specimen rule
 * (`shared/utils/micro-specimen.ts`, the TS twin of the server's
 * `SpecimenRules`), never re-implemented here.
 *
 * Used by both the doctor's Complete (consult investigations, ItemDto —
 * prefrontal-mw `Services/Opd/Consult/ConsultDtos.cs`) and the front desk's
 * Checkout (`CheckoutRequest.LabTestSpecimens`,
 * `Services/Opd/Frontdesk/OpdDeskDtos.cs`): a "choose"-mode test picked
 * without its specimen makes the server refuse the WHOLE order with 400
 * `specimen_required` (`OrderService.PlanSpecimensAsync`) — catching it here
 * first lets the screen point at the exact test instead of a dead end.
 *
 * The picker UI is `opd-specimen-picker.component.ts` in this same folder.
 */
import { asksSpecimen } from '../../../shared/utils/micro-specimen';

/** A picked lab test in an OPD investigations / lab-tests list. */
export interface OpdInvestigationItem {
  testId: string;
  name: string;
  /** The chosen specimen — a master CODE (new pickers) or NAME (kept for
   *  older drafts); '' / null / undefined = not chosen yet. */
  specimen?: string | null;
}

/** Minimal shape of a catalogue test this module needs to read its mode. */
export interface OpdSpecimenTest {
  parameters?: string | null;
}

export type OpdTestLookup = Record<string, OpdSpecimenTest | undefined>;

/** Resolve a bundle member (package/profile item) to its catalogue row, for
 *  the rare case an OPD investigation carries a bundle — mirrors
 *  `order-create`'s `byId.get` pattern. Optional: OPD investigations are
 *  ordinary individual tests today. */
export type OpdMemberLookup = (id: string) => OpdSpecimenTest | undefined;

/** Does this picked test ask the doctor / desk to choose its specimen? */
export function opdAsksSpecimen(t: OpdSpecimenTest | undefined, memberById?: OpdMemberLookup): boolean {
  return !!t && asksSpecimen(t, memberById);
}

/**
 * The picked items that ask for a specimen (Test Master mode "choose") and
 * don't have one yet. Empty = Complete / Checkout is free to submit — the
 * caller runs this BEFORE calling the server, same as `order-create`'s
 * `requireSpecimens()`, so the screen can point at the exact rows instead of
 * surfacing the server's flattened message.
 */
export function missingSpecimens(
  items: OpdInvestigationItem[],
  testsById: OpdTestLookup,
  memberById?: OpdMemberLookup,
): OpdInvestigationItem[] {
  return items.filter(i => opdAsksSpecimen(testsById[i.testId], memberById) && !(i.specimen ?? '').trim());
}

/**
 * testId → specimen for the server's `CreateOrderInput.Specimens` /
 * `CheckoutRequest.LabTestSpecimens` — only the items that actually carry a
 * choice (a "none"/"fixed" test is never sent one; the server stamps Fixed
 * itself). Null when nothing is carried, so callers can omit the field.
 */
export function specimenPayload(items: OpdInvestigationItem[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const i of items) {
    const v = (i.specimen ?? '').trim();
    if (v) out[i.testId] = v;
  }
  return Object.keys(out).length ? out : null;
}
