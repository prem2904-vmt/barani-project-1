/**
 * "Not collected" — ONE definition for every screen (collect drawer, Frontdesk
 * work row, order drawer timeline). QA #6.
 *
 * "Can't collect" on the collection screen rejects a PENDING tube with a reason
 * (PATCH /api/samples/{id}/reject). The server keeps it as status 'rejected'
 * with NO collection stamp; a drawn tube the lab rejected later keeps its
 * collectedAt. The mw mirror is SampleService.IsNotCollected.
 *
 * A not-collected tube is a SINK: it is never "drawn", never "dispatched" and
 * never dispatchable. It only leaves this state through Recollect
 * (PATCH /api/samples/{id}/recollect — the patient is back; the tube returns to
 * the collection queue as pending) or by cancelling its tests on the order.
 */
export interface SampleStateLike {
  status?: string | null;
  collectedAt?: string | null;
  rejectedReason?: string | null;
}

export function isNotCollected(s: SampleStateLike): boolean {
  return s.status === 'rejected' && !s.collectedAt;
}

/** Drawn at the counter (or further along) — not pending and not a
 *  not-collected tube. */
export function isDrawn(s: SampleStateLike): boolean {
  return !!s.status && s.status !== 'pending' && !isNotCollected(s);
}

export function notCollectedSamples<T extends SampleStateLike>(samples: readonly T[] | null | undefined): T[] {
  return (samples ?? []).filter(isNotCollected);
}

/** The reason code's label — "Patient refused — anxious" → "Patient refused".
 *  The collect screen stores `${label} — ${note}`; rows show the label only. */
export function shortReason(reason: string | null | undefined): string {
  return (reason ?? '').split(' — ')[0].trim();
}

/**
 * "Not collected — Patient refused" (every tube) or
 * "1 of 2 not collected — Vein not found" (partial). `full` keeps the free-text
 * note (drawer); the work row shows the reason label only. Null when the order
 * has no not-collected tube.
 */
export function notCollectedLabel(
  samples: readonly SampleStateLike[] | null | undefined,
  opts: { full?: boolean } = {},
): string | null {
  const all = samples ?? [];
  const nc = notCollectedSamples(all);
  if (nc.length === 0) return null;
  const reasons = [...new Set(nc
    .map(s => (opts.full ? (s.rejectedReason ?? '').trim() : shortReason(s.rejectedReason)))
    .filter(Boolean))];
  const reason = reasons.length === 0 ? '' : reasons.length === 1 ? reasons[0] : `${reasons[0]} +${reasons.length - 1}`;
  const head = nc.length === all.length ? 'Not collected' : `${nc.length} of ${all.length} not collected`;
  return reason ? `${head} — ${reason}` : head;
}
