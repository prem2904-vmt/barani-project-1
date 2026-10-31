import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_TURNS, assistantError, historyFor, mappingCodeLabel, mappingTestLabel, normaliseProviders, normaliseReply,
  normaliseSuggestions, pickProvider, providerOptions,
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
    expect(assistantError({ status: 400, error: { error: 'ai_cap_reached' } }).message).toMatch(/allowance/);
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
