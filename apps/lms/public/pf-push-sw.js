/*
 * Prefrontal Web Push service worker — the plain-browser leg of OFFLINE
 * CALLING and CHAT pushes (registered by web-push.service.ts; never on
 * Capacitor/Electron).
 *
 *   push { kind:"chat-message", conversationId, messageId, title, body, … }
 *     → a message notification (one per conversation, tag pf-chat-<id>),
 *       unless a Prefrontal tab is VISIBLE (its in-app pop-up covers it).
 *       While a tab is open (hidden), it also offers inline "Reply" (where
 *       the browser supports text actions) and "Mark as read" — both handed
 *       to that tab (postMessage pf-chat-reply / pf-chat-read), which sends
 *       with its own session. Click → the conversation.
 *
 *   push { kind:"call-incoming", callId, fromName, callType }
 *     → "Incoming call — <name> is calling" with Answer / Decline, unless a
 *       Prefrontal tab is VISIBLE (that tab is already ringing in-app).
 *   push { kind:"call-end", callId, reason }
 *     → close that call's notification; if it was never picked up (caller
 *       cancelled / no answer) leave a quiet "Missed call" in its place.
 *   click → Answer / Decline / open: hand the choice to an open tab
 *     (postMessage {type:"pf-call", action, callId}) or open the app with
 *     ?pfCall=<action>:<callId> — call-push.service.ts takes it from there.
 *
 * The payload carries the caller's display name and the call id only.
 * No caching / fetch interception — this worker never touches app traffic.
 */
/* eslint-disable no-restricted-globals */
'use strict';

const TAG = (id) => 'pf-call-' + id;
const CALL_ID = /^[A-Za-z0-9_-]{6,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_TAG = (id) => 'pf-chat-' + id;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  event.waitUntil(onPush(d));
});

async function windows() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

async function onChatPush(d) {
  if (typeof d.conversationId !== 'string' || !UUID.test(d.conversationId)) return;
  const open = await windows();
  if (open.some((c) => c.visibilityState === 'visible')) return;
  const hasTab = open.length > 0;
  const actions = [];
  if (hasTab) {
    actions.push({ action: 'reply', type: 'text', title: 'Reply', placeholder: 'Message' });
    actions.push({ action: 'read', title: 'Mark as read' });
  }
  return self.registration.showNotification(str(d.title, 120) || 'New message', {
    body: str(d.body, 300),
    tag: CHAT_TAG(d.conversationId),
    renotify: true,
    icon: 'favicon.ico',
    badge: 'favicon.ico',
    data: { kind: 'chat', conversationId: d.conversationId },
    actions,
  });
}

async function onChatClick(event, data) {
  const conv = data.conversationId;
  const open = await windows();
  const tab = open.find((c) => 'focus' in c);
  if (event.action === 'reply') {
    const text = typeof event.reply === 'string' ? event.reply.trim() : '';
    if (tab && text) { tab.postMessage({ type: 'pf-chat-reply', conversationId: conv, text }); return; }
  } else if (event.action === 'read') {
    if (tab) { tab.postMessage({ type: 'pf-chat-read', conversationId: conv }); return; }
    return;
  }
  if (tab) {
    await tab.focus();
    tab.postMessage({ type: 'pf-chat-open', conversationId: conv });
    return;
  }
  return self.clients.openWindow('./messages?c=' + encodeURIComponent(conv));
}

async function onPush(d) {
  if (d && d.kind === 'chat-message') return onChatPush(d);
  if (!d || typeof d.callId !== 'string' || !CALL_ID.test(d.callId)) return;
  const tag = TAG(d.callId);

  if (d.kind === 'call-incoming') {
    const open = await windows();
    // A visible tab rings in-app over its live socket; a second, OS-level
    // ring would just duplicate it. (Browsers don't require a notification
    // while the site is visible.)
    if (open.some((c) => c.visibilityState === 'visible')) return;
    const name = (typeof d.fromName === 'string' && d.fromName.trim()) || 'A colleague';
    return self.registration.showNotification('Incoming call', {
      body: name + ' is calling',
      tag,
      renotify: true,
      requireInteraction: true,
      icon: 'favicon.ico',
      badge: 'favicon.ico',
      vibrate: [500, 300, 500, 300, 500],
      data: { kind: 'call', callId: d.callId, name },
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'decline', title: 'Decline' },
      ],
    });
  }

  if (d.kind === 'call-end') {
    const shown = await self.registration.getNotifications({ tag });
    const ring = shown.find((n) => n.data && n.data.kind === 'call');
    shown.forEach((n) => n.close());
    const missed = d.reason === 'cancelled' || d.reason === 'no-answer';
    if (ring && missed) {
      return self.registration.showNotification('Missed call', {
        body: 'From ' + (ring.data.name || 'a colleague'),
        tag,
        silent: true,
        icon: 'favicon.ico',
        data: { kind: 'missed', callId: d.callId },
      });
    }
  }
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();
  if (data.kind === 'chat' && typeof data.conversationId === 'string' && UUID.test(data.conversationId)) {
    event.waitUntil(onChatClick(event, data));
    return;
  }
  const callId = typeof data.callId === 'string' && CALL_ID.test(data.callId) ? data.callId : null;
  if (!callId) return;

  const action = data.kind === 'missed' ? 'open'
    : event.action === 'decline' ? 'decline'
    : event.action === 'answer' ? 'answer'
    : 'show';

  event.waitUntil((async () => {
    const open = await windows();
    const tab = open.find((c) => 'focus' in c);
    if (action === 'open') {
      if (tab) return tab.focus();
      return self.clients.openWindow('./messages');
    }
    if (tab) {
      if (action !== 'decline') await tab.focus();
      tab.postMessage({ type: 'pf-call', action, callId });
      return;
    }
    // No tab: open the app with the choice; it signs in, connects and
    // answers / declines / shows the ring (the server keeps it ~60 s).
    return self.clients.openWindow('./?pfCall=' + action + ':' + encodeURIComponent(callId));
  })());
});
