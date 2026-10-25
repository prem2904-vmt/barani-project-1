/**
 * "Connect an analyzer" — the wizard's pure rules (spec'd head-on):
 * which network card the analyzer is on, which ports to listen on, what the
 * firewall fix will change (said in plain words BEFORE Windows asks), the
 * instrument to create from what was detected, and the final checklist.
 */
import type { PfSelectOption } from '../../../../shared/primitives/select.component';
import { PROTOCOL_OPTIONS, applyDetectProposal, buildUpsert, emptyInstrumentForm } from '../../../../shared/instruments/instrument-config';
import type {
  AnalyzerGuess, DetectResult, DiagAdapter, DiagProblem, DiagSnapshot, InstrumentUpsert, LinkConfig,
} from '../../../../shared/instruments/instrument.models';

export type WizardStepId = 'pc' | 'find' | 'create' | 'check';
export const WIZARD_STEPS: readonly { id: WizardStepId; label: string }[] = [
  { id: 'pc', label: 'This PC' },
  { id: 'find', label: 'Find the analyzer' },
  { id: 'create', label: 'Create & pair' },
  { id: 'check', label: 'Checklist' },
];

/** Who opens the connection. Most analyzers dial the LIS (we listen). */
export type ConnectMode = 'listen' | 'dial';

/** Ports analyzers are usually set to in our labs (5599 onward). */
export const COMMON_PORTS: readonly number[] = [5599, 5600, 5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608, 5609, 5610];

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

export interface CardChoice { address: string; card: string; description: string | null; direct: boolean }

/** Every private IPv4 of this PC, one row each ("Ethernet 2 — 192.168.1.10"). */
export function cardChoices(adapters: readonly DiagAdapter[] | null | undefined): CardChoice[] {
  const out: CardChoice[] = [];
  for (const a of adapters ?? []) {
    for (const x of a.ipv4 ?? []) {
      if (!isPrivate(x.address)) continue;
      out.push({ address: x.address, card: a.name, description: a.description ?? null, direct: !a.gateway });
    }
  }
  return out;
}

export function cardOptions(choices: readonly CardChoice[]): PfSelectOption<string>[] {
  return choices.map((c) => ({
    value: c.address,
    label: `${c.card} — ${c.address}`,
    hint: c.direct ? 'No gateway — likely the cable straight to the analyzer' : (c.description ?? undefined),
  }));
}

/**
 * The card the analyzer is most likely cabled to: one with NO gateway (a
 * direct cable / analyzer switch) beats the router card; else the first.
 */
export function pickAnalyzerCard(choices: readonly CardChoice[]): string | null {
  return (choices.find((c) => c.direct) ?? choices[0])?.address ?? null;
}

/** The ports to listen on: the suggested one first, then the usual ones not taken (max 12). */
export function scanPorts(suggested: number | null, taken: readonly number[] = []): number[] {
  const used = new Set(taken);
  const out: number[] = [];
  if (suggested) out.push(suggested);
  for (const p of COMMON_PORTS) if (!used.has(p) && !out.includes(p)) out.push(p);
  return out.slice(0, 12);
}

/** Problems the one-permission firewall fix resolves. */
export function fixableProblems(problems: readonly DiagProblem[] | null | undefined): DiagProblem[] {
  return (problems ?? []).filter((p) => p.fix === 'firewall');
}

/**
 * What the fix will do, in plain words, for the confirmation BEFORE Windows
 * asks: aliases = the Public cards; ports = the analyzer ports.
 */
export function firewallFixPlan(snap: DiagSnapshot | null, ports: readonly number[]): { aliases: string[]; ports: number[]; lines: string[] } {
  const aliases = (snap?.profiles ?? []).filter((p) => /^public$/i.test(p.category ?? '')).map((p) => p.alias);
  const list = [...new Set(ports.filter((p) => Number.isInteger(p) && p >= 1024))];
  const lines: string[] = [];
  if ((snap?.firewall?.blockRules ?? 0) > 0) lines.push('Remove the Windows Firewall rules that block Prefrontal.');
  lines.push(`Let analyzers on this local network reach Prefrontal on port${list.length === 1 ? '' : 's'} ${list.join(', ')} — only Prefrontal, nothing else.`);
  if (aliases.length) lines.push(`Set ${aliases.join(' and ')} to a Private network.`);
  lines.push('Windows will ask for permission once. Nothing else on this PC changes.');
  return { aliases, ports: list, lines };
}

/** Detected protocol in words ("HL7 v2", "ASTM", "LifeDx HBPro"). */
export function protocolWord(p: string | null | undefined): string {
  const o = PROTOCOL_OPTIONS.find((x) => x.value === p);
  return o ? o.label.replace(/\s*\(.*\)$/, '') : 'Unknown';
}

/** Detected framing in words. */
export function framingWord(l: string | null | undefined): string {
  switch (l) {
    case 'mllp': return 'MLLP';
    case 'astm-e1381': return 'ASTM E1381';
    case 'stx-etx': return 'STX/ETX';
    case 'sinocare-sn': return 'SN frames';
    case 'raw': return 'plain text';
    default: return 'unknown framing';
  }
}

/** "Looks like Medonic M51 · HL7 v2 (MLLP)" — the detect headline in words. */
export function detectHeadline(guess: AnalyzerGuess | null | undefined, d: DetectResult | null | undefined): string {
  const who = guess?.label || [guess?.make, guess?.model].filter(Boolean).join(' ');
  const how = d && d.protocol !== 'unknown' ? `${protocolWord(d.protocol)} (${framingWord(d.link)})` : '';
  if (who && how) return `Looks like ${who} · ${how}`;
  if (who) return `Looks like ${who}`;
  if (how) return `Speaks ${how}`;
  return 'Connected — run a sample on the analyzer so we can recognise it';
}

export interface WizardInstrument {
  name: string; make?: string | null; model?: string | null;
  mode: ConnectMode; port: number | null; host?: string | null;
  detect?: DetectResult | null;
}

/** The instrument to create: transport from the wizard, protocol from what was detected. */
export function wizardUpsert(w: WizardInstrument): InstrumentUpsert {
  let form = emptyInstrumentForm();
  form.name = w.name.trim() || 'Analyzer';
  form.make = w.make ?? '';
  form.model = w.model ?? '';
  if (w.mode === 'listen') { form.transport = 'tcp-server'; form.tcpServer = { port: w.port }; }
  else { form.transport = 'tcp-client'; form.tcpClient = { host: (w.host ?? '').trim(), port: w.port }; }
  let link: Partial<LinkConfig> | null = null;
  if (w.detect) ({ form, link } = applyDetectProposal(form, w.detect));
  return buildUpsert(form, link ? { link } : null);
}

export type CheckState = boolean | null;
export interface CheckItem { id: string; label: string; ok: CheckState; detail?: string }

export interface ChecklistInput {
  snapshot: DiagSnapshot | null;
  card: string | null;
  mode: ConnectMode;
  port: number | null;
  portReport?: { state: string; message?: string } | null;
  connectedFrom?: string | null;
  detect?: DetectResult | null;
  guess?: AnalyzerGuess | null;
  created?: boolean;
  paired?: boolean;
  liveLink?: string | null;
  liveProblem?: string | null;
}

/** Every check in plain words — passed (true), failed (false) or not known yet (null). */
export function checklist(i: ChecklistInput): CheckItem[] {
  const snap = i.snapshot;
  const fw = snap?.firewall;
  const items: CheckItem[] = [];
  items.push({ id: 'card', label: 'This PC has an address on the analyzer network', ok: snap ? !!i.card : null, detail: i.card ?? undefined });
  const same = (snap?.problems ?? []).find((p) => p.code === 'two_nics_same_subnet');
  items.push({ id: 'cards', label: 'Only one network card on that network', ok: snap ? !same : null, detail: same ? same.message : undefined });
  if (i.mode === 'listen') {
    const pr = i.portReport;
    items.push({ id: 'port', label: `Port ${i.port ?? '—'} is free for the analyzer`, ok: pr ? pr.state === 'free' || pr.state === 'ours' : null, detail: pr?.message });
    if (fw && fw.supported) {
      items.push({ id: 'firewall', label: 'Windows Firewall lets the analyzer in', ok: !!fw.ourRule && !fw.blockRules, detail: fw.blockRules ? 'A rule is blocking Prefrontal' : !fw.ourRule ? 'No rule for the analyzer ports yet' : undefined });
      const pub = (snap?.profiles ?? []).filter((p) => /^public$/i.test(p.category ?? ''));
      items.push({ id: 'profile', label: 'The analyzer network is Private', ok: pub.length === 0, detail: pub.length ? `${pub.map((p) => p.alias).join(', ')} is Public` : undefined });
    } else if (fw) {
      items.push({ id: 'firewall', label: 'Firewall', ok: null, detail: fw.message });
    }
  }
  items.push({ id: 'connected', label: 'The analyzer connected', ok: i.connectedFrom ? true : null, detail: i.connectedFrom ? `from ${i.connectedFrom}` : undefined });
  const known = !!i.detect && i.detect.protocol !== 'unknown';
  items.push({ id: 'protocol', label: 'Its protocol was recognised', ok: i.detect ? known : null, detail: known ? detectHeadline(i.guess, i.detect).replace(/^Looks like |^Speaks /, '') : undefined });
  items.push({ id: 'created', label: 'The instrument is created and this PC is paired', ok: i.created ? !!i.paired : null });
  if (i.created && i.paired) {
    const link = i.liveLink;
    items.push({
      id: 'live', label: 'The connector is running for it',
      ok: link === 'connected' || link === 'waiting' ? true : link === 'error' ? false : null,
      detail: link === 'connected' ? 'Analyzer connected' : link === 'waiting' ? 'Waiting for the analyzer to connect again' : i.liveProblem ?? undefined,
    });
  }
  return items;
}
