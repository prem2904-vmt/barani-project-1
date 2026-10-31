import { MessageSummaryDto } from './instrument.models';

/**
 * "Test with an analyzer ID" (owner 2026-10-31): a ONE-TIME, temporary
 * mapping used while installing an analyzer that sends its own sample number
 * (e.g. "8507") instead of a Prefrontal tube number. The next run carrying
 * that analyzer ID goes to the picked sample, then the server consumes the
 * mapping. It only lives while the instrument screen keeps it alive (ping
 * every 15 s); Close, leaving the page, closing the window and logout end it.
 *
 * Pure helpers (spec'd). The wire shapes below are what the UI assumes; the
 * HTTP calls all live in `test-mapping-api.service.ts`.
 */

/** Keep-alive cadence (server drops the session 60 s after the last ping). */
export const TEST_MAPPING_PING_MS = 15_000;
/** How often the card asks "anything yet?" while a test runs. */
export const TEST_MAPPING_POLL_MS = 3_000;

/** The server's default quiet window: the run stays open while that analyzer
 *  ID keeps sending and ends this long after the last new message. */
export const TEST_MAPPING_QUIET_S = 90;

/** Who may run a test (the server's set). */
export const TEST_MAPPING_PERMS = ['manage_lab_settings', 'manage_tenant'];

export type TestSessionStatus = 'waiting' | 'received' | 'ended';

/** POST /api/instruments/{id}/test-session body. `sampleId` = the order
 *  sample guid OR the tube barcode as typed (the server resolves either). */
export interface StartTestSessionBody { analyzerId: string; sampleId: string }

/** POST …/test-session → (the same user starting again replaces their own session) */
export interface StartTestSessionDto {
  sessionId: string;
  status: TestSessionStatus;
  pingEverySeconds?: number;
  expiresAfterSeconds?: number;
  quietSeconds?: number;
}

/** GET …/test-session/{sid} → */
export interface TestSessionDto {
  sessionId?: string;
  status: TestSessionStatus;
  analyzerId: string;
  sampleId: string;
  /** The tube's barcode (what the card shows). */
  barcode?: string | null;
  routedCount: number;
  /** While `received`: seconds of quiet left before the run finishes. */
  quietSecondsLeft?: number | null;
  /** 'closed' | 'expired' | 'completed'. */
  endedReason?: string | null;
}

/** The one running test the screen holds (the server's id + what was asked). */
export interface ActiveTestMapping {
  instrumentId: string;
  sessionId: string;
  analyzerId: string;
  sampleId: string;
  /** The tube number the user typed / the server printed — what the card shows. */
  sampleLabel: string;
  status: TestSessionStatus;
  routedCount: number;
  quietSecondsLeft: number | null;
}

export function testSessionUrl(instrumentId: string, sessionId?: string, tail?: 'ping' | 'reingest'): string {
  let u = `/api/instruments/${encodeURIComponent(instrumentId)}/test-session`;
  if (sessionId) u += `/${encodeURIComponent(sessionId)}`;
  if (tail) u += `/${tail}`;
  return u;
}

/** Analyzer IDs compare trimmed + case-insensitive (what a tech types vs.
 *  what the analyzer sent). */
export function sameAnalyzerId(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').trim().toUpperCase();
  return !!x && x === (b ?? '').trim().toUpperCase();
}

/** The analyzer ID of the newest UNMATCHED, non-QC result (the card's prefill). */
export function latestUnmatchedAnalyzerId(msgs: readonly MessageSummaryDto[]): string {
  let best: MessageSummaryDto | null = null;
  for (const m of msgs) {
    if (m.state !== 'unmatched' || m.isQc || !(m.sampleId ?? '').trim()) continue;
    if (!best || Date.parse(m.receivedAt) > Date.parse(best.receivedAt)) best = m;
  }
  return best?.sampleId?.trim() ?? '';
}

/** A result that arrived through a test mapping (server message metadata). */
export function isViaTestMapping(m: Pick<MessageSummaryDto, 'viaTestAlias'> | null | undefined): boolean {
  return !!m?.viaTestAlias;
}

/** Can the row offer "Test with this ID"? Unmatched, not QC, has an ID. */
export function canTestWithId(m: MessageSummaryDto): boolean {
  return m.state === 'unmatched' && !m.isQc && !!(m.sampleId ?? '').trim();
}

/** The card's live line, in plain words. */
export function testMappingLine(t: Pick<ActiveTestMapping, 'analyzerId' | 'sampleLabel' | 'status' | 'routedCount' | 'quietSecondsLeft'>): string {
  if (t.status === 'waiting') return `Waiting for ${t.analyzerId} → sample ${t.sampleLabel}…`;
  const left = t.quietSecondsLeft == null ? '' : ` (${fmtMinSec(t.quietSecondsLeft)} left)`;
  return `Receiving from ${t.analyzerId} → ${t.sampleLabel} — ${resultsWord(t.routedCount)} so far. `
    + `Finishes after ${TEST_MAPPING_QUIET_S} s with no new results${left}.`;
}

/** 72 → "1:12", 5 → "0:05" (negatives clamp to 0). */
export function fmtMinSec(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const resultsWord = (n: number) => `${n} ${n === 1 ? 'result' : 'results'}`;

/** The note left on the empty card once a test ended. */
export function endedNote(t: Pick<ActiveTestMapping, 'analyzerId' | 'sampleLabel' | 'routedCount'>, reason?: string | null): string {
  if (reason === 'replaced') return 'Ended — started again elsewhere.';
  if (t.routedCount > 0) return `Done — ${resultsWord(t.routedCount)} attached to ${t.sampleLabel}.`;
  if (reason === 'expired') return `The test for ${t.analyzerId} timed out — nothing arrived.`;
  return `The test for ${t.analyzerId} ended — nothing arrived.`;
}

/** "The server no longer knows this session" (expired / restarted / ended
 *  elsewhere): a `not_found`-style code, or a bare 404 (ApiService keeps
 *  only the message, which names the status). */
/** The same user started the test again (another tab / window): the server answers `session_replaced`. */
export function isSessionReplaced(e: { code?: string } | null | undefined): boolean {
  return (e?.code ?? '').toLowerCase() === 'session_replaced';
}

export function isSessionGone(e: { code?: string; message?: string } | null | undefined): boolean {
  const code = (e?.code ?? '').toLowerCase();
  if (code === 'session_gone' || code === 'not_found' || code.endsWith('session_not_found') || code === 'session_ended') return true;
  return /\b404\b/.test(e?.message ?? '');
}

/**
 * The server's error codes in plain words. Start: invalid_analyzer_id,
 * sample_not_found, session_in_use (409 — someone else is testing this
 * analyzer; the server's message names who / since when when it can),
 * instrument_inactive. Re-run: not_unmatched, no_alias, too_old, session_gone,
 * sample_not_found. Anything else keeps the server's message.
 */
export function testMappingErrorText(e: { code?: string; message?: string }, ctx: { sample?: string; analyzerId?: string } = {}): string {
  const code = (e.code ?? '').toLowerCase();
  const msg = (e.message ?? '').trim();
  const serverWords = msg && msg.toLowerCase() !== code ? msg : '';
  switch (code) {
    case 'invalid_analyzer_id': return 'That analyzer ID can’t be used — type the ID exactly as the analyzer sends it.';
    case 'sample_not_found': return ctx.sample ? `Sample ${ctx.sample} not found.` : 'That sample was not found.';
    case 'session_in_use': return serverWords || 'Someone else is testing this analyzer right now — try again when they finish.';
    case 'instrument_inactive': return 'This analyzer is switched off — turn it on before testing.';
    case 'not_unmatched': return 'That result is no longer unmatched.';
    case 'no_alias': return ctx.analyzerId ? `The running test isn’t for ${ctx.analyzerId}.` : 'The running test isn’t for that ID.';
    case 'too_old': return 'That result is older than 10 minutes — run the sample on the analyzer again.';
    case 'session_gone': return 'The test has ended.';
    case 'session_replaced': return 'Ended — started again elsewhere.';
    case 'sample_not_testable': return 'Pick a tube that has no results yet.';
    default: return msg || 'Something went wrong — try again.';
  }
}
