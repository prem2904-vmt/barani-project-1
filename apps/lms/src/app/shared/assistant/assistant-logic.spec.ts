import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_ERROR_CODES, MAX_HISTORY_TURNS, assistantError, assistantFailure, historyFor, mappingCodeLabel, mappingTestLabel, normaliseProviders, normaliseReply,
  normaliseRateCardSummary, normaliseSuggestions, pickProvider, providerOptions, rateCardBreakdown, rateCardHeadline, unmatchedHeading, unmatchedMore,
} from './assistant-logic';

describe('assistant logic — providers', () => {
  const raw = [
    { id: 'claude', label: 'Claude', available: false },
    { id: 'gemini', label: 'Gemini', available: true },
    { id: 'gpt', label: 'Other', available: true },
    { id: 'gemini', label: 'dup', available: false },
  ];

  it('keeps the two known models, fixed order, envelope or bare', () => {
    expect(normaliseProviders(raw)).toEqual([
      { id: 'gemini', label: 'Gemini', available: true }, { id: 'claude', label: 'Claude', available: false },
    ]);
    expect(normaliseProviders({ success: true, data: raw })).toHaveLength(2);
    expect(normaliseProviders(null)).toEqual([]);
    // only a literal true counts as available
    expect(normaliseProviders([{ id: 'claude', available: 'yes' }])[0]).toEqual({ id: 'claude', label: 'Claude', available: false });
  });

  it('pf-select options grey out an unavailable model', () => {
    const o = providerOptions(normaliseProviders(raw));
    expect(o[1]).toEqual({ value: 'claude', label: 'Claude', hint: 'Not available', disabled: true });
    expect(o[0].disabled).toBe(false);
  });

  it('starts on the remembered model when available, else the first available, else none', () => {
    const both = [{ id: 'gemini', label: 'Gemini', available: true }, { id: 'claude', label: 'Claude', available: true }] as const;
    expect(pickProvider([...both], 'claude')).toBe('claude');
    expect(pickProvider(normaliseProviders(raw), 'claude')).toBe('gemini');
    expect(pickProvider([{ id: 'claude', label: 'Claude', available: false }], null)).toBeNull();
  });
});

describe('assistant logic — suggestions (untrusted)', () => {
  it('keeps the three kinds, drops malformed / unknown, clips strings', () => {
    const s = normaliseSuggestions([
      { kind: 'setting', label: 'Host IP', value: '192.168.1.8', note: 'On the analyzer: Set → LIS' },
      { kind: 'setting', label: 'Port' },                                   // no value → dropped
      { kind: 'action', text: 'Enable Checksum on the Snibe: Set → Online → Options' },
      { kind: 'mapping', analyzerCode: 'GLU', unit: 'mg/dL', confidence: 'HIGH', why: 'Same unit',
        tests: [{ testId: 't1', code: 'BIO010', name: 'Fasting Blood Sugar' }, 'junk'] },
      { kind: 'mapping', analyzerCode: 'X', tests: [] },                     // no test → dropped
      { kind: 'script', text: 'x' }, null, 'str',
      { kind: 'action', text: 'y'.repeat(900) },
    ]);
    expect(s.map((x) => x.kind)).toEqual(['setting', 'action', 'mapping', 'action']);
    expect(s[2]).toEqual({ kind: 'mapping', analyzerCode: 'GLU', unit: 'mg/dL', confidence: 'high', why: 'Same unit',
      tests: [{ testId: 't1', code: 'BIO010', name: 'Fasting Blood Sugar' }] });
    expect((s[3] as { text: string }).text.length).toBe(500);
    expect(normaliseSuggestions({})).toEqual([]);
  });

  it('an odd confidence reads as medium; labels read like the contract', () => {
    const [m] = normaliseSuggestions([{ kind: 'mapping', analyzerCode: 'GLU', confidence: '??', tests: [{ name: 'FBS' }] }]);
    expect(m).toMatchObject({ confidence: 'medium', unit: null });
    expect(mappingCodeLabel({ analyzerCode: 'GLU', unit: 'mg/dL' })).toBe('GLU (mg/dL)');
    expect(mappingCodeLabel({ analyzerCode: 'GLU', unit: null })).toBe('GLU');
    expect(mappingTestLabel({ testId: 't1', code: 'BIO010', name: 'Fasting Blood Sugar' })).toBe('Fasting Blood Sugar · BIO010');
  });

  it('reply: envelope or bare; a non-string reply is empty', () => {
    expect(normaliseReply({ success: true, data: { reply: 'Hi', suggestions: [], provider: 'claude', model: 'claude-sonnet-5-5', usage: { inputTokens: 5, outputTokens: 7 } } }))
      .toEqual({ reply: 'Hi', suggestions: [], provider: 'claude', model: 'claude-sonnet-5-5', usage: { inputTokens: 5, outputTokens: 7 } });
    expect(normaliseReply({ reply: { html: '<b>' } }).reply).toBe('');
  });

  it('history: last N turns, empty ones dropped', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `t${i}` }));
    const h = historyFor([...many, { role: 'user', text: '  ' }]);
    expect(h).toHaveLength(MAX_HISTORY_TURNS);
    expect(h[h.length - 1].text).toBe('t29');
  });
});

describe('assistant logic — errors in plain words', () => {
  it('limit reached (ai_cap_reached / 429)', () => {
    expect(assistantError({ status: 429, error: { error: 'ai_cap_reached' } })).toMatchObject({ kind: 'limit', retry: false });
    expect(assistantError({ status: 400, error: { error: 'ai_cap_reached' } }).message).toBe('Cortex limit reached for this month — ask your admin.');
  });

  it('Cortex switched off (pf_sense_off) → kind off, plain words, no retry', () => {
    expect(assistantError({ status: 200, error: { error: 'pf_sense_off', message: 'x' } })).toEqual({
      kind: 'off', retry: false, message: 'Cortex is turned off for this lab — ask your admin.' });
    expect(ASSISTANT_ERROR_CODES).toContain('pf_sense_off');
  });
  it('model not available (ai_unavailable / 503) names the model and offers the other', () => {
    const e = assistantError({ status: 503, error: { error: 'ai_unavailable' } }, 'Claude');
    expect(e).toMatchObject({ kind: 'provider', retry: true });
    expect(e.message).toMatch(/^Claude isn’t available right now/);
  });
  it('beta off (empty 404) / no access', () => {
    expect(assistantError({ status: 404, error: null })).toMatchObject({ kind: 'off', retry: false });
    expect(assistantError({ status: 403, error: {} }).message).toMatch(/don’t have access/);
  });
  it('network / timeout and anything else', () => {
    expect(assistantError({ status: 0 })).toMatchObject({ kind: 'network', retry: true });
    expect(assistantError({ name: 'TimeoutError' })).toMatchObject({ kind: 'network' });
    expect(assistantError({ status: 500, error: { error: 'ai_failed' } })).toMatchObject({ kind: 'failed', retry: true });
  });
});

describe('assistant logic — the backend contract (HTTP 200 + success:false)', () => {
  it('a failure envelope becomes an error in HttpErrorResponse shape; data is not a failure', () => {
    expect(assistantFailure({ success: false, error: 'AI_CAP_REACHED', message: 'used up' }))
      .toEqual({ status: 200, error: { error: 'ai_cap_reached', message: 'used up' } });
    expect(assistantFailure({ success: false })).toEqual({ status: 200, error: { error: 'ai_failed', message: '' } });
    expect(assistantFailure({ success: true, data: [] })).toBeNull();
    expect(assistantFailure([{ id: 'gemini' }])).toBeNull();
    expect(assistantFailure(null)).toBeNull();
  });

  it('every server code reads as a plain sentence of the right kind', () => {
    const kinds = Object.fromEntries(ASSISTANT_ERROR_CODES.map((c) => [c, assistantError(assistantFailure({ success: false, error: c }))]));
    expect(kinds['bad_request']).toMatchObject({ kind: 'invalid', retry: false });
    expect(kinds['not_found']).toMatchObject({ kind: 'missing', retry: false });
    expect(kinds['not_found'].message).toMatch(/analyzer/);
    expect(kinds['ai_unavailable']).toMatchObject({ kind: 'provider', retry: true });
    expect(kinds['ai_cap_reached']).toMatchObject({ kind: 'limit', retry: false });
    expect(kinds['ai_failed']).toMatchObject({ kind: 'failed', retry: true });
  });

  it('HTTP 200 not_found is a gone analyzer, an empty HTTP 404 is the beta switch being off', () => {
    expect(assistantError({ status: 200, error: { error: 'not_found' } }).kind).toBe('missing');
    expect(assistantError({ status: 404, error: null }).kind).toBe('off');
  });

  it('history never exceeds the server cap of 20 messages', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `t${i}` }));
    expect(historyFor(many).length).toBeLessThanOrEqual(20);
    expect(MAX_HISTORY_TURNS).toBeLessThanOrEqual(20);
  });
});

describe('Test Master assistant — suggestions, errors and the rate-card summary', () => {
  const id = '3f2a9c1e-5b7d-4c8e-9a10-0123456789ab';

  it('a proposal suggestion needs a real id and a label; anything else is dropped', () => {
    const out = normaliseSuggestions([
      { kind: 'proposal', value: id, label: 'CBC ₹250 → ₹300', note: 'price' },
      { kind: 'proposal', value: 'not-an-id', label: 'x' },
      { kind: 'proposal', value: id, label: '' },
    ]);
    expect(out).toEqual([{ kind: 'proposal', id, label: 'CBC ₹250 → ₹300', note: 'price' }]);
  });

  it('rate_limited is "one a minute", NOT the monthly limit, even on HTTP 429', () => {
    const e = assistantError({ status: 429, error: { error: 'rate_limited' } });
    expect(e.message).toMatch(/One rate card a minute/);
    expect(e.retry).toBe(true);
    expect(e.kind).not.toBe('limit');
    expect(assistantError({ status: 429, error: { error: 'ai_cap_reached' } }).kind).toBe('limit');
  });

  it('upload refusals are worded', () => {
    expect(assistantError({ status: 400, error: { error: 'too_many_pages' } }).message).toMatch(/at most 6 pages/);
    expect(assistantError({ status: 413, error: { error: 'too_large' } }).message).toMatch(/15 MB/);
    expect(assistantError({ status: 400, error: { error: 'unsupported_type' } }).message).toMatch(/photo/);
    expect(assistantError({ status: 409, error: { error: 'already_read' } }).retry).toBe(false);
  });

  it('summary: defensive parse, counts and unmatched kept, junk dropped', () => {
    const s = normaliseRateCardSummary({ success: true, data: {
      batchId: id, pages: 2, pagesRead: 2, lines: 40, priceSuggestions: 3, newTestSuggestions: 1, alreadyCurrent: 5, noPrice: 1,
      unmatched: [{ n: 4, text: 'Lipid Pro', reason: 'Not in your tests.' }, { n: 5, text: '' }, 'x'], notes: ['Only the first 200 lines were used.', ''],
      provider: 'gemini', model: 'gemini-x',
    } })!;
    expect(s.suggestions).toBe(4);
    expect(s.unmatched).toEqual([{ n: 4, text: 'Lipid Pro', reason: 'Not in your tests.' }]);
    expect(s.notes).toHaveLength(1);
    expect(s.unmatchedTotal).toBe(1);                                   // server did not send a total: the list length
    expect(normaliseRateCardSummary({ data: { batchId: id, unmatched: [], unmatchedTotal: 9 } })!.unmatchedTotal).toBe(9);
    expect(unmatchedHeading({ unmatched: [{ n: 1, text: 'a', reason: '' }], unmatchedTotal: 1 })).toBe('1 line not added');
    expect(unmatchedHeading({ unmatched: [{ n: 1, text: 'a', reason: '' }], unmatchedTotal: 5 })).toBe('5 lines not added');
    expect(unmatchedMore({ unmatched: [{ n: 1, text: 'a', reason: '' }], unmatchedTotal: 5 })).toBe(4);
    expect(unmatchedMore({ unmatched: [], unmatchedTotal: 0 })).toBe(0);
    expect(normaliseRateCardSummary({ data: { batchId: 'nope' } })).toBeNull();
    expect(normaliseRateCardSummary(null)).toBeNull();
  });

  it('headline + breakdown use plain words and say Cortex-friendly copy', () => {
    expect(rateCardHeadline({ suggestions: 4 })).toBe('4 suggestions added to Pending');
    expect(rateCardHeadline({ suggestions: 1 })).toBe('1 suggestion added to Pending');
    expect(rateCardHeadline({ suggestions: 0 })).toBe('Nothing to suggest from this rate card');
    expect(rateCardBreakdown({ priceSuggestions: 3, newTestSuggestions: 1 })).toBe('3 prices and 1 new test');
    expect(rateCardBreakdown({ priceSuggestions: 1, newTestSuggestions: 0 })).toBe('1 price');
  });
});
