package health.prefrontal.lab;

import android.app.KeyguardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import health.prefrontal.lab.calls.CallRingPlugin;
import health.prefrontal.lab.calls.PrefrontalMessagingService;
import health.prefrontal.lab.chat.PfChatReplyPlugin;
import health.prefrontal.lab.printer.PrefrontalPrinterPlugin;

public class MainActivity extends BridgeActivity {

    /** Read by PrefrontalMessagingService: a ring for a foreground app goes to
     *  JS (the in-app ring card) instead of a duplicate system ringer. */
    private static volatile boolean inForeground = false;

    public static boolean isInForeground() { return inForeground; }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local Capacitor plugins must be registered before the bridge
        // starts so the WebView can see them.
        registerPlugin(PrefrontalPrinterPlugin.class);
        registerPlugin(CallRingPlugin.class);
        registerPlugin(PfChatReplyPlugin.class);
        handleCallIntent(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        handleCallIntent(intent);
        super.onNewIntent(intent); // → App plugin appUrlOpen → call-push.service
    }

    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
    }

    @Override
    public void onPause() {
        inForeground = false;
        super.onPause();
    }

    /** A prefrontal-call://{show|answer|decline}?callId= intent from the ring
     *  notification: show over the lockscreen and wake the screen (only for a
     *  call — never for ordinary launches), and stop the native ringtone when
     *  the user already chose Answer / Decline. */
    private void handleCallIntent(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data == null || !PrefrontalMessagingService.CALL_SCHEME.equals(data.getScheme())) return;
        String action = data.getHost();
        String callId = data.getQueryParameter("callId");
        if ("answer".equals(action) || "decline".equals(action)) {
            PrefrontalMessagingService.cancelCallNotification(this, callId);
        }
        if (!"decline".equals(action) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            if ("answer".equals(action)) {
                KeyguardManager km = getSystemService(KeyguardManager.class);
                if (km != null) km.requestDismissKeyguard(this, null);
            }
        }
    }
}
