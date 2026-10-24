import UIKit
import Capacitor

/// iOS 27 terminates an app at launch unless it adopts the UIScene life cycle
/// (UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption → SIGTRAP).
/// The window still comes from Main.storyboard (UISceneStoryboardFile); this
/// delegate only hands URL opens and Universal Links — which UIKit now delivers
/// to the scene instead of the app delegate — to Capacitor, same as before.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Plugins that still look up UIApplication.shared.delegate?.window.
        (UIApplication.shared.delegate as? AppDelegate)?.window = window

        // Cold start from an app link or a Universal Link.
        if let context = connectionOptions.urlContexts.first {
            open(context)
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity) { _ in }
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { open(context) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity) { _ in }
    }

    private func open(_ context: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication { options[.sourceApplication] = source }
        if let annotation = context.options.annotation { options[.annotation] = annotation }
        options[.openInPlace] = context.options.openInPlace
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
    }
}
