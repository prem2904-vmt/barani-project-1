/** Case-sheet builder (Cortex chat + option checks): wire shapes of the backend contract (plans/casesheet-mcp-builder.md). */

export interface BuilderStatus {
  /** The in-app Cortex chat is available. */
  cortex: boolean;
  /** This lab lets connected apps build forms. */
  connector: boolean;
  connectorSwitch: boolean;
  /** The caller may flip the lab switch. */
  canChangeSwitch: boolean;
}

/** One tool step; changed = false when it was refused or changed nothing (shown with a warning mark, never a tick). */
export interface CortexStep { tool: string; summary: string; changed: boolean }

export interface CortexReply {
  conversationId: string;
  reply: string;
  steps: CortexStep[];
  formChanged: boolean;
  draftVersion?: number;
}

export type CheckSource = 'auto' | 'cortex' | 'connector' | 'person';

export interface CheckResult { pass: boolean; failures: string[] }

export interface CheckView {
  id: string;
  title: string;
  source: CheckSource;
  /** Plain words, e.g. "Chief complaint: Cough". */
  given: string[];
  /** Plain words, e.g. "'Duration of cough' shows". */
  expect: string[];
  result: CheckResult | null;
  ranAt: string | null;
}

export interface ChecksSummary { total: number; passed: number; failed: number; coverage: { rules: number; tested: number } }

export interface ChecksResult { summary: ChecksSummary; checks: CheckView[] }

/** A refusal from the builder endpoints; `code` is the ProblemDetails code, `message` is plain words. */
export class BuilderError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
  }
}

/** Plain words per contract code (never the server's wording for these). */
export const BUILDER_WORDS: Record<string, string> = {
  feature_off: 'Cortex form building is switched off for your lab. A lab admin can turn it on in Settings.',
  cortex_unavailable: "Cortex isn't set up here yet, so it can't help right now.",
  cap_reached: "Cortex has reached today's limit. Try again tomorrow.",
};

/** Words for anything a builder call throws. */
export function builderWords(e: unknown, fallback = "Couldn't do that just now. Please try again."): string {
  if (e instanceof BuilderError) return e.message;
  if ((e as { status?: number })?.status === 0) return "Can't reach the server right now.";
  return fallback;
}

/** "1 check fails" / "3 checks fail". */
export function failsWords(n: number): string {
  return n === 1 ? '1 check fails' : `${n} checks fail`;
}

/** "12 checks · 11 pass · 1 fails · covers 9 of 10 rules". */
export function summaryLine(s: ChecksSummary): string {
  const bits = [`${s.total} ${s.total === 1 ? 'check' : 'checks'}`, `${s.passed} pass`];
  if (s.failed > 0) bits.push(`${s.failed} ${s.failed === 1 ? 'fails' : 'fail'}`);
  bits.push(`covers ${s.coverage.tested} of ${s.coverage.rules} ${s.coverage.rules === 1 ? 'rule' : 'rules'}`);
  return bits.join(' · ');
}

export const SOURCE_LABEL: Record<CheckSource, string> = { auto: 'Auto', cortex: 'Cortex', connector: 'Connected app', person: 'Person' };

/** The lab switch (Settings → AI connector), in plain words. */
export const BUILDER_SWITCH_TITLE = 'Let connected apps build case sheet forms';
export const BUILDER_SWITCH_ON = 'Claude or ChatGPT connected with your sign-in can make and change DRAFT case sheet forms. Nothing is published without you.';
export const BUILDER_SWITCH_OFF = 'Off. Connected apps can’t make or change case sheet forms. When on, Claude or ChatGPT connected with your sign-in can make and change DRAFT case sheet forms, and nothing is published without you.';
