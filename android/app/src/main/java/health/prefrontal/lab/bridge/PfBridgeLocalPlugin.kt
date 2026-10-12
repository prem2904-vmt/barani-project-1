package health.prefrontal.lab.bridge

import android.Manifest
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.InputStream
import java.net.Inet4Address
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext

/**
 * PfBridgeLocal — reach a Prefrontal Bridge on the local network
 * (bridge-api v1, B.3 / B.5). A transport only; every rule lives in TS
 * (shared/bridges/bridge-local.service.ts).
 *
 *  - startDiscovery / stopDiscovery: NsdManager browse of
 *    `_prefrontal-bridge._tcp`. Before API 34 resolves are SERIAL (the old
 *    NsdManager allows one at a time); on 34+ registerServiceInfoCallback.
 *    Emits `bridgeFound` / `bridgeLost` { name, host, port, txt, addresses }.
 *  - joinHotspot / leaveHotspot: WifiNetworkSpecifier + requestNetwork (API
 *    29+); the system shows its "Connect to device" sheet every time. The
 *    Network is kept so `request(viaHotspot)` binds to it — the rest of the
 *    phone keeps its normal (internet) route.
 *  - request: HTTPS only, a TrustManager that accepts ONLY the leaf whose SPKI
 *    pin equals `pinFingerprint`, and a pin-only hostname verifier.
 */
@CapacitorPlugin(
    name = "PfBridgeLocal",
    permissions = [
        Permission(strings = [Manifest.permission.NEARBY_WIFI_DEVICES], alias = "nearby"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
    ],
)
class PfBridgeLocalPlugin : Plugin() {
    private val io: Executor = Executors.newCachedThreadPool()
    private val main = Handler(Looper.getMainLooper())

    private var nsd: NsdManager? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private val infoCallbacks = HashMap<String, NsdManager.ServiceInfoCallback>()

    private var hotspotNetwork: Network? = null
    private var hotspotCallback: ConnectivityManager.NetworkCallback? = null

    private fun cm(): ConnectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    @PluginMethod
    fun capabilities(call: PluginCall) {
        call.resolve(JSObject().put("discovery", true).put("hotspot", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q))
    }

    // ── Discovery ────────────────────────────────────────────────────────

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        if (discoveryListener != null) { call.resolve(); return }
        val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        nsd = manager
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { discoveryListener = null }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceFound(info: NsdServiceInfo) { main.post { resolve(info) } }
            override fun onServiceLost(info: NsdServiceInfo) {
                main.post {
                    if (Build.VERSION.SDK_INT >= 34) infoCallbacks.remove(info.serviceName)?.let { runCatching { manager.unregisterServiceInfoCallback(it) } }
                    notifyListeners("bridgeLost", JSObject().put("name", info.serviceName).put("txt", JSObject()).put("addresses", JSArray()))
                }
            }
        }
        discoveryListener = listener
        try {
            manager.discoverServices(BridgeTxt.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            call.resolve()
        } catch (e: Exception) {
            discoveryListener = null
            call.reject("local_unreachable: ${e.message}", "local_unreachable")
        }
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        val manager = nsd
        discoveryListener?.let { l -> runCatching { manager?.stopServiceDiscovery(l) } }
        discoveryListener = null
        if (Build.VERSION.SDK_INT >= 34) {
            for (cb in infoCallbacks.values) runCatching { manager?.unregisterServiceInfoCallback(cb) }
        }
        infoCallbacks.clear()
        resolveQueue.clear()
        resolving = false
        call.resolve()
    }

    private fun resolve(info: NsdServiceInfo) {
        val manager = nsd ?: return
        if (Build.VERSION.SDK_INT >= 34) {
            if (infoCallbacks.containsKey(info.serviceName)) return
            val cb = object : NsdManager.ServiceInfoCallback {
                override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) { main.post { infoCallbacks.remove(info.serviceName) } }
                override fun onServiceUpdated(si: NsdServiceInfo) { main.post { emitFound(si) } }
                override fun onServiceLost() {
                    main.post { notifyListeners("bridgeLost", JSObject().put("name", info.serviceName).put("txt", JSObject()).put("addresses", JSArray())) }
                }
                override fun onServiceInfoCallbackUnregistered() {}
            }
            infoCallbacks[info.serviceName] = cb
            runCatching { manager.registerServiceInfoCallback(info, io, cb) }.onFailure { infoCallbacks.remove(info.serviceName) }
            return
        }
        // Before API 34 NsdManager resolves one service at a time: queue.
        resolveQueue.addLast(info)
        drainResolves()
    }

    @Suppress("DEPRECATION")
    private fun drainResolves() {
        val manager = nsd ?: return
        if (resolving) return
        val next = resolveQueue.removeFirstOrNull() ?: return
        resolving = true
        manager.resolveService(next, object : NsdManager.ResolveListener {
            override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) { main.post { resolving = false; drainResolves() } }
            override fun onServiceResolved(si: NsdServiceInfo) { main.post { emitFound(si); resolving = false; drainResolves() } }
        })
    }

    @Suppress("DEPRECATION")
    private fun emitFound(si: NsdServiceInfo) {
        if (discoveryListener == null) return
        val addresses = JSArray()
        val hosts = if (Build.VERSION.SDK_INT >= 34) si.hostAddresses else listOfNotNull(si.host)
        for (a in hosts) if (a is Inet4Address) a.hostAddress?.let { addresses.put(it) }
        val txt = JSObject()
        for ((k, v) in BridgeTxt.toMap(si.attributes)) txt.put(k, v)
        val ev = JSObject()
            .put("name", si.serviceName)
            .put("host", hosts.firstOrNull { it is Inet4Address }?.hostAddress)
            .put("port", si.port)
            .put("txt", txt)
            .put("addresses", addresses)
        notifyListeners("bridgeFound", ev)
    }

    // ── Hotspot join (WifiNetworkSpecifier) ──────────────────────────────

    @PluginMethod
    fun joinHotspot(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("hotspot_unavailable", "hotspot_unavailable"); return }
        // Android 13+: NEARBY_WIFI_DEVICES (neverForLocation); 10–12: location.
        val alias = if (Build.VERSION.SDK_INT >= 33) "nearby" else "location"
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "joinAfterPermission")
            return
        }
        doJoin(call)
    }

    @PermissionCallback
    private fun joinAfterPermission(call: PluginCall) {
        val alias = if (Build.VERSION.SDK_INT >= 33) "nearby" else "location"
        if (getPermissionState(alias) != PermissionState.GRANTED) { call.reject("local_permission_denied", "local_permission_denied"); return }
        doJoin(call)
    }

    private fun doJoin(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("hotspot_unavailable", "hotspot_unavailable"); return }
        val ssid = call.getString("ssid")?.takeIf { it.isNotEmpty() && it.length <= 32 }
            ?: run { call.reject("hotspot_join_failed: ssid", "hotspot_join_failed"); return }
        val psk = call.getString("psk") ?: ""
        releaseHotspot()
        val spec = WifiNetworkSpecifier.Builder().setSsid(ssid).apply { if (psk.isNotEmpty()) setWpa2Passphrase(psk) }.build()
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .setNetworkSpecifier(spec)
            .build()
        val done = AtomicBoolean(false)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                hotspotNetwork = network
                if (done.compareAndSet(false, true)) call.resolve(JSObject().put("joined", true))
            }
            override fun onUnavailable() {
                hotspotNetwork = null
                if (done.compareAndSet(false, true)) call.reject("hotspot_join_failed", "hotspot_join_failed")
            }
            override fun onLost(network: Network) { if (hotspotNetwork == network) hotspotNetwork = null }
        }
        hotspotCallback = cb
        try {
            cm().requestNetwork(request, cb, 60_000)
        } catch (e: Exception) {
            hotspotCallback = null
            call.reject("hotspot_join_failed: ${e.message}", "hotspot_join_failed")
        }
    }

    @PluginMethod
    fun leaveHotspot(call: PluginCall) {
        releaseHotspot()
        call.resolve()
    }

    private fun releaseHotspot() {
        hotspotCallback?.let { runCatching { cm().unregisterNetworkCallback(it) } }
        hotspotCallback = null
        hotspotNetwork = null
    }

    // ── Pinned HTTPS ─────────────────────────────────────────────────────

    @PluginMethod
    fun request(call: PluginCall) {
        val url = call.getString("url") ?: run { call.reject("bad_request: url", "bad_request"); return }
        val method = (call.getString("method") ?: "GET").uppercase()
        val body = call.getString("body")
        val pin = BridgePin.normalize(call.getString("pinFingerprint"))
        val viaHotspot = call.getBoolean("viaHotspot", false) == true
        val timeout = (call.getInt("timeoutMs") ?: 10_000).coerceIn(1_000, 30_000)
        if (!url.startsWith("https://") || !BridgePin.isValidPin(pin) || (method != "GET" && method != "POST")) {
            call.reject("bad_request", "bad_request"); return
        }
        io.execute {
            val mismatch = AtomicBoolean(false)
            try {
                val u = URL(url)
                if (!BridgeTxt.isIpv4(u.host) || !u.path.startsWith("/local/v1/")) { call.reject("bad_request", "bad_request"); return@execute }
                val net = if (viaHotspot) hotspotNetwork else null
                if (viaHotspot && net == null) { call.reject("hotspot_join_failed: not joined", "hotspot_join_failed"); return@execute }
                val conn = (net?.openConnection(u) ?: u.openConnection()) as HttpsURLConnection
                val ctx = SSLContext.getInstance("TLS")
                ctx.init(null, arrayOf(BridgePin.PinnedTrustManager(pin) { mismatch.set(true) }), SecureRandom())
                conn.sslSocketFactory = ctx.socketFactory
                // The cert's CN is the serial, not the IP: the pin IS the identity.
                conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, session ->
                    runCatching { BridgePin.pinOf(session.peerCertificates[0] as java.security.cert.X509Certificate) == pin }.getOrDefault(false)
                }
                conn.connectTimeout = timeout
                conn.readTimeout = timeout
                conn.requestMethod = method
                conn.setRequestProperty("Accept", "application/json")
                conn.useCaches = false
                if (method == "POST" && body != null) {
                    val bytes = body.toByteArray(Charsets.UTF_8)
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setFixedLengthStreamingMode(bytes.size)
                    conn.outputStream.use { it.write(bytes) }
                }
                val status = conn.responseCode
                val stream: InputStream? = if (status >= 400) conn.errorStream else conn.inputStream
                val text = stream?.use { s -> String(s.readNBytesCompat(1024 * 1024), Charsets.UTF_8) } ?: ""
                conn.disconnect()
                call.resolve(JSObject().put("status", status).put("body", text))
            } catch (e: Exception) {
                if (mismatch.get()) call.reject("pin_mismatch", "pin_mismatch")
                else call.reject("local_unreachable: ${e.message}", "local_unreachable")
            }
        }
    }

    override fun handleOnDestroy() {
        releaseHotspot()
        discoveryListener?.let { l -> runCatching { nsd?.stopServiceDiscovery(l) } }
        discoveryListener = null
        super.handleOnDestroy()
    }
}

/** InputStream.readNBytes exists only on API 33+; cap the body ourselves. */
private fun InputStream.readNBytesCompat(max: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(8192)
    var total = 0
    while (true) {
        val n = read(buf)
        if (n < 0) break
        total += n
        if (total > max) throw java.io.IOException("response too large")
        out.write(buf, 0, n)
    }
    return out.toByteArray()
}
