package health.prefrontal.lab.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.MessageDigest

/** Shared vectors from bridge-api v1 (B.0) + the TXT map (B.5). */
class BridgeNativeTest {
    @Test
    fun crockfordVectorMatchesTheContract() {
        val digest = MessageDigest.getInstance("SHA-256").digest("x".toByteArray())
        assertEquals("5NRHCGNQ4TR480B2", BridgePin.crockford(digest.copyOfRange(0, 10)))
        assertEquals("5NRHCGNQ4TR480B2", BridgePin.pinOfBytes("x".toByteArray()))
    }

    @Test
    fun pinNormalisation() {
        assertEquals("5NRHCGNQ4TR480B2", BridgePin.normalize("5nrh-cgnq 4tr4-8ob2"))
        assertTrue(BridgePin.isValidPin("5NRHCGNQ4TR480B2"))
        assertFalse(BridgePin.isValidPin("5NRHCGNQ4TR480BU"))
        assertFalse(BridgePin.isValidPin("SHORT"))
    }

    @Test
    fun spkiPinOfAP256KeyIsSixteenCrockford() {
        val kp = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        val pin = BridgePin.pinOfBytes(kp.public.encoded)
        assertEquals(16, pin.length)
        assertTrue(BridgePin.isValidPin(pin))
    }

    @Test
    fun txtMapLowercasesKeysAndDecodesUtf8() {
        val m = BridgeTxt.toMap(mapOf(
            "V" to "1".toByteArray(), "sn" to "10000000ABCD1234".toByteArray(), "cs" to "u".toByteArray(),
            "fp" to "5NRHCGNQ4TR480B2".toByteArray(), "flag" to null,
        ))
        assertEquals(mapOf("v" to "1", "sn" to "10000000ABCD1234", "cs" to "u", "fp" to "5NRHCGNQ4TR480B2", "flag" to ""), m)
        assertEquals(emptyMap<String, String>(), BridgeTxt.toMap(null))
    }

    @Test
    fun ipv4Literals() {
        assertTrue(BridgeTxt.isIpv4("10.42.0.1"))
        assertTrue(BridgeTxt.isIpv4("192.168.1.23"))
        assertFalse(BridgeTxt.isIpv4("fe80::1"))
        assertFalse(BridgeTxt.isIpv4("256.1.1.1"))
        assertFalse(BridgeTxt.isIpv4("bridge.local"))
    }
}
