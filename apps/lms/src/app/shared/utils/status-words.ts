import type { WorkStatus, WorkTone } from './work-grid';

/**
 * STATUS WORDS (owner design D, 2026-11-21): a table's status cell is two lines of plain words, never a pill or a dot.
 *   line 1 (`now`)    — what is happening now ("Billed", "In the lab", "Critical", "Delivered")
 *   line 2 (`detail`) — the detail or what comes next ("0 of 2 tubes collected", "Next: send to lab")
 * Colour rule (the only one): `late` = soft rose text (late, blocked, failed, sent back, due), `done` = soft green
 * text (finished), everything else `normal` text. Drawn ONLY by `<pf-status-words>` / `StatusWordsCellComponent`
 * (shared/components/status-words) — never a screen-local pill.
 */
export type StatusTone = 'normal' | 'late' | 'done';

export interface StatusWords {
  now: string;
  detail?: string | null;
  tone: StatusTone;
  /** Optional tooltip (a longer reason). */
  title?: string | null;
}

/** Build the two lines (an empty detail drops line 2). */
export function statusWords(now: string, detail?: string | null, tone: StatusTone = 'normal', title?: string | null): StatusWords {
  const d = (detail ?? '').trim();
  return { now: (now ?? '').trim() || '—', detail: d || null, tone, ...(title ? { title } : {}) };
}

/** The old pill tones → the word colour: green = done, rose = late; violet / sky / neutral read as normal text. */
export function toneOfWork(t: WorkTone | string | null | undefined): StatusTone {
  return t === 'green' ? 'done' : t === 'rose' ? 'late' : 'normal';
}

/**
 * A WorkStatus ("Claimed · You", tone) → words: the label's head is line 1, anything after " · " joins the detail.
 * `detail` (the screen's own second line) comes after the label's tail.
 */
export function fromWorkStatus(s: WorkStatus, detail?: string | null, opts: { late?: boolean } = {}): StatusWords {
  const [head, ...rest] = String(s.label ?? '').split(' · ');
  const tail = [rest.join(' · '), detail ?? ''].map(x => x.trim()).filter(Boolean).join(' · ');
  const tone = opts.late && s.tone !== 'green' ? 'late' : toneOfWork(s.tone);
  return statusWords(head, tail, tone);
}

/** One line for an aria-label / tooltip / filter value: "Billed, 0 of 2 tubes collected". */
export function statusWordsText(w: StatusWords | null | undefined): string {
  if (!w) return '';
  return w.detail ? `${w.now}, ${w.detail}` : w.now;
}

/** Simple on/off lists (Settings): Active = normal, Inactive = quiet normal words (never rose: off is not late). */
export function activeWords(active: boolean, detail?: string | null): StatusWords {
  return statusWords(active ? 'Active' : 'Inactive', detail, 'normal');
}
