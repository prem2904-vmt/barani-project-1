// node --test electron/test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, InstrumentConnectivityWatcher } = require('../instrument-notify');

test('classify: connected/listening = up, disconnected/error = down, everything else neutral', () => {
  assert.equal(classify('connected'), 'up');
  assert.equal(classify('listening'), 'up');
  assert.equal(classify('disconnected'), 'down');
  assert.equal(classify('error'), 'down');
  assert.equal(classify('starting'), null);
  assert.equal(classify('stopped'), null);
  assert.equal(classify('unknown-future-state'), null);
});

/** A manual, synchronous fake timer: setTimer just records {fn, ms}; tick()
 *  runs every pending callback whose delay has "elapsed" against a fake
 *  clock advanced by the test, so the 30s debounce is exercised without a
 *  real wait. */
function fakeClock() {
  let now = 0;
  const pending = []; // { id, fn, at }
  let nextId = 1;
  return {
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; pending.push({ id, fn, at: now + ms }); return id; },
    clearTimer: (id) => { const i = pending.findIndex((p) => p.id === id); if (i >= 0) pending.splice(i, 1); },
    advance(ms) {
      now += ms;
      // Run due timers in the order they'd naturally fire; a timer's own fn
      // may schedule nothing further here (watcher never re-arms itself).
      for (const p of [...pending]) {
        if (p.at <= now && pending.includes(p)) {
          const idx = pending.indexOf(p);
          if (idx >= 0) pending.splice(idx, 1);
          p.fn();
        }
      }
    },
  };
}

test('first sighting of an instrument never fires (no "reconnected" at app launch)', () => {
  const fired = [];
  const clock = fakeClock();
  const w = new InstrumentConnectivityWatcher({ onFire: (i) => fired.push(i), debounceMs: 30_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  w.report('i1', 'Sysmex XN', 'connected');
  clock.advance(60_000);
  assert.deepEqual(fired, []);
});

test('a real, sustained state change fires once, after the debounce window', () => {
  const fired = [];
  const clock = fakeClock();
  const w = new InstrumentConnectivityWatcher({ onFire: (i) => fired.push(i), debounceMs: 30_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  w.report('i1', 'Sysmex XN', 'connected');  // first sighting — silent
  w.report('i1', 'Sysmex XN', 'disconnected');
  clock.advance(29_999);
  assert.deepEqual(fired, [], 'not yet — debounce window still open');
  clock.advance(1);
  assert.deepEqual(fired, [{ instrumentId: 'i1', name: 'Sysmex XN', cls: 'down' }]);
});

test('flapping within the debounce window fires nothing (settles back to the already-known state)', () => {
  const fired = [];
  const clock = fakeClock();
  const w = new InstrumentConnectivityWatcher({ onFire: (i) => fired.push(i), debounceMs: 30_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  w.report('i1', 'Cable', 'connected');       // first sighting
  w.report('i1', 'Cable', 'disconnected');    // flaps...
  clock.advance(5_000);
  w.report('i1', 'Cable', 'connected');       // ...back to the known state before the debounce fires
  clock.advance(60_000);
  assert.deepEqual(fired, [], 'a flap shorter than the debounce window is never announced');
});

test('once notified, the SAME stable state is never re-announced on repeat status ticks', () => {
  const fired = [];
  const clock = fakeClock();
  const w = new InstrumentConnectivityWatcher({ onFire: (i) => fired.push(i), debounceMs: 30_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  w.report('i1', 'Cable', 'connected');
  w.report('i1', 'Cable', 'disconnected');
  clock.advance(30_000);
  assert.equal(fired.length, 1);
  // Heartbeat keeps ticking "disconnected" every 30s — no repeat notification.
  for (let i = 0; i < 5; i++) { w.report('i1', 'Cable', 'disconnected'); clock.advance(30_000); }
  assert.equal(fired.length, 1);
});

test('reconnect after a real disconnect fires its own notification', () => {
  const fired = [];
  const clock = fakeClock();
  const w = new InstrumentConnectivityWatcher({ onFire: (i) => fired.push(i), debounceMs: 30_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  w.report('i1', 'Cable', 'connected');
  w.report('i1', 'Cable', 'disconnected');
  clock.advance(30_000);
  w.report('i1', 'Cable', 'connected');
  clock.advance(30_000);
  assert.deepEqual(fired.map((f) => f.cls), ['down', 'up']);
});

test('two instruments are tracked independently', () => {
  const fired = [];
  const clock = fakeClock();
  const w = new InstrumentConnectivityWatcher({ onFire: (i) => fired.push(i), debounceMs: 30_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  w.report('a', 'A', 'connected');
  w.report('b', 'B', 'connected');
  w.report('a', 'A', 'disconnected');
  clock.advance(30_000);
  assert.deepEqual(fired, [{ instrumentId: 'a', name: 'A', cls: 'down' }]);
});

test('a neutral tick (starting/stopped) never cancels a pending flip or counts as a sighting', () => {
  const fired = [];
  const clock = fakeClock();
  const w = new InstrumentConnectivityWatcher({ onFire: (i) => fired.push(i), debounceMs: 30_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  w.report('i1', 'Cable', 'connected');
  w.report('i1', 'Cable', 'disconnected');
  w.report('i1', 'Cable', 'starting'); // neutral — ignored
  clock.advance(30_000);
  assert.deepEqual(fired.map((f) => f.cls), ['down']);
});

test('forget() drops an unpaired instrument and cancels its pending timer', () => {
  const fired = [];
  const clock = fakeClock();
  const w = new InstrumentConnectivityWatcher({ onFire: (i) => fired.push(i), debounceMs: 30_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  w.report('i1', 'Cable', 'connected');
  w.report('i1', 'Cable', 'disconnected');
  w.forget('i1');
  clock.advance(60_000);
  assert.deepEqual(fired, []);
  // Re-paired later: treated as a fresh first sighting again.
  w.report('i1', 'Cable', 'connected');
  clock.advance(60_000);
  assert.deepEqual(fired, []);
});


test('true link: connected = up, error / not_connected = down, waiting (listening, nobody on it) is neutral', () => {
  assert.equal(classify('connected', 'connected'), 'up');
  assert.equal(classify('listening', 'waiting'), null);
  assert.equal(classify('error', 'error'), 'down');
  assert.equal(classify('disconnected', 'not_connected'), 'down');
  assert.equal(classify('stopped', 'not_connected'), null);
  assert.equal(classify('starting', 'not_connected'), null);
});

test('an analyzer that connects per run and hangs up never announces "disconnected"', () => {
  const fired = [];
  const timers = [];
  const w = new InstrumentConnectivityWatcher({
    onFire: (x) => fired.push(x), debounceMs: 10,
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {},
  });
  w.report('i1', 'Medonic', 'listening', 'waiting');     // first sighting: waiting is neutral, nothing recorded
  w.report('i1', 'Medonic', 'connected', 'connected');   // first real class: recorded silently
  w.report('i1', 'Medonic', 'listening', 'waiting');     // run done, analyzer hung up
  w.report('i1', 'Medonic', 'connected', 'connected');
  timers.forEach((fn) => fn());
  assert.deepEqual(fired, []);
  // A port that stops working does announce.
  w.report('i1', 'Medonic', 'error', 'error');
  timers.forEach((fn) => fn());
  assert.equal(fired.length, 1);
  assert.equal(fired[0].cls, 'down');
});
