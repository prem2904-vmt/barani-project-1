package health.prefrontal.lab.chat;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

/**
 * The reply-from-notification credentials: the backend's device-bound REPLY
 * TOKEN (not the session — see ChatReplyTokens on the server), the API base
 * URL and its expiry. Stored ONLY in EncryptedSharedPreferences (AES-256,
 * master key in the Android Keystore), excluded from backup / device transfer
 * (res/xml/backup_rules.xml, data_extraction_rules.xml), written by the web
 * app through PfChatReplyPlugin after it registers this device for push, and
 * cleared on logout / account switch. Never logged.
 */
public final class ChatReplyStore {
    static final String FILE = "pf_chat_reply";
    private static final String K_API = "apiUrl";
    private static final String K_TOKEN = "token";
    private static final String K_EXPIRES = "expiresAt";
    private static final String K_USER = "userId";

    public static final class Credentials {
        public final String apiUrl;
        public final String token;
        public final long expiresAtMs;
        Credentials(String apiUrl, String token, long expiresAtMs) {
            this.apiUrl = apiUrl; this.token = token; this.expiresAtMs = expiresAtMs;
        }
        public boolean expired() { return expiresAtMs <= System.currentTimeMillis(); }
    }

    private ChatReplyStore() { }

    private static SharedPreferences prefs(Context ctx) throws Exception {
        Context app = ctx.getApplicationContext();
        MasterKey key = new MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
        return EncryptedSharedPreferences.create(app, FILE, key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
    }

    public static synchronized boolean save(Context ctx, String apiUrl, String token, long expiresAtMs, String userId) {
        try {
            prefs(ctx).edit()
                .putString(K_API, apiUrl)
                .putString(K_TOKEN, token)
                .putLong(K_EXPIRES, expiresAtMs)
                .putString(K_USER, userId)
                .commit();
            return true;
        } catch (Exception e) {
            wipe(ctx);
            return false;
        }
    }

    /** Null when nothing usable is stored (or the file can't be decrypted). */
    public static synchronized Credentials load(Context ctx) {
        try {
            SharedPreferences p = prefs(ctx);
            String api = p.getString(K_API, null);
            String token = p.getString(K_TOKEN, null);
            if (api == null || token == null || token.isEmpty()) return null;
            return new Credentials(api, token, p.getLong(K_EXPIRES, 0L));
        } catch (Exception e) {
            // Keystore key gone (restore onto a new device, OS reset) — start clean.
            wipe(ctx);
            return null;
        }
    }

    public static synchronized String userId(Context ctx) {
        try { return prefs(ctx).getString(K_USER, null); } catch (Exception e) { return null; }
    }

    public static synchronized void clear(Context ctx) {
        try { prefs(ctx).edit().clear().commit(); } catch (Exception e) { wipe(ctx); }
    }

    /** Last resort: drop the encrypted file itself. */
    private static void wipe(Context ctx) {
        try { ctx.getApplicationContext().deleteSharedPreferences(FILE); } catch (Exception ignored) { }
    }
}
