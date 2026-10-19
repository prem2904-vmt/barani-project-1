'use strict';
/**
 * Raw traffic log: every byte in/out of the analyzer, rendered with visible
 * control characters. A rotating file on disk (size-capped, N generations)
 * plus an in-memory ring of recent entries for the live viewer.
 *
 * The raw log can contain sample barcodes and results (no patient names in
 * the E1394/HL7 streams we generate, but analyzers may send them): it stays
 * on the connector host and is never uploaded except as the message raw.
 */
const fs = require('fs');
const path = require('path');
const { visible, toBuffer } = require('./bytes');

class RawLog {
  constructor({ dir, name = 'raw', maxBytes = 5 * 1024 * 1024, keep = 3, ring = 500, now } = {}) {
    this.dir = dir;
    this.file = dir ? path.join(dir, `${name}.log`) : null;
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.ringSize = ring;
    this.ring = [];
    this.now = now || Date.now;
    this.size = 0;
    if (this.file) {
      fs.mkdirSync(dir, { recursive: true });
      try { this.size = fs.statSync(this.file).size; } catch { this.size = 0; }
    }
  }

  /** @param {'in'|'out'|'note'} dir */
  write(dir, data) {
    const bytes = dir === 'note' ? Buffer.from(String(data)) : toBuffer(data);
    const entry = { at: new Date(this.now()).toISOString(), dir, text: dir === 'note' ? String(data) : visible(bytes), bytes: bytes.length };
    this.ring.push(entry);
    if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize);
    if (this.file) {
      const line = `${entry.at} ${dir === 'in' ? '<<' : dir === 'out' ? '>>' : '--'} ${entry.text.replace(/\n/g, '\n    ')}\n`;
      try {
        if (this.size + line.length > this.maxBytes) this._rotate();
        fs.appendFileSync(this.file, line);
        this.size += Buffer.byteLength(line);
      } catch { /* logging must never break the connector */ }
    }
    return entry;
  }

  _rotate() {
    for (let i = this.keep - 1; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      const to = `${this.file}.${i + 1}`;
      if (fs.existsSync(from)) { try { fs.renameSync(from, to); } catch { /* ignore */ } }
    }
    try { fs.renameSync(this.file, `${this.file}.1`); } catch { /* ignore */ }
    const over = `${this.file}.${this.keep + 1}`;
    if (fs.existsSync(over)) { try { fs.unlinkSync(over); } catch { /* ignore */ } }
    this.size = 0;
  }

  recent(limit = 200) { return this.ring.slice(-limit); }
}

module.exports = { RawLog };
