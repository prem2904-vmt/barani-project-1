package health.prefrontal.lab.chat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for the reply-from-notification credentials: the web app hands
 * over the device-bound reply token after registering this device for push
 * (setCredentials) and wipes it on logout / account switch (clear). status()
 * never returns the token itself.
 */
@CapacitorPlugin(name = "PfChatReply")
public class PfChatReplyPlugin extends Plugin {

    @PluginMethod
    public void setCredentials(PluginCall call) {
        String apiUrl = call.getString("apiUrl");
        String token = call.getString("token");
        Double expiresAt = call.getDouble("expiresAt");
        if (apiUrl == null || token == null || token.isEmpty() || expiresAt == null) {
            call.reject("apiUrl, token and expiresAt are required");
            return;
        }
        boolean ok = ChatReplyStore.save(getContext(), apiUrl, token, expiresAt.longValue(), call.getString("userId"));
        if (ok) call.resolve(); else call.reject("secure storage write failed");
    }

    @PluginMethod
    public void clear(PluginCall call) {
        ChatReplyStore.clear(getContext());
        call.resolve();
    }

    /** The user opened this conversation in the app — its notification is stale. */
    @PluginMethod
    public void dismissConversation(PluginCall call) {
        String conv = call.getString("conversationId");
        if (ChatNotifications.isUuid(conv)) ChatNotifications.dismiss(getContext(), conv);
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        ChatReplyStore.Credentials c = ChatReplyStore.load(getContext());
        JSObject ret = new JSObject();
        ret.put("stored", c != null);
        ret.put("userId", c != null ? ChatReplyStore.userId(getContext()) : null);
        ret.put("expiresAt", c != null ? c.expiresAtMs : 0);
        call.resolve(ret);
    }
}
