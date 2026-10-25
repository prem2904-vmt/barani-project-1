# Lab analyzer connector (first cut: CBC)

Receives results from lab analyzers (serial RS-232 / USB-serial, TCP, or an export folder), turns them into a normalized
message and uploads them to the LMS, where they become **prefills** on the matching order lines. Nothing is ever
auto-submitted or auto-validated: the tech still reviews, edits and saves in result entry.

Any analyzer is a **settings profile, not code**: four configurable layers.

```
 analyzer ──► 1 transport ──► 2 link/framing ──► 3 parser ──► InstrumentMessage ──► disk queue ──► LMS API
              serial          ASTM E1381         ASTM E1394     { sampleId, runAt,     (JSONL,        POST /api/instruments/{id}/messages
              TCP server      HL7 MLLP           HL7 ORU^R01      qc, results[] }        idempotent)   (X-Instrument-Key)
              TCP client      raw text           text template                                          │
              folder watch    (auto-sniff)       (auto-detect)                                          ▼
                                                                                         4 mapping (server): analyzer code →
                                                                                           Test Master analyte (catalogKey),
                                                                                           ×factor +offset, decimals
```

## Layout

| Path | What |
|---|---|
| `core/` | **Host-agnostic plain Node** (no Electron import anywhere). |
| `core/transports/` | `tcp.js` (server + client, reconnect), `serial.js` (`serialport`, lazily required, injectable), `folder.js` (poll, size-stable, move/rename after read). |
| `core/link/` | `astm-e1381.js` (receiver + sender state machines: ENQ/ACK/NAK, STX FN … ETB/ETX C1C2 CR LF, frame reassembly, checksum verify, NAK on bad checksum/FN, duplicate-frame handling, timeouts, busy/contention NAK), `mllp.js` (VT … FS CR, HL7 ACK reply), `raw.js` (terminator / idle timeout), `stx-etx.js` (opt-in: bare `<STX>` record `<ETX>` → `<ACK>`, retransmit dedupe — LifeDx HBPro), `sinocare-sn.js` (opt-in: `SN` + len + type + JSON + CRC-16/MODBUS, replyMode none/echo — Sinocare iCARE-2100), `index.js` (factory + **auto** link: ENQ → ASTM, VT → MLLP, else raw; auto never picks the opt-in links). |
| `core/parsers/` | `astm.js` (E1394 / LIS2-A2 H P O R C L; delimiters read from the H record; escape sequences; configurable sample-ID field/component; QC via H.12 / O.12), `hl7.js` (ORU^R01: OBR-3/OBR-2/SPM-2/PID-3 sample ID, OBX-3/5/6/8/14, SPM-11 QC role; `buildAck` → `MSA|AA|<ctrl>`), `text.js` (admin regex with named groups `code value unit flag`, sample-ID / QC / run-time patterns, or fixed columns). |
| `core/detect.js` | **Listen mode auto-detect**: from captured bytes → link, protocol, confidence, reasons, proposed `{ link, parser }` config and a parsed preview. |
| `core/mapper.js` | Tested mirror of the server's mapping (`value' = round(value × factor + offset, decimals)`, half away from zero; non-numeric pass through). Used for previews — **the server is the source of truth**. |
| `core/queue.js` | Store-and-forward: append-only JSONL journal (add / try / done / dead / seen), survives crash + restart, torn-line tolerant, exponential backoff with jitter, dead-letter file for permanent 4xx, idempotency keys remembered. |
| `core/uploader.js` | Device-key HTTP client (`GET config`, `POST heartbeat`, `POST messages`); classifies ok / auth / transient / permanent. |
| `core/rawlog.js` | Rotating raw traffic log (visible `<STX>`, `<ETX>`, `<CR>`…) + in-memory ring for the live viewer. |
| `core/connector.js` | One analyzer end to end; one link state machine per session; ACK to the analyzer happens once the message is **on disk**; heartbeat; status. |
| `core/listen.js` | Listen session (captures, ACKs like a LIS so the analyzer keeps talking, never uploads) + `preview(raw)`. |
| `core/manager.js` | Host API: pair (key verified against the server first) / unpair / list / status / raw log / serial ports / listen. |
| `host-electron.js` | Electron main-process host: IPC handlers (accepted only from the main window), keys encrypted with `safeStorage`, starts with the app, keeps running in the tray, stops on quit. |
| `host-node.js` | Headless host (Raspberry Pi later): `pair`, `run`, `list`, `unpair`. |
| `sim/` | `cbc-sim.js` CLI, `dialects.js` (generic dialects), `cbc-data.js` (realistic 5-part / 3-part CBC), `pty-pair.py` (virtual null-modem when socat is absent). |
| `e2e/` | `harness.js`, `fake-api.js`, `run-sim-e2e.js` (real backend driver), `run-bidi-e2e.js` (two-way real-backend driver, used by prefrontal-mw `InstrumentBidiSimE2ETests`). |
| `test/` | `node:test` suites. |

Renderer bridge (preload): `window.electronAPI.instruments` — `list, pair, unpair, status, onStatus, rawLog, listSerialPorts,
listenStart, listenStop, onListen, preview`. The renderer never sees Node objects or the stored key.

Per-host state: `<userData>/instruments/` (Electron) or `$PF_INSTRUMENTS_DIR` (headless):
`paired.json` (keys encrypted), `<instrumentId>/queue.jsonl`, `queue.dead.jsonl`, `raw.log(.1…)`, `config.json` (last config
pulled, so the connector starts offline).

## Tests

```bash
npm run test:instruments            # node --test electron/instruments/test/*.test.js
```

Covers ASTM framing (checksum, NAK + retransmit, ETB multi-frame, FN wrap, duplicate frame, timeouts, contention, give-up),
E1394 with custom delimiters + escapes, HL7 parse + ACK, text templates (regex + fixed columns + multi-ticket), auto-detect,
mapper conversion/rounding, queue persistence/idempotency/dead-letter, MLLP/raw links, raw-log rotation, and **connector ⇄
simulator ⇄ fake API over real sockets** for every dialect × {TCP server, TCP client}, plus serial over a virtual pair,
store-and-forward across a restart, pairing, and listen mode. The serial test skips (with the reason) if `serialport` is not
installed or no virtual pair can be created.

The **real-backend** e2e lives in prefrontal-mw (`Prefrontal.Tests.Integration/InstrumentSimE2ETests.cs`): it hosts the API
on a local port, seeds instruments/keys/code maps and CBC orders, runs `e2e/run-sim-e2e.js` and asserts that the values land
as prefills on the right order lines, the unknown barcode is unmatched, QC is separate, the re-run supersedes, and the bad
checksum frame was NAKed and recovered. Run it with:

```bash
PREFRONTAL_TEST_DB=prefrontal_test_inst PF_UI_REPO=/path/to/prefrontal-ui \
  dotnet test Prefrontal.Tests.Integration --filter InstrumentSimE2E
```

## Running the simulator against a locally running app

1. Start the backend locally and the desktop app (`npm run electron:dev`), log in as a lab admin.
2. **Lab settings → Instruments → Add instrument.** Connection *TCP server, port 5001* (or serial / TCP client), protocol
   *Auto-detect*. Save, **Generate device key**, **Pair this PC**.
3. Map codes (**Load CBC defaults**), order a CBC for a patient, collect it and note the tube barcode.
4. Send results:

```bash
# ASTM E1381/E1394 — simulator connects to the connector's TCP server
node electron/instruments/sim/cbc-sim.js --dialect astm-5part --transport tcp-client --port 5001 --sample <barcode>

# Everything at once: normal, re-run, QC, unknown barcode, corrupted checksum (NAK + retransmit), burst of 5
node electron/instruments/sim/cbc-sim.js --dialect astm-5part --transport tcp-client --port 5001 --sample <barcode> --scenario all

# HL7 v2 ORU^R01 over MLLP (expects MSA|AA back)
node electron/instruments/sim/cbc-sim.js --dialect hl7-5part --transport tcp-client --port 5001 --sample <barcode>

# Printed 3-part ticket (plain text, form-feed terminated) — use protocol Text template or Auto
node electron/instruments/sim/cbc-sim.js --dialect text-3part --transport tcp-client --port 5001 --sample <barcode>

# The connector as TCP CLIENT: the simulator listens, the instrument is configured "TCP client → 127.0.0.1:5100"
node electron/instruments/sim/cbc-sim.js --dialect astm-5part --transport tcp-server --port 5100 --sample <barcode>
```

Options: `--dialect astm-5part|hl7-5part|text-3part`, `--transport tcp-client|tcp-server|serial`, `--host`, `--port`,
`--serial-path`, `--baud`, `--sample a,b,c`, `--count N`, `--scenario normal|rerun|qc|unknown|badchecksum|burst|all`,
`--unknown-id`, `--delay ms`, `--json`. The dialects are **generic, standards-shaped outputs** — not any vendor's format.

5. Open result entry for the tube: the CBC analytes are prefilled with a "From <instrument> · HH:MM" badge and the
   analyzer's H/L flags. Unknown barcodes appear under **Unmatched analyzer results**, where they can be attached to a tube.

Listen mode: on the instrument wizard, **Start listening**, run any simulator command, and watch the raw capture, the detected
protocol and the parsed preview (e.g. `Sample 26123 · WBC 7.8 10^3/uL · H`).

### Serial on macOS with a virtual null-modem

```bash
socat -d -d pty,raw,echo=0 pty,raw,echo=0
# → PTY is /dev/ttys003   PTY is /dev/ttys004
```

Configure the instrument as *Serial, /dev/ttys003, 9600 8N1*, then:

```bash
node electron/instruments/sim/cbc-sim.js --dialect astm-5part --transport serial --serial-path /dev/ttys004 --sample <barcode>
```

No socat (`brew install socat`)? `python3 electron/instruments/sim/pty-pair.py` prints `{"a": "/dev/ttys…", "b": "/dev/ttys…"}`
and relays between them the same way. (The automated tests try socat first, then this relay.)

## Two-way (host query + worklist)

Off unless the instrument config carries `bidirectional.mode` of `query | worklist | both` (absent or `off` = the code
paths below are never entered: queries are ACKed/ignored exactly as before, status has no `bidi` field). Code: `core/bidi/`.

| Piece | What |
|---|---|
| `bidi/astm.js` | ASTM E1394 / LIS2-A2 `Q` record → ids (specimen component configurable: `bidirectional.astmQueryComponent`, default auto = component 2, then 3, then 1; ranges expand up to 20, `ALL` = the cached worklist, max 10 Q records per session). Answer = **new** E1381 session via `AstmSender`: `H, [P], O…, L|1|N` (P only with `sendPatient`: id in P.3/P.4, plain name P.6, DOB P.8, sex P.9; O.5 repeat list, O.6 `S` urgent / `R`, O.12 `A` for query replies and `N` for worklist downloads unless `astmActionCode` overrides, O.26 `O`). Not found / timeout with nothing cached = `H, L|1|I` (LIS2-A2 "no information"); server refusal (409 / non-retryable) = `H`, Q echo with Q.13 `X`, `L|1|Q`. Never an empty order. **Canonical bytes** are in `test/fixtures/bidi-wire.json` (shared with the Pi Bridge; regenerate with `UPDATE_WIRE=1`). The O-record sample id goes where `parser.astm.sampleIdField/Component` reads it. |
| `bidi/hl7.js` | `QRY^Q02` → `QCK^Q02` (+ `DSR^Q03` with DSP rows when found); `QBP^Q11` → `RSP^K11` (QAK OK/NF, QPD echo, ORC/OBR per test); worklist `ORM^O01` or `OML^O21`. DSP layouts are the `DSP_DIALECTS` table (`mindray-bs`, `autolab`, `generic`), auto-picked from MSH-3/4, overridden by `bidirectional.hl7Dialect`; confirm against the analyzer manual. |
| `bidi/escape.js` | ASTM (`&F& &S& &R& &E&`) and HL7 (`\F\ \S\ \T\ \R\ \E\`, `\.br\`) escaping for every field we send. |
| `bidi/store.js` | `bidi-sent.jsonl` (sampleId + test-set hash, torn-line tolerant) and `bidi-cache.json` (orders served when the server is slow/offline; expires after `worklistWindowHours`, never holds a "not found"). |
| `bidi/index.js` | `BidiHost`: query handling, per-session send serialisation, worklist scheduler (`worklistTick()`), counters. |
| `uploader.js` | `getOrders(sampleId)` / `getWorklist({since})` — **hard 4 s** ceiling on queries (abort + race), device-key header. |

Rules: the answer is only what the server (or an earlier server answer in the cache) said — tests are never invented;
timeout/offline with nothing cached = "no order"; patient details only with `sendPatient`. ASTM contention: the analyzer's
session wins — we wait for its EOT (plus a short hold), then ENQ; a crossed ENQ is retried after the analyzer's EOT
(`AstmSender` `beforeEnq` gate). HL7 worklist waits for the ACK (`MSA|AA`/`CA`), retries `AE`/`AR`/timeout with back-off
(2 retries per cycle, then a per-sample back-off across cycles). Status gains `bidi: { mode, queriesAnswered,
queriesNotFound, queriesFromCache, queryErrors, worklistSent, worklistFailed, lastQueryAt, lastWorklistAt, cachedOrders,
lastError }` (IST-day counters) and every query/answer/download is a note in the raw log.

Simulators: `sim/query-sim.js` (`QuerySim`: ASTM Q, `QRY^Q02`, `QBP^Q11`, worklist acceptance with scripted ACK codes),
`astm-chem` / `hl7-chem` dialects (glucose, urea, creatinine, cholesterol… in `sim/chem-data.js`), and
`cbc-sim.js --scenario query|worklist` (`--hl7-query q11`, `--listen-ms`).

```bash
node electron/instruments/sim/cbc-sim.js --dialect astm-chem --transport tcp-client --port 5001 --scenario query --sample 260100001
node electron/instruments/sim/cbc-sim.js --dialect hl7-chem  --transport tcp-client --port 5001 --scenario query --hl7-query q11 --sample 260100001
```

## Adding a new analyzer profile

No code for standard analyzers:

1. **Connection** from the analyzer's LIS/host settings (baud/parity/stop bits/flow, or IP/port and who connects).
2. **Listen mode** → run a sample on the analyzer → check the detected protocol and **Use this**. ASTM: pick the O field /
   component that carries the barcode (O.3 LIS specimen ID vs O.4 instrument specimen ID). HL7: OBR-3 / OBR-2 / SPM-2.
   Printed output: adjust the **Text template** regexes until the preview is right (named groups `code`, `value`, `unit`,
   `flag`; `id` for the sample line).
3. **Code mapping**: every analyzer code → Test Master analyte (catalog key), with factor/offset/decimals for unit
   differences (e.g. WBC 10^3/µL → cells/µL = ×1000). Unmapped codes are listed on each message.
4. Generate a device key and pair the PC.

Code is needed only for a genuinely new link/framing (e.g. a binary protocol): add a receiver next to `core/link/*.js`
(implement `feed/reset/close`, emit `message`) and register it in `core/link/index.js` + `detect.js`.

## Known gaps (first cut)

- Two-way is connector-side only here and off by default (see **Two-way** below); remote start of a run is impossible by
  design (the tube must be loaded on the analyzer).
- One active connection per link session; a TCP server accepts several analyzers but all share one instrument profile.
- Analyzer timestamps carry no zone and are read in the host's local zone.
- Histograms / scattergrams (HL7 OBX type `ED`, e.g. the Medonic M51) are extracted into `message.images[]` (`code`,
  `label`, `format`, `base64`) and uploaded alongside the results — never inlined into `raw` (see `parsers/hl7.js`
  `redactEdImages`). The LifeDx HBPro sends its HbA1c chromatogram as numbers (200 × `d.dddd` OD after the results, one
  point every 0.65 s); `parsers/hbpro-graph.js` draws it as a PNG (pure JS, `core/raster.js`) and adds it as image code
  `HbA1c-graph` — it lands on the HbA1c line, shows under Analyzer graphs in result entry and prints with the report
  (`parser.hbpro.graph: false` turns it off).
- QC is stored and listed, not yet charted (no Levey-Jennings / Westgard).
- Raspberry Pi host: CLI only — no systemd unit, OS keyring or auto-update yet; keys use the 0600 plain codec there.
- Folder watch reads a whole file as one message set; no archive retention policy.
- Serial is proven with a virtual pair (socat / pty relay), not yet on a physical RS-232 line.
