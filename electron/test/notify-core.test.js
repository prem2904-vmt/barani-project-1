// node --test electron/test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../notify-core');

test('settings: defaults are all on; only known booleans survive', () => {
  assert.deepEqual(core.sanitizeSettings(null), { calls: true, messages: true, alerts: true, sound: true, openAtLogin: true });
  const s = core.sanitizeSettings({ calls: false, sound: 'no', evil: true }, { ...core.DEFAULTS, openAtLogin: false });
  assert.equal(s.calls, false);
  assert.equal(s.sound, true);
  assert.equal(s.openAtLogin, false);
  assert.equal('evil' in s, false);
  assert.deepEqual(core.sanitizePatch({ messages: false, x: 1, alerts: 'off' }), { messages: false });
  assert.deepEqual(core.sanitizePatch(null), {});
});

test('kind switches', () => {
  assert.equal(core.allows({ calls: false }, 'call'), false);
  assert.equal(core.allows({}, 'call'), true);
  assert.equal(core.allows({ messages: false }, 'message'), false);
  assert.equal(core.allows({ alerts: false }, 'alert'), false);
  assert.equal(core.allows({}, 'unknown'), false);
});

test('badge: chat + bell, clamped, labelled', () => {
  assert.equal(core.badgeTotal({ chat: 3, bell: 2 }), 5);
  assert.equal(core.badgeTotal({ chat: -4, bell: 'x' }), 0);
  assert.equal(core.badgeTotal({ chat: 2.9, bell: 0 }), 2);
  assert.equal(core.badgeTotal({ chat: 9000, bell: 9000 }), 9999);
  assert.equal(core.badgeTotal(null), 0);
  assert.equal(core.badgeLabel(0), '');
  assert.equal(core.badgeLabel(7), '7');
  assert.equal(core.badgeLabel(120), '99+');
  assert.equal(core.trayTooltip(0), 'Prefrontal');
  assert.equal(core.trayTooltip(4), 'Prefrontal — 4 unread');
});

test('login item: hidden start on Windows via an argument, openAsHidden on macOS', () => {
  assert.deepEqual(core.loginItemOptions('win32', true), { openAtLogin: true, args: ['--pf-hidden'] });
  assert.deepEqual(core.loginItemOptions('darwin', false), { openAtLogin: false, openAsHidden: true });
  assert.deepEqual(core.loginItemOptions('linux', true), { openAtLogin: true });
  assert.equal(core.launchedHidden({ argv: ['app.exe', '--pf-hidden'], platform: 'win32' }), true);
  assert.equal(core.launchedHidden({ argv: ['app.exe'], platform: 'win32' }), false);
  assert.equal(core.launchedHidden({ argv: [], platform: 'darwin', loginSettings: { wasOpenedAtLogin: true } }), true);
  assert.equal(core.launchedHidden({ argv: [], platform: 'darwin', loginSettings: { wasOpenedAtLogin: false } }), false);
  assert.equal(core.launchedHidden(), false);
});

test('window state → in front only when shown AND focused', () => {
  const win = (f, v, m) => ({ isDestroyed: () => false, isFocused: () => f, isVisible: () => v, isMinimized: () => m });
  assert.deepEqual(core.windowState(win(true, true, false)), { focused: true, visible: true, minimized: false });
  assert.equal(core.inFront(core.windowState(win(true, true, false))), true);
  assert.equal(core.inFront(core.windowState(win(false, true, false))), false);   // another app in front
  assert.equal(core.inFront(core.windowState(win(false, false, false))), false);  // tray
  assert.equal(core.inFront(core.windowState(win(true, true, true))), false);     // minimised
  assert.deepEqual(core.windowState(null), { focused: false, visible: false, minimized: false });
  assert.deepEqual(core.windowState({ isDestroyed: () => true }), { focused: false, visible: false, minimized: false });
});

test('bell alert: cleaned, bounded, repeat-tagged; junk refused', () => {
  const a = core.sanitizeAlert({ kind: 'report_ready', title: ' Report ready ', body: 'x'.repeat(400), referenceType: 'report', referenceId: 'r-1', critical: 1 });
  assert.equal(a.title, 'Report ready');
  assert.equal(a.body.length, 181);
  assert.equal(a.critical, true);
  assert.equal(a.tag, 'report_ready:r-1');
  // Same event twice → same tag (replaces instead of stacking).
  assert.equal(core.sanitizeAlert({ kind: 'report_ready', title: 'Report ready', referenceId: 'r-1' }).tag, a.tag);
  const b = core.sanitizeAlert({ kind: '<script>', title: 'T', referenceType: 'a b', referenceId: '../../x' });
  assert.equal(b.kind, 'notification');
  assert.equal(b.referenceType, null);
  assert.equal(b.referenceId, null);
  assert.equal(core.sanitizeAlert({ title: '   ' }), null);
  assert.equal(core.sanitizeAlert(null), null);
});

test('overlay / tray dot bitmaps are premultiplied BGRA circles', () => {
  const d = core.dotBitmap(16);
  assert.equal(d.length, 16 * 16 * 4);
  const px = (x, y) => Array.from(d.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
  assert.deepEqual(px(8, 8), [38, 38, 220, 255]);   // centre: opaque red (B,G,R,A)
  assert.equal(px(0, 0)[3], 0);                      // corner: transparent
  const icon = Buffer.alloc(16 * 16 * 4, 0);
  const out = core.withDot(icon, 16);
  assert.equal(out[(0 * 16 + 1) * 4 + 3], 0);        // top-left untouched
  assert.ok(out[(3 * 16 + 12) * 4 + 3] > 200);       // dot in the top-right
  assert.equal(icon[(3 * 16 + 12) * 4 + 3], 0);      // input not mutated
});
