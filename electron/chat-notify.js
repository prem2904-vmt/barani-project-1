/*
 * Native chat notifications for the desktop app, with an inline REPLY on macOS
 * (Notification hasReply). The renderer's ChatNotifyService calls
 * electronAPI.chatNotify.show(...) instead of the web Notification API while
 * the window is hidden; Reply / click come back to the renderer as
 * 'chat:action' { type: 'reply' | 'open', conversationId, text? } — the
 * renderer sends with its own live session (nothing is stored here).
 */
const { Notification, ipcMain } = require('electron');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One live notification per conversation (a newer message replaces it).
const live = new Map();

function messagesEnabled() {
  try { return require('./notify').getSettings().messages !== false; } catch { return true; }
}

function register(getWindow) {
  ipcMain.on('chat:notify', (e, info) => {
    const main = getWindow();
    if (!main || main.isDestroyed() || e.sender !== main.webContents) return; // only the app window
    if (!Notification.isSupported() || !info || !UUID.test(String(info.conversationId || ''))) return;
    // Per-user "Messages" switch (avatar menu → Desktop notifications).
    if (!messagesEnabled()) return;
    const conversationId = String(info.conversationId);
    const prev = live.get(conversationId);
    if (prev) { try { prev.close(); } catch { /* gone */ } }
    const n = new Notification({
      title: String(info.title || 'New message').slice(0, 120),
      body: String(info.body || '').slice(0, 300),
      silent: true, // the renderer plays the chat ping
      hasReply: process.platform === 'darwin',
      replyPlaceholder: 'Message',
    });
    const send = (a) => {
      const w = getWindow();
      if (w && !w.isDestroyed()) w.webContents.send('chat:action', a);
    };
    n.on('reply', (_ev, reply) => {
      const text = String(reply || '').trim();
      if (text) send({ type: 'reply', conversationId, text: text.slice(0, 4000) });
    });
    n.on('click', () => {
      const w = getWindow();
      if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
      send({ type: 'open', conversationId });
    });
    n.on('close', () => { if (live.get(conversationId) === n) live.delete(conversationId); });
    live.set(conversationId, n);
    n.show();
    // Taskbar flash (Windows) / one dock bounce (macOS) until the window is
    // focused again (calls.attach stops it on focus).
    if (!main.isFocused()) { try { main.flashFrame(true); } catch { /* gone */ } }
  });
}

module.exports = { register };
