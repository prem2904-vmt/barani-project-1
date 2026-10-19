package health.prefrontal.lab.calls;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for the Android call plumbing (call-push.service.ts):
 *   cancelRing({ callId })  — dismiss the full-screen ring notification once
 *                             the in-app ring was answered / declined / ended;
 *   startCallService()      — ongoing-call foreground service (keeps the mic
 *   stopCallService()         live while backgrounded / locked; stop also
 *                             drops the show-over-lockscreen flags).
 * Every method resolves even on failure — call plumbing must never break a call.
 */
@CapacitorPlugin(name = "CallRing")
public class CallRingPlugin extends Plugin {

    @PluginMethod
    public void cancelRing(PluginCall call) {
        try {
            PrefrontalMessagingService.cancelCallNotification(getContext(), call.getString("callId"));
        } catch (Exception ignored) { }
        call.resolve();
    }

    @PluginMethod
    public void startCallService(PluginCall call) {
        try { CallService.start(getContext()); } catch (Exception ignored) { }
        call.resolve();
    }

    /** Call over: stop the service and drop the show-over-lockscreen flags a
     *  ring intent set (the app must not keep appearing over the keyguard). */
    @PluginMethod
    public void stopCallService(PluginCall call) {
        try { CallService.stop(getContext()); } catch (Exception ignored) { }
        try {
            if (getActivity() != null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
                getActivity().runOnUiThread(() -> {
                    getActivity().setShowWhenLocked(false);
                    getActivity().setTurnScreenOn(false);
                });
            }
        } catch (Exception ignored) { }
        call.resolve();
    }
}
