package health.prefrontal.lab.calls;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.text.Spannable;
import android.text.SpannableString;
import android.text.style.ForegroundColorSpan;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

import health.prefrontal.lab.MainActivity;
import health.prefrontal.lab.R;

/**
 * FCM entry point that adds a native incoming-call ringer on top of the
 * Capacitor push plugin (which has no concept of calls). Ported from the
 * Cortex app's proven CortexMessagingService. The backend sends DATA-ONLY,
 * high-priority messages (TTL 60 s) so nothing is auto-rendered and they
 * reach a killed / dozing app:
 *
 *   { kind: "call-incoming", callId, fromName, callType }
 *     → full-screen, INSISTENT (loops the ringtone), ongoing CATEGORY_CALL
 *       notification with Answer / Decline, auto-timeout 60 s
 *   { kind: "call-end", callId, reason }
 *     → cancel that call's notification (caller cancelled, answered or
 *       declined on another device, no answer)
 *
 * While the app is in the FOREGROUND the ring is handed to JS instead (the
 * in-app ring card already shows via the live socket; a system ringer on top
 * would be a duplicate). Answer / Decline / tap are explicit intents into
 * MainActivity carrying prefrontal-call://{answer|decline|show}?callId=… —
 * the Angular app picks them up through the App plugin's appUrlOpen. No
 * intent-filter is registered for the scheme, so other apps can't fire it.
 * Every other message goes to the plugin's MessagingService unchanged.
 */
public class PrefrontalMessagingService extends MessagingService {

    public static final String CALL_CHANNEL_ID = "pf_calls";
    /** Notification id; the per-call tag (the call id) makes each ring unique. */
    public static final int CALL_NOTIFICATION_ID = 7301;
    public static final String CALL_SCHEME = "prefrontal-call";
    private static final long RING_TIMEOUT_MS = 60_000L;
    private static final int ANSWER_COLOR = Color.parseColor("#16A34A");
    private static final int DECLINE_COLOR = Color.parseColor("#DC2626");

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String kind = data.get("kind");
        if ("call-end".equals(kind)) {
            cancelCallNotification(this, data.get("callId"));
            super.onMessageReceived(remoteMessage); // JS (if alive) drops its ring too
            return;
        }
        if ("call-incoming".equals(kind) && !MainActivity.isInForeground()) {
            showCallNotification(data);
            return;
        }
        super.onMessageReceived(remoteMessage); // regular pushes + foreground ring → JS
    }

    private void showCallNotification(Map<String, String> data) {
        String callId = data.get("callId");
        if (callId == null || callId.isEmpty()) return;
        String fromName = data.get("fromName");
        if (fromName == null || fromName.isEmpty()) fromName = "A colleague";

        ensureCallChannel(this);

        // Full-screen intent: takes over the lockscreen / turned-off screen with
        // the app's own ring card (it MUST carry the call id — a plain launch
        // left the app with zero call context).
        PendingIntent showPi = callIntent(this, 1, "show", callId);
        PendingIntent answerPi = callIntent(this, 2, "answer", callId);
        PendingIntent declinePi = callIntent(this, 3, "decline", callId);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(getColor(R.color.notification_accent))
            .setContentTitle("Incoming call")
            .setContentText(fromName + " is calling")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(RING_TIMEOUT_MS)
            .setFullScreenIntent(showPi, true)
            .setContentIntent(showPi)
            // Pre-O fallbacks — O+ takes sound/vibration from the channel.
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
            .setVibrate(new long[] { 0, 1000, 800, 1000, 800 })
            .addAction(0, colored("Decline", DECLINE_COLOR), declinePi)
            .addAction(0, colored("Answer", ANSWER_COLOR), answerPi);

        Notification n = b.build();
        // Loop the ringtone until answered / declined / cancelled / timed out —
        // a single ring blip is not a phone call.
        n.flags |= Notification.FLAG_INSISTENT;
        try {
            NotificationManagerCompat.from(this).notify(callId, CALL_NOTIFICATION_ID, n);
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted — nothing we can show.
        }
    }

    /** Dismiss the ring for this call (tag = call id). Safe if not showing. */
    public static void cancelCallNotification(Context ctx, String callId) {
        if (callId == null || callId.isEmpty()) return;
        NotificationManagerCompat.from(ctx).cancel(callId, CALL_NOTIFICATION_ID);
    }

    /** Explicit VIEW intent into MainActivity (no intent-filter needed). */
    static PendingIntent callIntent(Context ctx, int requestCode, String action, String callId) {
        Uri uri = new Uri.Builder().scheme(CALL_SCHEME).authority(action)
            .appendQueryParameter("callId", callId).build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri)
            .setClass(ctx, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // Unique request code per call + action so extras never collide.
        int rc = requestCode * 100_000 + (callId.hashCode() & 0xFFFF);
        return PendingIntent.getActivity(ctx, rc, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void ensureCallChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = ctx.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CALL_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CALL_CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Rings for incoming Prefrontal voice calls");
        channel.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 1000, 800, 1000, 800 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        // Honoured only once the user grants notification-policy access; the
        // call still rings normally when they haven't.
        try { channel.setBypassDnd(true); } catch (SecurityException ignored) { }
        manager.createNotificationChannel(channel);
    }

    private static CharSequence colored(String label, int color) {
        SpannableString s = new SpannableString(label);
        s.setSpan(new ForegroundColorSpan(color), 0, s.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }
}
