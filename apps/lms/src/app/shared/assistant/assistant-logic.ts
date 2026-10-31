import type { PfSelectOption } from '../primitives/select.component';
import type {
  AssistantProvider, AssistantProviderId, AssistantReply, AssistantSuggestion, AssistantTestRef, AssistantTurn, MappingSuggestion,
} from './assistant.models';

/**
 * Pure helpers of the assistant panel (DOM-free, unit-tested). Everything the
 * server returns about a model answer is treated as UNTRUSTED input: shapes
 * are checked, strings clipped, unknown kinds dropped.
 */

export const PROVIDER_IDS: readonly AssistantProviderId[] = ['gemini', 'claude'];
const DEFAULT_LABELS: Record<AssistantProviderId, string> = { gemini: 'Gemini', claude: 'Claude' };

/** The longest message a person can send. */
export const MAX_PROMPT_CHARS = 2000;
/** How many earlier turns go with each question (oldest dropped first).
 *  Must not exceed the server's Ai:Assistant:MaxMessages (20) — more is a
 *  `bad_request`. */
export const MAX_HISTORY_TURNS = 20;

const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, max);

/** Server list → the two known providers, in a fixed order; anything else dropped. */
export function normaliseProviders(raw: unknown): AssistantProvider[] {
  const list = Array.isArray(raw) ? raw : rec(raw) && Array.isArray(raw['data']) ? raw['data'] as unknown[] : [];
  const byId = new Map<AssistantProviderId, AssistantProvider>();
  for (const p of list) {
    if (!rec(p)) continue;
    const id = str(p['id']).toLowerCase() as AssistantProviderId;
    if (!PROVIDER_IDS.includes(id) || byId.has(id)) continue;
    byId.set(id, { id, label: str(p['label'], 40) || DEFAULT_LABELS[id], available: p['available'] === true });
  }
  return PROVIDER_IDS.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
}

/** pf-select options: an unavailable model stays listed but greyed out. */
export function providerOptions(list: readonly AssistantProvider[]): PfSelectOption<AssistantProviderId>[] {
  return list.map((p) => ({ value: p.id, label: p.label, hint: p.available ? undefined : 'Not available', disabled: !p.available }));
}

/** Which model to start with: the remembered one if still available, else
 *  the first available one (Gemini first), else null (nothing to talk to). */
export function pickProvider(list: readonly AssistantProvider[], remembered: string | null | undefined): AssistantProviderId | null {
  const ok = list.filter((p) => p.available);
  return ok.find((p) => p.id === remembered)?.id ?? ok[0]?.id ?? null;
}

function normTests(v: unknown): AssistantTestRef[] {
  if (!Array.isArray(v)) return [];
  return v.filter(rec).map((t) => ({ testId: str(t['testId'], 64), code: str(t['code'], 40), name: str(t['name'], 160) }))
    .filter((t) => t.name || t.code || t.testId).slice(0, 5);
}

/** Model suggestions → the three card kinds; malformed ones are dropped. */
export function normaliseSuggestions(raw: unknown): AssistantSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistantSuggestion[] = [];
  for (const s of raw) {
    if (!rec(s)) continue;
    switch (s['kind']) {
      case 'setting': {
        const label = str(s['label'], 80);
        const value = str(s['value'], 300);
        if (label && value) out.push({ kind: 'setting', label, value, note: str(s['note'], 300) || null });
        break;
      }
      case 'action': {
        const text = str(s['text'], 500);
        if (text) out.push({ kind: 'action', text });
        break;
      }
      case 'mapping': {
        const analyzerCode = str(s['analyzerCode'], 40);
        const tests = normTests(s['tests']);
        if (!analyzerCode || !tests.length) break;
        const c = str(s['confidence']).toLowerCase();
        out.push({
          kind: 'mapping', analyzerCode, unit: str(s['unit'], 30) || null, tests,
          confidence: c === 'high' || c === 'low' ? c : 'medium', why: str(s['why'], 400) || null,
        });
        break;
      }
    }
    if (out.length >= 30) break;
  }
  return out;
}

/** The chat answer, defensively (envelope or bare object). */
export function normaliseReply(raw: unknown): AssistantReply {
  const src = rec(raw) && rec(raw['data']) ? raw['data'] : raw;
  const r = rec(src) ? src : {};
  const usage = rec(r['usage'])
    ? { inputTokens: Number(r['usage']['inputTokens']) || 0, outputTokens: Number(r['usage']['outputTokens']) || 0 }
    : null;
  return {
    reply: typeof r['reply'] === 'string' ? r['reply'] : '',
    suggestions: normaliseSuggestions(r['suggestions']),
    provider: str(r['provider'], 20),
    model: str(r['model'], 80),
    usage,
  };
}

/** "GLU (mg/dL)" — the analyzer side of a mapping card. */
export function mappingCodeLabel(s: Pick<MappingSuggestion, 'analyzerCode' | 'unit'>): string {
  return s.unit ? `${s.analyzerCode} (${s.unit})` : s.analyzerCode;
}

/** "Fasting Blood Sugar · BIO010" — the Test Master side. */
export function mappingTestLabel(t: AssistantTestRef): string {
  return [t.name, t.code].filter(Boolean).join(' · ');
}

export const CONFIDENCE_WORDS: Record<MappingSuggestion['confidence'], string> = {
  high: 'Strong match', medium: 'Likely match', low: 'Possible match',
};

/** The turns sent with a question: the last N, text only, never empty. */
export function historyFor(turns: readonly AssistantTurn[]): AssistantTurn[] {
  return turns.filter((t) => t.text.trim()).slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, text: t.text }));
}

// ── Errors in plain words ─────────────────────────────────────────────────

export type AssistantErrorKind = 'off' | 'limit' | 'provider' | 'network' | 'invalid' | 'missing' | 'failed';

export interface AssistantErrorView {
  kind: AssistantErrorKind;
  message: string;
  /** Show "Try again" (the same question). */
  retry: boolean;
}

/** The server's failure codes (InstrumentAssistantService / AstDiskReadService). */
export const ASSISTANT_ERROR_CODES = ['bad_request', 'not_found', 'ai_unavailable', 'ai_cap_reached', 'pf_sense_off', 'ai_failed'] as const;

/** The two admin-controlled refusals, worded once (server messages match). */
export const PF_SENSE_OFF_MESSAGE = 'PF Sense is turned off for this lab — ask your admin.';
export const PF_SENSE_LIMIT_MESSAGE = 'PF Sense limit reached for this month — ask your admin.';

/**
 * The assistant endpoints answer HTTP 200 with the ApiResponse envelope; a
 * `{ success: false, error, message }` body is a coded FAILURE, not data.
 * Returns it in the same shape as an HttpErrorResponse (status 200, body
 * `{ error, message }`) so `assistantError()` words both alike, or null when
 * the body is not a failure envelope.
 */
export function assistantFailure(raw: unknown): { status: number; error: { error: string; message: string } } | null {
  if (!rec(raw) || raw['success'] !== false) return null;
  const code = str(raw['error'], 60).toLowerCase() || 'ai_failed';
  return { status: 200, error: { error: code, message: str(raw['message'], 300) } };
}

/**
 * Any failure → one plain sentence. Codes follow the existing AI calls
 * (AstDiskReadService: ai_unavailable / ai_cap_reached / ai_failed); the beta
 * gate answers an empty 404 when the assistant isn't switched on.
 */
export function assistantError(e: unknown, providerLabel = 'This engine'): AssistantErrorView {
  const status = Number((e as { status?: number })?.status ?? 0);
  const body = (e as { error?: unknown })?.error;
  const code = String((rec(body) ? body['error'] ?? body['code'] : (e as { code?: unknown })?.code) ?? '').toLowerCase();
  const name = String((e as { name?: unknown })?.name ?? '');

  if (code === 'pf_sense_off') {
    return { kind: 'off', retry: false, message: PF_SENSE_OFF_MESSAGE };
  }
  if (code === 'ai_cap_reached' || status === 429 || /limit|quota|cap_reached/.test(code)) {
    return { kind: 'limit', retry: false,
      message: PF_SENSE_LIMIT_MESSAGE };
  }
  if (code === 'ai_unavailable' || code === 'provider_unavailable' || status === 503) {
    return { kind: 'provider', retry: true, message: `${providerLabel} isn’t available right now. Pick the other engine above, or try again in a minute.` };
  }
  if (code === 'bad_request') {
    // The same question would be refused again: start over instead.
    return { kind: 'invalid', retry: false, message: 'That couldn’t be sent. Start a new chat and ask again in fewer words.' };
  }
  if (code === 'not_found') {
    // HTTP 200 + not_found = the analyzer asked about is gone (not "beta off").
    return { kind: 'missing', retry: false, message: 'That analyzer isn’t there any more. Reload the page and pick it again.' };
  }
  if (status === 404 || code === 'beta_disabled' || code === 'not_enabled') {
    return { kind: 'off', retry: false, message: 'The assistant isn’t available for this lab right now.' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'off', retry: false, message: 'You don’t have access to the assistant on this screen.' };
  }
  if (status === 0 || name === 'TimeoutError' || code === 'timeout') {
    return { kind: 'network', retry: true, message: 'No answer came back. Check the connection and try again.' };
  }
  return { kind: 'failed', retry: true, message: 'The assistant couldn’t answer that. Try again, or ask it another way.' };
}
