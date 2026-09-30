/** Which step-to-step navigations slide, and in which direction. A flow
 *  moves FORWARD (current screen exits left, next enters from the right)
 *  and BACK reverses it. Anything not listed opens as a page
 *  (slide-transition.ts, page-open.service.ts). */
export function slideDirection(from: string, to: string): 'forward' | 'back' | null {
  const path = (u: string) => (u || '').split(/[?#]/)[0];
  const f = path(from), t = path(to);
  const isCollect = (u: string) => u.startsWith('/lab/collect');
  const isFrontdesk = (u: string) => u === '/frontdesk' || u.startsWith('/frontdesk/');
  if (isFrontdesk(f) && isCollect(t)) return 'forward';
  if (isCollect(f) && isFrontdesk(t)) return 'back';
  // Appointments: the calendar's next step is booking (and back).
  if (f === '/frontdesk/appointments' && t === '/frontdesk/appointments/new') return 'forward';
  if (f === '/frontdesk/appointments/new' && t === '/frontdesk/appointments') return 'back';
  return null;
}

/** The slide a draft-shelf chip asked for (router state), if any. */
export function draftSwapDirection(state: unknown): 'forward' | 'back' | null {
  const d = (state as { pfDraftSwap?: unknown } | null | undefined)?.pfDraftSwap;
  return d === 'forward' || d === 'back' ? d : null;
}
