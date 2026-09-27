package health.prefrontal.lab.calls;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import health.prefrontal.lab.MainActivity;
import health.prefrontal.lab.R;

/**
 * Ongoing-call foreground service (ported from the Cortex app).
 *
 * WHY: Android delivers SILENCE from the microphone to a process with no
 * visible activity unless a foreground service of type "microphone" runs —
 * Android 14 hard-enforces the declared type. Without it, answering from the
 * lockscreen and then locking again (or switching apps) muted the call for
 * the far side, permanently. Started when a call goes active, stopped on
 * teardown (CallRingPlugin, driven by call-push.service). The notification
 * doubles as the "return to call" affordance.
 */
public class CallService extends Service {

    public static final String CHANNEL_ID = "pf_ongoing_call";
    private static final int NOTIF_ID = 7302;

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, CallService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, CallService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel();
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Call in progress")
                .setContentText("Tap to return to the call")
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(getColor(R.color.notification_accent))
                .setContentIntent(pi)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                // Android 14+: the type MUST be passed or startForeground throws.
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (RuntimeException e) {
            // Mic permission not granted / background-start restriction — never
            // crash the app over the keep-alive; the call still works foregrounded.
            stopSelf();
        }
        return START_NOT_STICKY; // a killed call shouldn't resurrect itself
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Ongoing calls", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Keeps a call running while Prefrontal is in the background.");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
