import Foundation
import Capacitor
import Network
import NetworkExtension
import CryptoKit
import Security

/**
 * PfBridgeLocal — reach a Prefrontal Bridge on the local network
 * (bridge-api v1, B.3 / B.5). A transport only; every rule lives in TS
 * (shared/bridges/bridge-local.service.ts).
 *
 *  - startDiscovery / stopDiscovery: NWBrowser over Bonjour
 *    `_prefrontal-bridge._tcp` WITH the TXT record (Info.plist lists the
 *    service in NSBonjourServices + NSLocalNetworkUsageDescription; if the
 *    user denies Local Network access the browser simply finds nothing and
 *    the UI explains). The Bridge's IPv4 rides in TXT `ip`, so no resolve.
 *  - joinHotspot / leaveHotspot: NEHotspotConfiguration, joinOnce. Needs the
 *    "Hotspot Configuration" capability on the App ID + the entitlement in
 *    App.entitlements.
 *  - request: URLSession whose delegate accepts ONLY a leaf certificate whose
 *    SubjectPublicKeyInfo SHA-256 (first 10 bytes, Crockford) equals the pin.
 */
@objc(PfBridgeLocalPlugin)
public class PfBridgeLocalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PfBridgeLocalPlugin"
    public let jsName = "PfBridgeLocal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "joinHotspot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leaveHotspot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    private static let serviceType = "_prefrontal-bridge._tcp"
    private var browser: NWBrowser?
    private var joinedSsid: String?

    @objc func capabilities(_ call: CAPPluginCall) {
        call.resolve(["discovery": true, "hotspot": true])
    }

    // MARK: Discovery

    @objc func startDiscovery(_ call: CAPPluginCall) {
        if browser != nil { call.resolve(); return }
        let params = NWParameters()
        params.includePeerToPeer = false
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: PfBridgeLocalPlugin.serviceType, domain: nil), using: params)
        b.browseResultsChangedHandler = { [weak self] _, changes in
            guard let self = self else { return }
            for change in changes {
                switch change {
                case .added(let r): self.emit("bridgeFound", r)
                case .changed(old: _, new: let r, flags: _): self.emit("bridgeFound", r)
                case .removed(let r): self.emit("bridgeLost", r)
                default: break
                }
            }
        }
        b.stateUpdateHandler = { state in
            if case .failed = state { b.cancel() }
        }
        browser = b
        b.start(queue: .main)
        call.resolve()
    }

    @objc func stopDiscovery(_ call: CAPPluginCall) {
        browser?.cancel()
        browser = nil
        call.resolve()
    }

    private func emit(_ event: String, _ r: NWBrowser.Result) {
        guard case let .service(name, _, _, _) = r.endpoint else { return }
        var txt: [String: String] = [:]
        if case let .bonjour(record) = r.metadata {
            for (k, v) in record.dictionary { txt[k.lowercased()] = String(v.prefix(255)) }
        }
        var addresses: [String] = []
        if let ip = txt["ip"], PfBridgeLocalPlugin.isIpv4(ip) { addresses.append(ip) }
        notifyListeners(event, data: [
            "name": name,
            "host": addresses.first as Any,
            "port": 8443,
            "txt": txt,
            "addresses": addresses
        ])
    }

    static func isIpv4(_ s: String) -> Bool {
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 4 && parts.allSatisfy { p in p.count >= 1 && p.count <= 3 && p.allSatisfy(\.isNumber) && (Int(p) ?? 999) <= 255 }
    }

    // MARK: Hotspot (NEHotspotConfiguration)

    @objc func joinHotspot(_ call: CAPPluginCall) {
        guard let ssid = call.getString("ssid"), !ssid.isEmpty, ssid.utf8.count <= 32 else {
            call.reject("hotspot_join_failed: ssid", "hotspot_join_failed"); return
        }
        let psk = call.getString("psk") ?? ""
        let config = psk.isEmpty ? NEHotspotConfiguration(ssid: ssid) : NEHotspotConfiguration(ssid: ssid, passphrase: psk, isWEP: false)
        config.joinOnce = true
        NEHotspotConfigurationManager.shared.apply(config) { [weak self] error in
            if let e = error as NSError?, e.domain == NEHotspotConfigurationErrorDomain,
               e.code != NEHotspotConfigurationError.alreadyAssociated.rawValue {
                let code = e.code == NEHotspotConfigurationError.userDenied.rawValue ? "local_permission_denied" : "hotspot_join_failed"
                call.reject("\(code): \(e.localizedDescription)", code)
                return
            }
            if let e = error, (e as NSError).domain != NEHotspotConfigurationErrorDomain {
                call.reject("hotspot_join_failed: \(e.localizedDescription)", "hotspot_join_failed"); return
            }
            self?.joinedSsid = ssid
            call.resolve(["joined": true])
        }
    }

    @objc func leaveHotspot(_ call: CAPPluginCall) {
        if let ssid = joinedSsid { NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid) }
        joinedSsid = nil
        call.resolve()
    }

    // MARK: Pinned HTTPS

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString), url.scheme == "https",
              let host = url.host, PfBridgeLocalPlugin.isIpv4(host), url.path.hasPrefix("/local/v1/") else {
            call.reject("bad_request", "bad_request"); return
        }
        let pin = BridgePinIOS.normalize(call.getString("pinFingerprint") ?? "")
        guard BridgePinIOS.isValid(pin) else { call.reject("bad_request: pin", "bad_request"); return }
        let method = (call.getString("method") ?? "GET").uppercased()
        guard method == "GET" || method == "POST" else { call.reject("bad_request: method", "bad_request"); return }
        let timeout = min(30.0, max(1.0, Double(call.getInt("timeoutMs") ?? 10_000) / 1000.0))

        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if method == "POST", let body = call.getString("body") {
            req.httpBody = body.data(using: .utf8)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let delegate = PinnedSessionDelegate(pin: pin)
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = timeout
        cfg.waitsForConnectivity = false
        let session = URLSession(configuration: cfg, delegate: delegate, delegateQueue: nil)
        session.dataTask(with: req) { data, response, error in
            defer { session.finishTasksAndInvalidate() }
            if delegate.mismatch { call.reject("pin_mismatch", "pin_mismatch"); return }
            if let e = error { call.reject("local_unreachable: \(e.localizedDescription)", "local_unreachable"); return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = data.flatMap { String(data: $0.prefix(1024 * 1024), encoding: .utf8) } ?? ""
            call.resolve(["status": status, "body": text])
        }.resume()
    }
}

/// Accepts only the leaf whose SPKI pin matches; no CA chain, no hostname.
final class PinnedSessionDelegate: NSObject, URLSessionDelegate {
    let pin: String
    private(set) var mismatch = false
    init(pin: String) { self.pin = pin }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        let der = SecCertificateCopyData(leaf) as Data
        if let spki = BridgePinIOS.spki(fromCertificate: der), BridgePinIOS.pin(of: spki) == pin {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            mismatch = true
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

/// B.0 pin: Crockford(first 10 bytes of SHA-256(SPKI DER)).
enum BridgePinIOS {
    static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    static func normalize(_ s: String) -> String {
        s.uppercased().replacingOccurrences(of: "-", with: "").replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "O", with: "0").replacingOccurrences(of: "I", with: "1").replacingOccurrences(of: "L", with: "1")
    }

    static func isValid(_ pin: String) -> Bool {
        pin.count == 16 && pin.allSatisfy { alphabet.contains($0) }
    }

    static func crockford(_ bytes: [UInt8]) -> String {
        var out = ""
        var value = 0
        var bits = 0
        for b in bytes {
            value = (value << 8) | Int(b)
            bits += 8
            while bits >= 5 {
                out.append(alphabet[(value >> (bits - 5)) & 31])
                bits -= 5
            }
            value &= (1 << bits) - 1
        }
        if bits > 0 { out.append(alphabet[(value << (5 - bits)) & 31]) }
        return out
    }

    static func pin(of spki: Data) -> String {
        crockford(Array(SHA256.hash(data: spki)).prefix(10).map { $0 })
    }

    /// Minimal DER walk: Certificate → TBSCertificate → subjectPublicKeyInfo
    /// (the 6th/7th element, after the optional [0] version).
    static func spki(fromCertificate der: Data) -> Data? {
        let bytes = [UInt8](der)
        guard let cert = element(bytes, 0), cert.tag == 0x30,
              let tbs = element(bytes, cert.contentStart), tbs.tag == 0x30 else { return nil }
        var i = tbs.contentStart
        var index = 0
        while i < tbs.end {
            guard let el = element(bytes, i) else { return nil }
            if index == 0 && el.tag == 0xA0 { i = el.end; continue }   // [0] version
            // serial, signature, issuer, validity, subject, subjectPublicKeyInfo
            if index == 5 { return Data(bytes[i..<el.end]) }
            index += 1
            i = el.end
        }
        return nil
    }

    private struct Element { let tag: UInt8; let contentStart: Int; let end: Int }

    private static func element(_ b: [UInt8], _ at: Int) -> Element? {
        guard at + 1 < b.count else { return nil }
        let tag = b[at]
        var len = Int(b[at + 1])
        var start = at + 2
        if len & 0x80 != 0 {
            let n = len & 0x7f
            guard n > 0, n <= 4, start + n <= b.count else { return nil }
            len = 0
            for k in 0..<n { len = (len << 8) | Int(b[start + k]) }
            start += n
        }
        guard start + len <= b.count else { return nil }
        return Element(tag: tag, contentStart: start, end: start + len)
    }
}
