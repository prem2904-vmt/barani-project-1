package health.prefrontal.lab.bridge

/**
 * mDNS TXT record → { key: value } for the JS side (bridge-api v1, B.5:
 * v / sn / cs / ver / fp / ip / md). Keys are lower-cased; values are UTF-8.
 * NsdServiceInfo.getAttributes() gives Map<String, ByteArray?>; pure so the
 * JUnit test needs no Android framework.
 */
object BridgeTxt {
    const val SERVICE_TYPE = "_prefrontal-bridge._tcp."

    fun toMap(attrs: Map<String, ByteArray?>?): Map<String, String> {
        if (attrs == null) return emptyMap()
        val out = LinkedHashMap<String, String>()
        for ((k, v) in attrs) {
            val key = k.trim().lowercase()
            if (key.isEmpty() || key.length > 32) continue
            out[key] = if (v == null) "" else String(v, Charsets.UTF_8).take(255)
        }
        return out
    }

    /** Only IPv4 literals are reachable from the WebView side. */
    fun isIpv4(s: String?): Boolean {
        if (s == null) return false
        val parts = s.split('.')
        return parts.size == 4 && parts.all { p -> p.isNotEmpty() && p.length <= 3 && p.all(Char::isDigit) && p.toInt() in 0..255 }
    }
}
