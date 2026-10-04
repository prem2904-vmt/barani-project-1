import Foundation
import UIKit
import UserNotifications

// MARK: - CallKit answer / decline, told to the server NATIVELY
//
// Calls ring through PushKit + CallKit and are reported as what they are (an
// audio call shows "Prefrontal Audio"). Answering an AUDIO call on the lock
// screen keeps the app in the background — iOS does not foreground it — and
// the WKWebView that runs our signaling (SignalR) and WebRTC is suspended, so
// the web app cannot send AcceptCall until the user opens the app. Before this
// the caller sat on "Ringing their devices…" and gave up after 60 s.
//
// So the answer goes to the server from HERE, at once, over HTTPS:
//   POST /api/calls/push/answering {sessionId}  — the caller sees "Answered —
//        connecting…" and the ring is held for this device to join;
//   POST /api/calls/push/decline   {sessionId}  — Decline / hang-up on the
//        native screen before the web app joined (a server no-op once joined).
// Authenticated by the same device-bound reply token the native chat reply
// uses (ChatReplyStore: Keychain, this device only, revoked on logout) — never
// the web session, never logged.
//
// The web app still does the real join (AcceptCall + WebRTC) when it runs: it
// reads the answer the CallKit plugin holds (getPendingAnswer) on attach and on
// every resume. If the app is not in the foreground, a local notification says
// to open it to connect the audio; it is removed once the web app joins.
//
// Wired by name to the plugin's NotificationCenter posts, so the app target
// needn't import the plugin module (same as PFCallKitEndRing).
final class CallAnswerNative {
    static let shared = CallAnswerNative()

    static let answeredName = Notification.Name("PFCallKitAnswered")
    static let connectedName = Notification.Name("PFCallKitConnected")
    static let endedUnjoinedName = Notification.Name("PFCallKitEndedUnjoined")
    /// Local "open the app to connect" notification — handled natively by
    /// ChatNotificationCenter (never forwarded to the web layer).
    static let connectCategory = "PF_CALL_CONNECT"
    private static let connectDelay: TimeInterval = 3

    private var installed = false
    private var joined = Set<String>()
    private let session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral   // no cookies / cache on disk
        cfg.timeoutIntervalForRequest = 10
        cfg.timeoutIntervalForResource = 20
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }()

    /// AppDelegate.didFinishLaunching — before the plugin can see a VoIP push.
    func install() {
        guard !installed else { return }
        installed = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: Self.answeredName, object: nil, queue: .main) { [weak self] note in
            self?.onAnswered(note.userInfo ?? [:])
        }
        nc.addObserver(forName: Self.connectedName, object: nil, queue: .main) { [weak self] note in
            guard let id = note.userInfo?["callId"] as? String else { return }
            self?.joined.insert(id)
            self?.removeConnectPrompt(id)
        }
        nc.addObserver(forName: Self.endedUnjoinedName, object: nil, queue: .main) { [weak self] note in
            guard let id = note.userInfo?["callId"] as? String else { return }
            self?.removeConnectPrompt(id)
            self?.post(path: "decline", sessionId: id, retries: 1)
        }
    }

    private func onAnswered(_ info: [AnyHashable: Any]) {
        guard let id = info["callId"] as? String, !id.isEmpty else { return }
        joined.remove(id)
        post(path: "answering", sessionId: id, retries: 2)
        // App already in the foreground → the web app joins by itself.
        if (info["appActive"] as? Bool) == true { return }
        let name = (info["name"] as? String) ?? ""
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.connectDelay) { [weak self] in
            guard let self, !self.joined.contains(id),
                  UIApplication.shared.applicationState != .active else { return }
            self.showConnectPrompt(id, name: name)
        }
    }

    // MARK: HTTPS

    private func post(path: String, sessionId: String, retries: Int) {
        guard let creds = ChatReplyStore.load() else {
            print("[call-native] \(path): no device credential — the web app will send it when opened")
            return
        }
        if creds.expiresAt <= Date().timeIntervalSince1970 { return }
        guard let base = URL(string: creds.apiUrl), base.scheme == "https" || base.host == "localhost",
              let body = try? JSONSerialization.data(withJSONObject: ["sessionId": sessionId]) else { return }
        var req = URLRequest(url: base.appendingPathComponent("api/calls/push/\(path)"))
        req.httpMethod = "POST"
        req.httpBody = body
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(creds.token, forHTTPHeaderField: "X-Push-Reply-Token")

        // Keep the process alive for the round trip (locked phone, background).
        var task: UIBackgroundTaskIdentifier = .invalid
        let finish = {
            DispatchQueue.main.async {
                if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
            }
        }
        task = UIApplication.shared.beginBackgroundTask(withName: "pf-call-\(path)") {
            if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        }
        session.dataTask(with: req) { [weak self] _, resp, err in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            // Ids + status only — never the token.
            print("[call-native] \(path) → \(status)")
            let transient = err != nil || status == 0 || status == 429 || status >= 500
            if transient && retries > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self?.post(path: path, sessionId: sessionId, retries: retries - 1)
                    finish()
                }
                return
            }
            finish()
        }.resume()
    }

    // MARK: "Open the app to connect" prompt

    private func promptId(_ callId: String) -> String { "pf-call-connect-\(callId)" }

    private func showConnectPrompt(_ callId: String, name: String) {
        let c = UNMutableNotificationContent()
        c.title = name.isEmpty ? "Call answered" : "Call with \(name)"
        c.body = "Open Prefrontal to connect the audio."
        c.categoryIdentifier = Self.connectCategory
        c.userInfo = ["kind": "call-connect", "callId": callId]
        let req = UNNotificationRequest(identifier: promptId(callId), content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
    }

    private func removeConnectPrompt(_ callId: String) {
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: [promptId(callId)])
        center.removePendingNotificationRequests(withIdentifiers: [promptId(callId)])
    }
}
