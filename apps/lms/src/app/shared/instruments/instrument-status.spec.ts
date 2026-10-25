import { describe, expect, it } from 'vitest';
import {
  STATUS_ORDER, agoWords, connectedFromLine, connectorStateWord, liveOf, remoteHost, statusSubline, statusWord,
} from './instrument-config';
import type { InstrumentDto } from './instrument.models';
import { emptyInstrumentForm, buildInstrumentConfig } from './instrument-config';

/**
 * True analyzer status (next-phase §4, Arun Lab 24 Oct): "Online" (green)
 * only when the analyzer is really connected. A port merely listening used
 * to show green "Online" / "Listening".
 */
const NOW = Date.parse('2026-10-24T10:30:00Z');

function dto(extra: Partial<InstrumentDto> = {}): InstrumentDto {
  return {
    id: 'i1', name: 'Medonic M51', transport: 'tcp-server', config: buildInstrumentConfig(emptyInstrumentForm()),
    isActive: true, status: 'online', hasDeviceKey: true, lastSeenAt: '2026-10-24T10:29:40Z', ...extra,
  };
}

describe('status words — green only when the analyzer is really connected', () => {
  it('every server status has a word and the agreed colour', () => {
    expect(statusWord('online')).toEqual({ label: 'Online', tone: 'green' });
    expect(statusWord('waiting')).toEqual({ label: 'Waiting for analyzer', tone: 'amber' });
    expect(statusWord('not_connected')).toEqual({ label: 'Not connected', tone: 'amber' });
    expect(statusWord('offline')).toEqual({ label: 'Offline', tone: 'neutral' });
    expect(statusWord('error')).toEqual({ label: 'Error', tone: 'red' });
    expect(statusWord('running')).toEqual({ label: 'Connector running', tone: 'neutral' });
    expect(statusWord('never')).toEqual({ label: 'Never connected', tone: 'neutral' });
    expect(statusWord(undefined).label).toBe('Never connected');
    // Only Online is green.
    expect(STATUS_ORDER.filter((s) => statusWord(s).tone === 'green')).toEqual(['online']);
    expect(STATUS_ORDER[0]).toBe('online');
  });

  it('the live word on this PC follows the true link; an older desktop\'s "listening" is amber, never green', () => {
    expect(connectorStateWord('connected', 'connected')).toEqual({ label: 'Analyzer connected', tone: 'green' });
    expect(connectorStateWord('listening', 'waiting')).toEqual({ label: 'Waiting for analyzer', tone: 'amber' });
    expect(connectorStateWord('disconnected', 'not_connected')).toEqual({ label: 'Not connected', tone: 'amber' });
    expect(connectorStateWord('error', 'error')).toEqual({ label: 'Error', tone: 'red' });
    expect(connectorStateWord('starting', 'not_connected')).toEqual({ label: 'Starting', tone: 'neutral' });
    // Older desktop (no link):
    expect(connectorStateWord('listening').tone).toBe('amber');
    expect(connectorStateWord('listening').label).toBe('Listening — waiting for analyzer');
    expect(connectorStateWord('connected')).toEqual({ label: 'Connected', tone: 'green' });
    expect(connectorStateWord('disconnected').label).toBe('Not connected');
  });
});

describe('"connected from 192.168.1.21 · last data 2 min ago"', () => {
  it('remote host and ago words', () => {
    expect(remoteHost('192.168.1.21:58561')).toBe('192.168.1.21');
    expect(remoteHost('::ffff:192.168.1.21:58561')).toBe('192.168.1.21');
    expect(remoteHost('COM3')).toBe('COM3');
    expect(agoWords('2026-10-24T10:29:50Z', NOW)).toBe('just now');
    expect(agoWords('2026-10-24T10:28:00Z', NOW)).toBe('2 min ago');
    expect(agoWords('2026-10-24T07:30:00Z', NOW)).toBe('3 h ago');
    expect(agoWords('2026-10-23T09:00:00Z', NOW)).toBe('yesterday');
    expect(agoWords(null, NOW)).toBe('');
  });

  it('builds the line from sessions + the last byte (keep-alives count)', () => {
    expect(connectedFromLine({ sessions: [{ remote: '192.168.1.21:58561', since: '2026-10-24T09:00:00Z' }], lastRxAt: '2026-10-24T10:28:00Z' }, NOW))
      .toBe('connected from 192.168.1.21 · last data 2 min ago');
    expect(connectedFromLine({ sessions: [{ remote: '192.168.1.21:1', since: null }, { remote: '192.168.1.22:2', since: null }] }, NOW))
      .toBe('connected from 192.168.1.21 + 1 more');
    expect(connectedFromLine({ sessions: [], lastRxAt: '2026-10-24T10:18:00Z' }, NOW)).toBe('last data 12 min ago');
    expect(connectedFromLine({ sessions: [], lastRxAt: null, lastMessageAt: '2026-10-24T10:28:00Z' }, NOW)).toBe('last data 2 min ago');
    expect(connectedFromLine(null, NOW)).toBe('');
  });

  it('list / editor sub-line per status; DTO fields win over the heartbeat copy', () => {
    const online = dto({ sessions: [{ remote: '192.168.1.21:58561', since: '2026-10-24T09:00:00Z' }], lastRxAt: '2026-10-24T10:28:00Z' });
    expect(statusSubline(online, NOW)).toBe('connected from 192.168.1.21 · last data 2 min ago');
    expect(statusSubline(dto({ status: 'waiting', listenPort: 5604 }), NOW)).toBe('listening on port 5604');
    expect(statusSubline(dto({ status: 'error', errorDetail: 'Port 5600 is used by CBCLisM51 (PID 7412).' }), NOW)).toBe('Port 5600 is used by CBCLisM51 (PID 7412).');
    // Older server: the fields only live in lastStatus (the heartbeat stored verbatim).
    const old = dto({ status: 'waiting', lastStatus: { status: 'listening', link: 'waiting', listenPort: 5599 } });
    expect(liveOf(old).listenPort).toBe(5599);
    expect(statusSubline(old, NOW)).toBe('listening on port 5599');
    expect(statusSubline(dto({ status: 'offline', sessions: [] }), NOW)).toMatch(/^Last seen /);
    expect(statusSubline(null, NOW)).toBe('');
  });
});
