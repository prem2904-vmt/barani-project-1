package health.prefrontal.lab.chat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * "Reply" / "Mark as read" on a chat notification — handled here, natively,
 * WITHOUT opening the app: POST /api/chat/push-reply/{messages|read} with the
 * device-bound reply token from {@link ChatReplyStore}. goAsync() keeps the
 * receiver alive for the round trip on a worker thread (a single retry for a
 * transient failure, same client message id → never a double send). Success
 * updates the notification with the sent reply; failure (no / expired /
 * revoked token, offline) posts "Couldn't send — tap to open". Nothing about
 * the token or the message is logged.
 */
public class ChatReplyReceiver extends BroadcastReceiver {
    public static final String ACTION_REPLY = "health.prefrontal.lab.chat.REPLY";
    public static final String ACTION_MARK_READ = "health.prefrontal.lab.chat.MARK_READ";
    public static final String EXTRA_CONV = "conversationId";
    public static final String KEY_TEXT = "pf_reply_text";

    private static final int CONNECT_MS = 5_000;
    private static final int READ_MS = 8_000;

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context ctx = context.getApplicationContext();
        final String action = intent.getAction();
        final String conv = intent.getStringExtra(EXTRA_CONV);
        if (!ChatNotifications.isUuid(conv)) return;

        if (ACTION_MARK_READ.equals(action)) {
            ChatNotifications.dismiss(ctx, conv);
            final PendingResult pr = goAsync();
            new Thread(() -> {
                try { post(ctx, "read", readBody(conv), 0); } finally { pr.finish(); }
            }, "pf-chat-read").start();
            return;
        }
        if (!ACTION_REPLY.equals(action)) return;

        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence cs = results != null ? results.getCharSequence(KEY_TEXT) : null;
        final String text = cs == null ? "" : cs.toString().trim();
        if (text.isEmpty()) { ChatNotifications.appendMyReply(ctx, conv, ""); return; }

        final String clientMessageId = "and-" + UUID.randomUUID().toString().replace("-", "");
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                Result r = post(ctx, "messages", replyBody(conv, text, clientMessageId), 1);
                if (r == Result.OK) ChatNotifications.appendMyReply(ctx, conv, text);
                else ChatNotifications.replyFailed(ctx, conv, text);
            } finally {
                pr.finish();
            }
        }, "pf-chat-reply").start();
    }

    enum Result { OK, SIGNED_OUT, FAILED }

    static Result post(Context ctx, String path, String json, int retries) {
        ChatReplyStore.Credentials c = ChatReplyStore.load(ctx);
        if (c == null || c.expired()) return Result.SIGNED_OUT;
        for (int attempt = 0; ; attempt++) {
            int status = send(c, path, json);
            if (status >= 200 && status < 300) return Result.OK;
            if (status == 401) {
                // Revoked / expired server-side — the app re-issues on next open.
                ChatReplyStore.clear(ctx);
                return Result.SIGNED_OUT;
            }
            boolean transient_ = status <= 0 || status == 429 || status >= 500;
            if (!transient_ || attempt >= retries) return Result.FAILED;
            try { Thread.sleep(1_000); } catch (InterruptedException e) { return Result.FAILED; }
        }
    }

    /** HTTP status, or -1 on a network error. */
    private static int send(ChatReplyStore.Credentials c, String path, String json) {
        HttpURLConnection con = null;
        try {
            String base = c.apiUrl.endsWith("/") ? c.apiUrl.substring(0, c.apiUrl.length() - 1) : c.apiUrl;
            URL url = new URL(base + "/api/chat/push-reply/" + path);
            if (!"https".equals(url.getProtocol()) && !"localhost".equals(url.getHost())) return 0;
            con = (HttpURLConnection) url.openConnection();
            con.setConnectTimeout(CONNECT_MS);
            con.setReadTimeout(READ_MS);
            con.setRequestMethod("POST");
            con.setDoOutput(true);
            con.setUseCaches(false);
            con.setRequestProperty("Content-Type", "application/json");
            con.setRequestProperty("X-Push-Reply-Token", c.token);
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            con.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = con.getOutputStream()) { os.write(bytes); }
            return con.getResponseCode();
        } catch (Exception e) {
            return -1;
        } finally {
            if (con != null) con.disconnect();
        }
    }

    private static String replyBody(String conv, String text, String clientMessageId) {
        try {
            return new JSONObject()
                .put("conversationId", conv)
                .put("body", text)
                .put("clientMessageId", clientMessageId)
                .toString();
        } catch (Exception e) { return "{}"; }
    }

    private static String readBody(String conv) {
        try { return new JSONObject().put("conversationId", conv).toString(); }
        catch (Exception e) { return "{}"; }
    }
}
