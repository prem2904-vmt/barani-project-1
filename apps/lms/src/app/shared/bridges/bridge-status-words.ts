import type { StatusWords } from '../utils/status-words';
import { statusWords } from '../utils/status-words';
import { bridgeStatusWord, linkStateWord } from './bridge-status';

/** Bridge row status as words (design D): Online = done; Offline / Error = late; waiting / never = normal. */
export function bridgeStatusWords(status: string | null | undefined, seen?: string | null): StatusWords {
  const s = status ?? 'never';
  const tone = s === 'online' ? 'done' : s === 'offline' || s === 'error' ? 'late' : 'normal';
  return statusWords(bridgeStatusWord(s).label, seen, tone);
}

/** An analyzer's link on a Bridge as words: Connected = done; Error = late; everything else (waiting, connecting, stopped, no report) = normal. */
export function linkStateWords(state: string | null | undefined, lastResult?: string | null): StatusWords {
  const tone = state === 'connected' ? 'done' : state === 'error' ? 'late' : 'normal';
  return statusWords(linkStateWord(state).label, lastResult, tone);
}
