import { describe, expect, it } from 'vitest';
import {
  cardChoices, cardOptions, checklist, detectHeadline, firewallFixPlan, fixableProblems, pickAnalyzerCard, scanPorts, wizardUpsert,
} from './connect-wizard.logic';
import type { DetectResult, DiagSnapshot } from '../../../../shared/instruments/instrument.models';

/** The Arun Lab PC (24 Oct): router card .8 with a gateway, analyzer cable .10 without, a Public analyzer network. */
const SNAP: DiagSnapshot = {
  platform: 'win32', hostname: 'LAB-RECEPTION', suggestedPort: 5603,
  adapters: [
    { name: 'Ethernet', description: 'Realtek PCIe GbE Family Controller', gateway: '192.168.1.1', ipv4: [{ address: '192.168.1.8', netmask: '255.255.255.0', subnet: '192.168.1.0/24' }] },
    { name: 'Ethernet 2', description: 'ASIX AX88179 USB 3.0 to Gigabit Ethernet Adapter', gateway: null, ipv4: [{ address: '192.168.1.10', netmask: '255.255.255.0', subnet: '192.168.1.0/24' }] },
    { name: 'vEthernet (WSL)', gateway: null, ipv4: [{ address: '169.254.3.4' }] },
  ],
  profiles: [{ name: 'Network 3', alias: 'Ethernet', category: 'Private' }, { name: 'Unidentified network', alias: 'Ethernet 2', category: 'Public' }],
  firewall: { supported: true, blockRules: 2, ourRule: false, enabled: { domain: true, private: true, public: true } },
  problems: [
    { code: 'two_nics_same_subnet', severity: 'warning', message: 'Two network cards …', cards: ['Ethernet', 'Ethernet 2'] },
    { code: 'public_network', severity: 'warning', message: 'Ethernet 2 is Public…', card: 'Ethernet 2', fix: 'firewall' },
    { code: 'firewall_block_rule', severity: 'error', message: 'blocking…', fix: 'firewall' },
  ],
};

const HL7: DetectResult = {
  protocol: 'hl7', link: 'mllp', confidence: 0.92, reasons: ['1 MLLP block(s) (VT … FS CR)', 'MSH segment found (HL7 v2)'],
  proposed: { link: { type: 'mllp' }, parser: { type: 'hl7', hl7: { sampleIdField: 'OBR-3' } } as never },
};

describe('connect wizard — this PC', () => {
  it('cards: private IPv4 only; the one with no gateway (straight cable) is picked', () => {
    const c = cardChoices(SNAP.adapters);
    expect(c.map((x) => x.address)).toEqual(['192.168.1.8', '192.168.1.10']);
    expect(pickAnalyzerCard(c)).toBe('192.168.1.10');
    expect(cardOptions(c)[1]).toEqual({ value: '192.168.1.10', label: 'Ethernet 2 — 192.168.1.10', hint: 'No gateway — likely the cable straight to the analyzer' });
    expect(pickAnalyzerCard([])).toBeNull();
  });

  it('the fix plan says exactly what changes before Windows asks — the picked card, its /24, the analyzer ports (range or typed)', () => {
    expect(fixableProblems(SNAP.problems).map((p) => p.code)).toEqual(['public_network', 'firewall_block_rule']);
    const plan = firewallFixPlan(SNAP, 'Ethernet 2', [5603, 5599, 80, 6000, 3389]);
    expect(plan.adapter).toBe('Ethernet 2');
    expect(plan.aliases).toEqual(['Ethernet 2']);
    expect(plan.subnets).toEqual(['192.168.1.0/24']);
    expect(plan.ports).toEqual([5599, 5603, 6000]); // a typed fixed port joins; <1024 and RDP never do
    expect(plan.lines).toEqual([
      'Remove the Windows Firewall rules that block Prefrontal.',
      'Let analyzers on 192.168.1.x (Ethernet 2) reach Prefrontal on ports 5599, 5603, 6000 — only Prefrontal, nothing else.',
      'Set Ethernet 2 to a Private network.',
      'Windows will ask for permission once. Nothing else on this PC changes.',
    ]);
  });

  it('never flips a card that reaches the internet or has a gateway, nor a card that was not picked', () => {
    const wifi: DiagSnapshot = {
      ...SNAP,
      adapters: [...SNAP.adapters, { name: 'Wi-Fi', gateway: null, ipv4: [{ address: '192.168.43.20', netmask: '255.255.255.0' }] }],
      profiles: [...SNAP.profiles, { name: 'Cafe', alias: 'Wi-Fi', category: 'Public', ipv4: 'Internet' }],
    };
    expect(firewallFixPlan(wifi, 'Wi-Fi', [5603]).aliases).toEqual([]);
    expect(firewallFixPlan(wifi, 'Wi-Fi', [5603]).lines[1]).toBe('Let analyzers on 192.168.43.x (Wi-Fi) reach Prefrontal on port 5603 — only Prefrontal, nothing else.');
    const pubRouter: DiagSnapshot = { ...SNAP, profiles: [{ name: 'Office', alias: 'Ethernet', category: 'Public', ipv4: 'LocalNetwork' }, SNAP.profiles[1]] };
    expect(firewallFixPlan(pubRouter, 'Ethernet', [5603]).aliases).toEqual([]); // the gateway card stays as it is
    expect(firewallFixPlan(pubRouter, 'Ethernet 2', [5603]).aliases).toEqual(['Ethernet 2']);
  });

  it('a card name the desktop app will not pass to Windows is said up front, not silently dropped', () => {
    const odd: DiagSnapshot = {
      ...SNAP,
      adapters: [{ name: 'Ethernet “Analyzer”', gateway: null, ipv4: [{ address: '192.168.10.5', netmask: '255.255.255.0' }] }],
      profiles: [{ name: 'Unidentified network', alias: 'Ethernet “Analyzer”', category: 'Public', ipv4: 'LocalNetwork' }],
    };
    const plan = firewallFixPlan(odd, 'Ethernet “Analyzer”', [5603]);
    expect(plan.aliases).toEqual([]);
    expect(plan.skipped).toEqual(['Ethernet “Analyzer”']);
    expect(plan.lines.some((l) => l.includes('stays Public'))).toBe(true);
  });
});

describe('connect wizard — find + create', () => {
  it('listens on the suggested port first, then the usual ones (max 12)', () => {
    expect(scanPorts(5603)).toEqual([5603, 5599, 5600, 5601, 5602, 5604, 5605, 5606, 5607, 5608, 5609, 5610]);
    expect(scanPorts(5620, [5599, 5600])).toEqual([5620, 5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608, 5609, 5610]);
    expect(scanPorts(null).length).toBe(12);
  });

  it('headline in plain words', () => {
    expect(detectHeadline({ make: 'Medonic', model: 'M51', profileKey: 'medonic-m51-cbc', label: 'Medonic M51' }, HL7)).toBe('Looks like Medonic M51 · HL7 v2 (MLLP)');
    expect(detectHeadline(null, HL7)).toBe('Speaks HL7 v2 (MLLP)');
    expect(detectHeadline({ make: null, model: null, profileKey: null, label: 'LifeDx HBPro (HbA1c)' }, null)).toBe('Looks like LifeDx HBPro (HbA1c)');
    expect(detectHeadline(null, { ...HL7, protocol: 'unknown' })).toMatch(/^Connected — run a sample/);
  });

  it('the instrument: TCP server on the found port with the detected protocol; dial mode → TCP client', () => {
    const up = wizardUpsert({ name: 'Medonic M51', make: 'Medonic', model: 'M51', mode: 'listen', port: 5603, detect: HL7 });
    expect(up.name).toBe('Medonic M51');
    expect(up.config.transport).toEqual({ type: 'tcp-server', port: 5603, host: '0.0.0.0' });
    expect(up.config.parser.type).toBe('hl7');
    expect(up.config.link.type).toBe('mllp');
    const dial = wizardUpsert({ name: '  ', mode: 'dial', port: 5100, host: ' 192.168.1.30 ', detect: null });
    expect(dial.name).toBe('Analyzer');
    expect(dial.config.transport).toMatchObject({ type: 'tcp-client', host: '192.168.1.30', port: 5100 });
    expect(dial.config.parser.type).toBe('auto');
  });
});

describe('connect wizard — checklist', () => {
  it('before anything: unknowns are "not checked yet", known failures fail', () => {
    const c = checklist({ snapshot: SNAP, card: '192.168.1.10', mode: 'listen', port: 5603 });
    const by = Object.fromEntries(c.map((x) => [x.id, x.ok]));
    expect(by).toEqual({ card: true, cards: false, port: null, firewall: false, profile: false, connected: null, protocol: null, created: null });
  });

  it('all done: passed in plain words, with the live connector', () => {
    const fixed: DiagSnapshot = { ...SNAP, problems: [], profiles: SNAP.profiles.map((p) => ({ ...p, category: 'Private' })), firewall: { supported: true, blockRules: 0, ourRule: true } };
    const c = checklist({
      snapshot: fixed, card: '192.168.1.10', mode: 'listen', port: 5603, portReport: { state: 'ours' },
      connectedFrom: '192.168.1.21', detect: HL7, guess: { make: 'Medonic', model: 'M51', profileKey: null, label: 'Medonic M51' },
      created: true, paired: true, liveLink: 'waiting',
    });
    expect(c.every((x) => x.ok === true)).toBe(true);
    expect(c.find((x) => x.id === 'protocol')!.detail).toBe('Medonic M51 · HL7 v2 (MLLP)');
    expect(c.find((x) => x.id === 'live')!.detail).toBe('Waiting for the analyzer to connect again');
    expect(c.find((x) => x.id === 'port')!.label).toBe('Port 5603 is free for the analyzer');
  });

  it('macOS: the firewall is a note, not a failure; dial mode has no port / firewall checks', () => {
    const mac: DiagSnapshot = { ...SNAP, platform: 'darwin', problems: [], profiles: [], firewall: { supported: false, message: 'macOS asks by itself…' } };
    const c = checklist({ snapshot: mac, card: '192.168.1.40', mode: 'listen', port: 5599 });
    expect(c.find((x) => x.id === 'firewall')).toEqual({ id: 'firewall', label: 'Firewall', ok: null, detail: 'macOS asks by itself…' });
    const d = checklist({ snapshot: SNAP, card: '192.168.1.10', mode: 'dial', port: 5100 });
    expect(d.map((x) => x.id)).toEqual(['card', 'cards', 'connected', 'protocol', 'created']);
  });
});

import { checkPortText, firewallCoversPort } from './connect-wizard.logic';
describe('analyzer fixed port', () => {
  it('checkPortText: whole numbers 1–65535 only; <1024 warns', () => {
    expect(checkPortText(' 5100 ')).toEqual({ port: 5100 });
    expect(checkPortText('1023').warning).toMatch(/administrator/);
    expect(checkPortText('65535').port).toBe(65535);
    for (const v of ['', ' ', 'abc', '80.5', '0', '65536', '-1', '1e3', '１２３']) {
      const r = checkPortText(v); expect(r.port).toBeNull(); expect(r.error).toBeTruthy();
    }
  });
  it('firewallCoversPort mirrors netdiag: ranges, Any, unknown → never nag', () => {
    const fw = { supported: true, ourRule: true, ourRulePorts: ['5599', '5603-5610'] };
    expect(firewallCoversPort(fw, 5605)).toBe(true);
    expect(firewallCoversPort(fw, 6100)).toBe(false);
    expect(firewallCoversPort({ ...fw, ourRulePorts: ['Any'] }, 6100)).toBe(true);
    expect(firewallCoversPort({ ...fw, ourRulePorts: null }, 6100)).toBe(true);
    expect(firewallCoversPort({ ...fw, ourRule: false }, 6100)).toBe(true);
    expect(firewallCoversPort({ supported: false }, 6100)).toBe(true);
    expect(firewallCoversPort(null, 6100)).toBe(true);
  });
});

describe('port check while listening', () => {
  const base = { snapshot: null, card: null, mode: 'listen' as const, port: 6100 };
  const portOk = (i: object) => checklist({ ...base, ...i } as never).find((c) => c.id === 'port')!.ok;
  it('Passed once this PC listens on it or the analyzer connected; not checked yet otherwise; a real port report wins', () => {
    expect(portOk({})).toBeNull();
    expect(portOk({ listening: true })).toBe(true);
    expect(portOk({ connectedFrom: '192.168.1.21' })).toBe(true);
    expect(portOk({ portReport: { state: 'busy' }, listening: true })).toBe(false);
  });
});
