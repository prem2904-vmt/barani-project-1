import UIKit
import Capacitor

/// Custom Capacitor bridge controller.
///
/// Capacitor 8 only auto-registers *package* plugins (those listed in the
/// generated capacitor.config.json `packageClassList`). An app-embedded plugin
/// like PrefrontalPrinter isn't in that list, so it must be registered
/// explicitly here — `registerPluginInstance` bypasses the auto-register gate.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrefrontalPrinterPlugin())
        bridge?.registerPluginInstance(PfChatReplyPlugin())
        // Prefrontal Bridge local access (mDNS, hotspot join, pinned HTTPS).
        bridge?.registerPluginInstance(PfBridgeLocalPlugin())
        // The bridge just made Capacitor's NotificationRouter the delegate —
        // wrap it so chat Reply / Mark as read stay native and everything
        // else (taps, other pushes, local notifications) reaches the plugins.
        if let router = bridge?.notificationRouter {
            ChatNotificationCenter.shared.adopt(router: router)
        }
    }
}
