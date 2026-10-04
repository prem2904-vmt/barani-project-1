'use strict';
/**
 * Folder-watch transport: the analyzer (or its vendor software) exports one
 * file per run into a folder. We poll (portable across SMB shares, where fs
 * watch events are unreliable), wait until a file's size is stable across
 * two polls (the writer has finished), read it, emit 'file' (text, name),
 * then move it to `moveTo` (or rename it to *.done) so it is never re-read.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

function globToRe(glob) {
  const g = String(glob || '*').trim() || '*';
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

class FolderTransport extends EventEmitter {
  constructor({ path: dir, pattern = '*', pollMs = 2000, moveTo = null } = {}) {
    super();
    this.dir = dir;
    this.re = globToRe(pattern);
    this.pollMs = pollMs;
    this.moveTo = moveTo;
    this.sizes = new Map();
    this.timer = null;
    this.kind = 'folder';
  }

  describe() { return `Folder ${this.dir}`; }

  start() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (this.moveTo) fs.mkdirSync(this.moveTo, { recursive: true });
    this.emit('status', 'listening');
    this._tick();
    return Promise.resolve();
  }

  _tick() {
    try { this.poll(); } catch (e) { this.emit('error', e); }
    this.timer = setTimeout(() => this._tick(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** One scan (public for tests). */
  poll() {
    const names = fs.readdirSync(this.dir).filter((n) => this.re.test(n) && !n.endsWith('.done'));
    for (const name of names) {
      const full = path.join(this.dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      const prev = this.sizes.get(name);
      this.sizes.set(name, st.size);
      if (prev === undefined || prev !== st.size) continue;  // still being written
      const text = fs.readFileSync(full).toString('latin1');
      this.sizes.delete(name);
      try {
        if (this.moveTo) fs.renameSync(full, path.join(this.moveTo, name));
        else fs.renameSync(full, `${full}.done`);
      } catch (e) { this.emit('error', e); }
      this.emit('file', text, name);
    }
  }

  write() { /* folder transport is one-way */ }

  stop() { clearTimeout(this.timer); this.emit('status', 'disconnected'); return Promise.resolve(); }
}

module.exports = { FolderTransport, globToRe };
