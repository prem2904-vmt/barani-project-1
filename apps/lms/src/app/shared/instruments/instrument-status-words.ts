import type { InstrumentDto } from './instrument.models';
import { statusSubline, statusWord } from './instrument-config';
import { statusWords, type StatusWords } from '../utils/status-words';

/**
 * An analyzer's Status cell as words (design D). Online = done (green); Offline / Not connected / Error = late (rose);
 * Waiting, Connector running, Never connected = normal. Line 2 is the existing sub-line (port, "connected from", last seen,
 * or the error detail).
 */
export function instrumentStatusWords(d: InstrumentDto | null | undefined, now: number = Date.now()): StatusWords {
  const s = d?.status ?? 'never';
  const tone = s === 'online' ? 'done' : s === 'offline' || s === 'not_connected' || s === 'error' ? 'late' : 'normal';
  return statusWords(statusWord(s).label, statusSubline(d, now), tone);
}
