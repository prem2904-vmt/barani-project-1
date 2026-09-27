import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { Order } from '../../../shared/models/order.model';
import { isDrawn, isNotCollected, notCollectedSamples } from '../../../shared/utils/sample-not-collected';

type DrawerPatient = Pick<Patient, 'firstName' | 'fathersName' | 'displayName' | 'age' | 'sex'> | null | undefined;

/** The patient's FULL display name for a drawer header — never shortened
 *  (formatPatientInfo cuts at 15 chars; ND §5 forbids that here). */
export function drawerName(p: DrawerPatient): string {
  return patientDisplayName(p) || 'Patient';
}

/** "22/M" for the quiet meta line; '' when neither age nor sex is known. */
export function drawerAgeSex(p: DrawerPatient): string {
  if (!p) return '';
  const age = p.age != null && `${p.age}`.trim() !== '' ? `${p.age}` : '';
  const t = (p.sex ?? '').trim().toLowerCase();
  const sex = !t ? '' : t.startsWith('m') ? 'M' : t.startsWith('f') ? 'F' : t.startsWith('o') ? 'O' : t.charAt(0).toUpperCase();
  if (!age && !sex) return '';
  return `${age || '—'}/${sex || '—'}`;
}

/** Order status → the ND chip's dot. The chip itself is always neutral;
 *  the dot is violet while in flight / done, muted before billing and red
 *  only for a real stop (cancelled / rejected). */
export type OrderStatusState = 'idle' | 'active' | 'done' | 'stopped';
export function orderStatusState(o: Pick<Order, 'status'>): OrderStatusState {
  switch (o.status) {
    case 'cancelled':
    case 'rejected': return 'stopped';
    case 'completed':
    case 'validated':
    case 'delivered': return 'done';
    case 'draft':
    case 'created': return 'idle';
    default: return 'active';
  }
}

// ── Order drawer timeline (Billing → Sample → Dispatch → Result → Report) ──
// Pure so it's testable; the landing delegates pipeline()/stepCaption() here.
// QA #6: a "Can't collect" tube (rejected with no draw — see
// shared/utils/sample-not-collected) used to count as "collected", so the
// Sample step read done and Dispatch lit up as the current step. Now the
// Sample step STOPS with "Sample — not collected (reason)" and transport
// steps only look at tubes that were actually drawn.
export type PipelineState = 'done' | 'active' | 'pending' | 'stopped';
export interface PipelineStep { label: string; state: PipelineState }
type DrawerOrder = Pick<Order, 'status' | 'samples'>;

export function drawerPipeline(o: DrawerOrder): PipelineStep[] {
  const samples = o.samples ?? [];
  const live = samples.filter(s => !isNotCollected(s));
  const nc = samples.length - live.length;
  const billDone = o.status !== 'draft' && o.status !== 'created';
  const collected = live.some(s => isDrawn(s));
  const dispatched = live.some(s => s.status === 'dispatched' || s.status === 'in_transit'
    || s.status === 'received' || s.status === 'processing');
  const received = live.some(s => s.status === 'received' || s.status === 'processing');
  // "Report" step is done once the order has reached validated /
  // partially_validated / delivered / completed — those all mean
  // the lab work is signed off and the report is generated.
  const reportDone = o.status === 'validated' || o.status === 'partially_validated'
                  || o.status === 'delivered'  || o.status === 'completed';
  // "Result" step is done as soon as every test has a value entered
  // or already validated. Differs from reportDone — entered values
  // still need a pathologist's signature before the report exists.
  const allTests = live.flatMap(s => s.tests ?? []);
  const allTestsResulted = allTests.length > 0
    && allTests.every(t => t.status === 'validated' || t.status === 'entered');
  const anyResult = allTests.some(t => t.status === 'validated' || t.status === 'entered');
  const sample: PipelineState = nc > 0 ? 'stopped' : collected ? 'done' : billDone ? 'active' : 'pending';
  return [
    { label: 'Billing', state: billDone ? 'done' : 'active' },
    { label: 'Sample', state: sample },
    { label: 'Dispatch', state: received ? 'done' : dispatched ? 'done' : collected ? 'active' : 'pending' },
    { label: 'Result', state: allTestsResulted ? 'done' : anyResult ? 'active' : received ? 'active' : 'pending' },
    { label: 'Report', state: reportDone ? 'done' : anyResult ? 'active' : 'pending' },
  ];
}

export function drawerStepCaption(o: DrawerOrder, step: PipelineStep): string {
  if (step.state === 'pending') return 'Pending';
  const samples = o.samples ?? [];
  switch (step.label) {
    case 'Billing': return step.state === 'done' ? 'Billed' : 'Billing in progress';
    case 'Sample': {
      if (step.state === 'stopped') {
        // "Sample — not collected (Patient refused)"; partial keeps the count.
        const nc = notCollectedSamples(samples);
        const reasons = [...new Set(nc.map(s => (s.rejectedReason ?? '').trim()).filter(Boolean))];
        const head = nc.length === samples.length ? 'Not collected' : `${nc.length} of ${samples.length} not collected`;
        return reasons.length ? `${head} (${reasons.join(', ')})` : head;
      }
      const total = samples.length;
      const collected = samples.filter(s => isDrawn(s)).length;
      const received = samples.filter(s => s.status === 'received' || s.status === 'processing').length;
      return step.state === 'done' ? `${received}/${total} received at lab` : `${collected}/${total} collected`;
    }
    case 'Result': {
      const all = samples.filter(s => !isNotCollected(s)).flatMap(s => s.tests ?? []);
      const validated = all.filter(t => t.status === 'validated' || t.status === 'entered').length;
      return `${validated}/${all.length} tests resulted`;
    }
    case 'Report': {
      if (step.state !== 'done') return 'Awaiting validation';
      if (o.status === 'delivered') return 'Report delivered';
      if (o.status === 'partially_validated') return 'Partial ready · awaiting full sign-off';
      // 'validated' / 'completed' → ready for handover at the desk.
      return 'Ready for delivery';
    }
    default: return '';
  }
}
