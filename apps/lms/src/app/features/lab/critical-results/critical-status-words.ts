import { statusWords, type StatusWords } from '../../../shared/utils/status-words';

/** The bits of a critical-result event the Status cell reads. */
export interface CriticalWordsInput {
  status: string;
  acknowledgedAt?: string | null; acknowledgedByName?: string | null;
  communicatedAt?: string | null; communicatedToName?: string | null; communicatedToRole?: string | null;
  communicationMethod?: string | null; communicationNotes?: string | null;
}

/**
 * Critical-register Status cell as words (design D). Line 1: Not acknowledged (late, rose) / Acknowledged (normal) /
 * Communicated (done, green). Line 2: who acknowledged / who was told, already-formatted by the caller as `lines`.
 */
export function criticalStatusWords(status: string, lines: string[] = []): StatusWords {
  const detail = lines.filter(Boolean).join(' · ');
  switch (status) {
    case 'communicated': return statusWords('Communicated', detail, 'done');
    case 'acknowledged': return statusWords('Acknowledged', detail, 'normal');
    default: return statusWords('Not acknowledged', detail, 'late');
  }
}
