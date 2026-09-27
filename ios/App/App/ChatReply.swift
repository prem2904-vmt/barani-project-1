import Foundation
import UIKit
import UserNotifications
import Security
import Capacitor

// MARK: - Reply from the notification (no UI)
//
// A chat push arrives with aps.category = CHAT_MESSAGE. Long-press / pull down
// → "Reply" (text field) or "Mark as read". Both are handled HERE, natively,
// without launching the web UI: a URLSession POST to the backend's
// /api/chat/push-reply endpoints, authenticated by a device-bound REPLY TOKEN
// (not the session — a 1-hour Supabase access token is usually dead by the
// time a push is answered, and the native side must not rotate the web app's
// refresh token). The web app asks the server for that token after it
// registers this device for push and hands it over through the PfChatReply
// plugin; it lives ONLY in the Keychain (this device, after first unlock) and
// is wiped on logout / account switch. It is never logged.
//
// Failure (no token, expired, revoked, offline) → a local "Couldn't send — tap
// to open" notification; tapping it opens the app on that conversation.

/// Keychain copy of the reply credentials. One item, this device only.
enum ChatReplyStore {
    private static let service = "health.prefrontal.app.chat-reply"
    private static let account = "reply-credentials"

    struct Credentials: Codable {
        let apiUrl: String
        let token: String
        let expiresAt: Double   // unix seconds
        let userId: String?
    }

    static func save(_ c: Credentials) -> Bool {
        guard let data = try? JSONEncoder().encode(c) else { return false }
        clear()
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            // Readable in the background once the phone was unlocked after boot
            // (a reply can be typed while locked, after Face ID); never synced
            // to iCloud or restored to another device.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> Credentials? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
    }

    @discardableResult
    static func clear() -> Bool {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let s = SecItemDelete(q as CFDictionary)
        return s == errSecSuccess || s == errSecItemNotFound
    }
}

/// Owns UNUserNotificationCenter's delegate: chat actions are handled natively,
/// everything else is forwarded to Capacitor's NotificationRouter (push +
/// local notification plugins) exactly as before. Installed at launch — iOS
/// requires the delegate before didFinishLaunching returns, and a cold start
/// caused by a Reply delivers the action before the web bridge exists.
/// Responses that aren't ours and arrive before the bridge are held until
/// Capacitor's router is adopted (MainViewController.capacitorDidLoad).
final class ChatNotificationCenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ChatNotificationCenter()

    static let category = "CHAT_MESSAGE"
    static let replyAction = "REPLY"
    static let markReadAction = "MARK_READ"
    static let failedCategory = "CHAT_REPLY_FAILED"
    /// Opened through the App plugin (appUrlOpen / getLaunchUrl) → the web app
    /// navigates to the conversation. Never registered as an OS URL scheme.
    static let openScheme = "prefrontal-chat"

    private weak var next: UNUserNotificationCenterDelegate?
    private var held: [(UNNotificationResponse, () -> Void)] = []
    private var session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral   // no cookies / cache on disk
        cfg.timeoutIntervalForRequest = 12
        cfg.timeoutIntervalForResource = 20
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }()

    /// AppDelegate.didFinishLaunching.
    func install() {
        let center = UNUserNotificationCenter.current()
        let reply = UNTextInputNotificationAction(
            identifier: Self.replyAction, title: "Reply",
            // Face ID / passcode before a reply goes out from a locked phone.
            options: [.authenticationRequired],
            textInputButtonTitle: "Send", textInputPlaceholder: "Message")
        let markRead = UNNotificationAction(identifier: Self.markReadAction, title: "Mark as read", options: [])
        let chat = UNNotificationCategory(identifier: Self.category, actions: [reply, markRead],
                                          intentIdentifiers: [], options: [])
        let failed = UNNotificationCategory(identifier: Self.failedCategory, actions: [], intentIdentifiers: [], options: [])
        // Merge: keep any categories another plugin registered.
        center.getNotificationCategories { existing in
            var all = existing.filter { $0.identifier != Self.category && $0.identifier != Self.failedCategory }
            all.insert(chat)
            all.insert(failed)
            center.setNotificationCategories(all)
        }
        if center.delegate !== self { center.delegate = self }
    }

    /// MainViewController.capacitorDidLoad: Capacitor just made its router the
    /// delegate — wrap it, then hand it anything that arrived before it.
    func adopt(router: UNUserNotificationCenterDelegate) {
        if router !== self { next = router }
        UNUserNotificationCenter.current().delegate = self
        let pending = held
        held.removeAll()
        for (response, done) in pending { forward(response, done) }
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if let next = next, next.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
            next.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
        } else {
            completionHandler([.banner, .list, .sound, .badge])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        if content.categoryIdentifier == Self.category,
           response.actionIdentifier == Self.replyAction || response.actionIdentifier == Self.markReadAction {
            handleChatAction(response, completionHandler)
            return
        }
        if content.categoryIdentifier == Self.failedCategory {
            openConversation(content.userInfo["conversationId"] as? String)
            completionHandler()
            return
        }
        forward(response, completionHandler)
    }

    private func forward(_ response: UNNotificationResponse, _ done: @escaping () -> Void) {
        guard let next = next else {
            // Bridge not up yet (cold start from a tap) — hold it; Apple allows
            // a short delay before the completion handler.
            held.append((response, done))
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
                guard let self = self, let i = self.held.firstIndex(where: { $0.0 === response }) else { return }
                self.held.remove(at: i)
                done()
            }
            return
        }
        if next.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
            next.userNotificationCenter?(UNUserNotificationCenter.current(), didReceive: response, withCompletionHandler: done)
        } else {
            done()
        }
    }

    // MARK: Chat actions

    private func handleChatAction(_ response: UNNotificationResponse, _ completion: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        guard let conversationId = info["conversationId"] as? String, UUID(uuidString: conversationId) != nil else {
            completion(); return
        }
        // Keep the process alive for the round trip (the action runs in the
        // background; iOS gives it a short window).
        var task: UIBackgroundTaskIdentifier = .invalid
        let finish: () -> Void = {
            DispatchQueue.main.async {
                completion()
                if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
            }
        }
        task = UIApplication.shared.beginBackgroundTask(withName: "pf-chat-reply") {
            if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        }

        if response.actionIdentifier == Self.markReadAction {
            post(path: "read", body: ["conversationId": conversationId]) { _ in
                self.removeDelivered(threadId: conversationId)
                finish()
            }
            return
        }

        let text = ((response as? UNTextInputNotificationResponse)?.userText ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { finish(); return }
        // One id per reply → a retry after a lost response is never a double send.
        let clientMessageId = "ios-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let body: [String: Any] = ["conversationId": conversationId, "body": text, "clientMessageId": clientMessageId]
        post(path: "messages", body: body, retries: 1) { outcome in
            switch outcome {
            case .ok:
                // The reply marks the thread read server-side — clear its banners.
                self.removeDelivered(threadId: conversationId)
            case .failed(let reason):
                self.showFailure(conversationId: conversationId, text: text, reason: reason)
            }
            finish()
        }
    }

    enum Outcome { case ok, failed(String) }

    private func post(path: String, body: [String: Any], retries: Int = 0, done: @escaping (Outcome) -> Void) {
        guard let creds = ChatReplyStore.load() else { done(.failed("signed-out")); return }
        if creds.expiresAt <= Date().timeIntervalSince1970 { done(.failed("expired")); return }
        guard let base = URL(string: creds.apiUrl), base.scheme == "https" || base.host == "localhost",
              let data = try? JSONSerialization.data(withJSONObject: body) else { done(.failed("config")); return }
        var req = URLRequest(url: base.appendingPathComponent("api/chat/push-reply/\(path)"))
        req.httpMethod = "POST"
        req.httpBody = data
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(creds.token, forHTTPHeaderField: "X-Push-Reply-Token")
        session.dataTask(with: req) { _, resp, err in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status) { done(.ok); return }
            if status == 401 {
                // Revoked / expired server-side: stop using it; the app re-issues on next open.
                ChatReplyStore.clear()
                done(.failed("signed-out")); return
            }
            let transient = err != nil || status == 0 || status == 429 || status >= 500
            if transient && retries > 0 {
                DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) {
                    self.post(path: path, body: body, retries: retries - 1, done: done)
                }
                return
            }
            done(.failed(transient ? "offline" : "refused"))
        }.resume()
    }

    private func showFailure(conversationId: String, text: String, reason: String) {
        let c = UNMutableNotificationContent()
        c.title = "Couldn't send your reply"
        let snippet = text.count > 60 ? String(text.prefix(60)) + "…" : text
        c.body = "“\(snippet)” — tap to open the conversation."
        c.sound = .default
        c.categoryIdentifier = Self.failedCategory
        c.threadIdentifier = conversationId
        c.userInfo = ["conversationId": conversationId, "kind": "chat-reply-failed"]
        let req = UNNotificationRequest(identifier: "pf-reply-failed-\(conversationId)", content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
    }

    func removeDelivered(threadId: String) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { list in
            let ids = list.filter { $0.request.content.threadIdentifier == threadId }.map { $0.request.identifier }
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    /// Hand "open this conversation" to the web app through the App plugin
    /// (appUrlOpen when running, getLaunchUrl on a cold start).
    private func openConversation(_ id: String?) {
        guard let id = id, UUID(uuidString: id) != nil,
              let url = URL(string: "\(Self.openScheme)://open?c=\(id)") else { return }
        DispatchQueue.main.async {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
    }
}

/// JS bridge: the web app stores / clears the reply credentials.
@objc(PfChatReplyPlugin)
public class PfChatReplyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PfChatReplyPlugin"
    public let jsName = "PfChatReply"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setCredentials", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismissConversation", returnType: CAPPluginReturnPromise),
    ]

    /// The user opened this conversation in the app — clear its banners.
    @objc func dismissConversation(_ call: CAPPluginCall) {
        if let id = call.getString("conversationId"), UUID(uuidString: id) != nil {
            ChatNotificationCenter.shared.removeDelivered(threadId: id)
        }
        call.resolve()
    }

    @objc func setCredentials(_ call: CAPPluginCall) {
        guard let apiUrl = call.getString("apiUrl"), let token = call.getString("token"),
              let expiresAt = call.getDouble("expiresAt"), !token.isEmpty else {
            call.reject("apiUrl, token and expiresAt are required"); return
        }
        let ok = ChatReplyStore.save(.init(apiUrl: apiUrl, token: token, expiresAt: expiresAt / 1000.0,
                                           userId: call.getString("userId")))
        ok ? call.resolve() : call.reject("keychain write failed")
    }

    @objc func clear(_ call: CAPPluginCall) {
        ChatReplyStore.clear()
        call.resolve()
    }

    /// Whether credentials are held (never returns the token itself).
    @objc func status(_ call: CAPPluginCall) {
        let c = ChatReplyStore.load()
        call.resolve(["stored": c != nil, "userId": c?.userId ?? NSNull(), "expiresAt": (c?.expiresAt ?? 0) * 1000.0])
    }
}
