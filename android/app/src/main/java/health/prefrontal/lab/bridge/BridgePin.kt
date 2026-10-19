package health.prefrontal.lab.bridge

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.X509TrustManager

/**
 * The Bridge TLS pin (bridge-api v1, B.0 `fp`): Crockford base32 of the first
 * 10 bytes of SHA-256(leaf SubjectPublicKeyInfo DER) → 16 characters.
 * Shared vector: Crockford(first 10 bytes of SHA-256("x")) = "5NRHCGNQ4TR480B2".
 * Pure JVM code (no Android types) so it runs in a plain JUnit test.
 */
object BridgePin {
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    fun crockford(bytes: ByteArray): String {
        val out = StringBuilder()
        var value = 0
        var bits = 0
        for (b in bytes) {
            value = (value shl 8) or (b.toInt() and 0xff)
            bits += 8
            while (bits >= 5) {
                out.append(ALPHABET[(value ushr (bits - 5)) and 31])
                bits -= 5
            }
            value = value and ((1 shl bits) - 1)
        }
        if (bits > 0) out.append(ALPHABET[(value shl (5 - bits)) and 31])
        return out.toString()
    }

    /** B.0 human-input normalisation: upper-case, drop "-"/spaces, O→0, I/L→1. */
    fun normalize(s: String?): String =
        (s ?: "").uppercase().replace(Regex("[\\s-]"), "").replace('O', '0').replace('I', '1').replace('L', '1')

    fun pinOfBytes(bytes: ByteArray): String =
        crockford(MessageDigest.getInstance("SHA-256").digest(bytes).copyOfRange(0, 10))

    /** PublicKey.getEncoded() is the X.509 SubjectPublicKeyInfo DER. */
    fun pinOf(cert: X509Certificate): String = pinOfBytes(cert.publicKey.encoded)

    fun isValidPin(pin: String): Boolean = Regex("^[0-9A-HJKMNP-TV-Z]{16}$").matches(pin)

    /**
     * Accepts ONLY a leaf whose SPKI pin equals [pin]; no CA chain, no hostname
     * (the Bridge cert is self-signed, CN = serial). [onMismatch] lets the
     * caller report `pin_mismatch` instead of a generic handshake error.
     */
    class PinnedTrustManager(private val pin: String, private val onMismatch: () -> Unit = {}) : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            throw CertificateException("client certificates are not used")
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val leaf = chain?.firstOrNull() ?: run { onMismatch(); throw CertificateException("pin_mismatch: no certificate") }
            if (pinOf(leaf) != pin) { onMismatch(); throw CertificateException("pin_mismatch") }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}
