package health.prefrontal.lab.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;
import java.util.Map;
import java.util.UUID;

import health.prefrontal.lab.MainActivity;
import health.prefrontal.lab.R;

/**
 * Native chat notifications, rendered from the backend's DATA message
 * ({ kind: "chat-message", conversationId, messageId, fromUserId, senderName,
 * groupName, title, body, sentAt }) so they work with the app killed:
 *   • MessagingStyle, one notification per conversation (tag = conversation
 *     id) that accumulates its messages, bundled under one group summary;
 *   • "Reply" (RemoteInput) and "Mark as read" → ChatReplyReceiver, which
 *     POSTs natively with the reply token — the app UI never opens;
 *   • tap → the app on that conversation (prefrontal-chat://open?c=…, taken
 *     by the App plugin's appUrlOpen / getLaunchUrl);
 *   • lock screen: VISIBILITY_PRIVATE with a "New message" public version, so
 *     "hide sensitive content" hides the preview.
 */
public final class ChatNotifications {
    public static final String CHANNEL_ID = "pf_chat";
    public static final String OPEN_SCHEME = "prefrontal-chat";
    static final String GROUP = "pf_chat_group";
    static final int CHAT_ID = 7401;
    static final int SUMMARY_ID = 7400;
    static final int FAILED_ID = 7402;
    static final String EXTRA_LAST_MSG = "pf_last_message_id";

    private ChatNotifications() { }

    /** A chat data message → post / extend that conversation's notification. */
    public static void show(Context ctx, Map<String, String> d) {
        String conv = d.get("conversationId");
        if (!isUuid(conv)) return;
        String msgId = d.get("messageId");
        String sender = nonEmpty(d.get("senderName"), "Someone");
        String group = d.get("groupName");
        boolean isGroup = group != null && !group.isEmpty();
        String body = nonEmpty(d.get("body"), "New message");
        long when = parseTime(d.get("sentAt"));

        ensureChannel(ctx);
        NotificationCompat.MessagingStyle style = existingStyle(ctx, conv);
        if (style != null && msgId != null && msgId.equals(lastMessageId(ctx, conv))) return; // FCM re-delivery
        if (style == null) style = new NotificationCompat.MessagingStyle(me());
        if (isGroup) { style.setConversationTitle(group); style.setGroupConversation(true); }
        Person from = new Person.Builder().setName(sender).setKey(nonEmpty(d.get("fromUserId"), sender)).build();
        style.addMessage(body, when, from);

        NotificationCompat.Builder b = base(ctx, conv, style, isGroup ? group : sender)
            .setOnlyAlertOnce(false)
            .addAction(replyAction(ctx, conv))
            .addAction(markReadAction(ctx, conv));
        b.getExtras().putString(EXTRA_LAST_MSG, msgId);
        notify(ctx, conv, CHAT_ID, b.build());
        postSummary(ctx);
    }

    /** After a successful reply: append it as "me" and keep the actions (Android
     *  requires the notification to be updated or it shows a spinner forever). */
    static void appendMyReply(Context ctx, String conv, String text) {
        NotificationCompat.MessagingStyle style = existingStyle(ctx, conv);
        if (style == null) return;
        if (text != null && !text.isEmpty()) style.addMessage(text, System.currentTimeMillis(), (Person) null);
        CharSequence title = style.getConversationTitle() != null ? style.getConversationTitle() : "Messages";
        NotificationCompat.Builder b = base(ctx, conv, style, title)
            .setOnlyAlertOnce(true)
            .addAction(replyAction(ctx, conv))
            .addAction(markReadAction(ctx, conv));
        b.getExtras().putString(EXTRA_LAST_MSG, lastMessageId(ctx, conv));
        notify(ctx, conv, CHAT_ID, b.build());
    }

    /** Reply couldn't go out: say so, tap opens the conversation. */
    static void replyFailed(Context ctx, String conv, String text) {
        ensureChannel(ctx);
        // Clear the reply spinner on the original notification.
        NotificationCompat.MessagingStyle style = existingStyle(ctx, conv);
        if (style != null) {
            CharSequence title = style.getConversationTitle() != null ? style.getConversationTitle() : "Messages";
            NotificationCompat.Builder b = base(ctx, conv, style, title).setOnlyAlertOnce(true)
                .addAction(replyAction(ctx, conv)).addAction(markReadAction(ctx, conv));
            b.getExtras().putString(EXTRA_LAST_MSG, lastMessageId(ctx, conv));
            notify(ctx, conv, CHAT_ID, b.build());
        }
        String snippet = text.length() > 60 ? text.substring(0, 60) + "…" : text;
        NotificationCompat.Builder f = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ctx.getColor(R.color.notification_accent))
            .setContentTitle("Couldn't send your reply")
            .setContentText("“" + snippet + "” — tap to open the conversation.")
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(ctx, "Couldn't send your reply"))
            .setAutoCancel(true)
            .setContentIntent(openIntent(ctx, conv, 3));
        notify(ctx, conv, FAILED_ID, f.build());
    }

    /** Mark as read (or the thread was opened elsewhere): drop the notification. */
    static void dismiss(Context ctx, String conv) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(conv, CHAT_ID);
        postSummary(ctx);
    }

    // ── building blocks ─────────────────────────────────────────────

    private static NotificationCompat.Builder base(Context ctx, String conv,
                                                   NotificationCompat.MessagingStyle style, CharSequence title) {
        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ctx.getColor(R.color.notification_accent))
            .setStyle(style)
            .setContentTitle(title)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(ctx, "New message"))
            .setGroup(GROUP)
            .setAutoCancel(true)
            .setContentIntent(openIntent(ctx, conv, 1));
    }

    private static Notification publicVersion(Context ctx, String text) {
        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ctx.getColor(R.color.notification_accent))
            .setContentTitle("Prefrontal")
            .setContentText(text)
            .build();
    }

    private static void postSummary(Context ctx) {
        int open = 0;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) {
            for (StatusBarNotification s : nm.getActiveNotifications())
                if (s.getId() == CHAT_ID) open++;
        }
        NotificationManagerCompat compat = NotificationManagerCompat.from(ctx);
        if (open == 0) { compat.cancel(SUMMARY_ID); return; }
        Notification summary = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ctx.getColor(R.color.notification_accent))
            .setContentTitle("Messages")
            .setContentText(open == 1 ? "1 conversation" : open + " conversations")
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setAutoCancel(true)
            .build();
        notify(ctx, null, SUMMARY_ID, summary);
    }

    private static NotificationCompat.Action replyAction(Context ctx, String conv) {
        RemoteInput input = new RemoteInput.Builder(ChatReplyReceiver.KEY_TEXT).setLabel("Message").build();
        Intent i = new Intent(ctx, ChatReplyReceiver.class)
            .setAction(ChatReplyReceiver.ACTION_REPLY)
            .putExtra(ChatReplyReceiver.EXTRA_CONV, conv);
        // RemoteInput needs a MUTABLE PendingIntent (the system writes the text into it).
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, requestCode(10, conv), i, flags);
        return new NotificationCompat.Action.Builder(0, "Reply", pi)
            .addRemoteInput(input)
            .setAllowGeneratedReplies(false)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build();
    }

    private static NotificationCompat.Action markReadAction(Context ctx, String conv) {
        Intent i = new Intent(ctx, ChatReplyReceiver.class)
            .setAction(ChatReplyReceiver.ACTION_MARK_READ)
            .putExtra(ChatReplyReceiver.EXTRA_CONV, conv);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, requestCode(11, conv), i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Action.Builder(0, "Mark as read", pi)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build();
    }

    /** Explicit VIEW intent into MainActivity (no intent-filter → no other app can fire it). */
    static PendingIntent openIntent(Context ctx, String conv, int kind) {
        Uri uri = new Uri.Builder().scheme(OPEN_SCHEME).authority("open").appendQueryParameter("c", conv).build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri)
            .setClass(ctx, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode(kind, conv), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static NotificationCompat.MessagingStyle existingStyle(Context ctx, String conv) {
        Notification n = active(ctx, conv);
        return n == null ? null : NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n);
    }

    private static String lastMessageId(Context ctx, String conv) {
        Notification n = active(ctx, conv);
        return n == null ? null : n.extras.getString(EXTRA_LAST_MSG);
    }

    private static Notification active(Context ctx, String conv) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return null;
        for (StatusBarNotification s : nm.getActiveNotifications())
            if (s.getId() == CHAT_ID && conv.equals(s.getTag())) return s.getNotification();
        return null;
    }

    private static Person me() {
        return new Person.Builder().setName("You").setKey("me").build();
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Chat messages", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Messages from colleagues — reply right from the notification");
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        ch.enableVibration(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
    }

    private static void notify(Context ctx, String tag, int id, Notification n) {
        try { NotificationManagerCompat.from(ctx).notify(tag, id, n); }
        catch (SecurityException ignored) { /* POST_NOTIFICATIONS not granted */ }
    }

    static boolean isUuid(String s) {
        if (s == null) return false;
        try { UUID.fromString(s); return true; } catch (IllegalArgumentException e) { return false; }
    }

    private static int requestCode(int kind, String conv) {
        return kind * 100_000 + (conv.hashCode() & 0xFFFF);
    }

    private static long parseTime(String iso) {
        if (iso == null) return System.currentTimeMillis();
        // ISO-8601 UTC from the server ("2026-09-28T10:11:12.1234567Z") — the
        // seconds are plenty for a notification timestamp (API 24: no java.time).
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            java.util.Date d = f.parse(iso.length() >= 19 ? iso.substring(0, 19) : iso);
            return d != null ? d.getTime() : System.currentTimeMillis();
        } catch (Exception e) { return System.currentTimeMillis(); }
    }

    private static String nonEmpty(String s, String fallback) {
        return s == null || s.trim().isEmpty() ? fallback : s;
    }
}
