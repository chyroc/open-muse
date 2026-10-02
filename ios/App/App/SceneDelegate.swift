import UIKit
import Capacitor
import WebKit
import Security


// Only the bundled main frame can read or write this app's MA credentials.
private final class MuseCredentialsHandler: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost",
              message.webView?.url?.scheme == "capacitor", message.webView?.url?.host == "localhost",
              let body = message.body as? [String: String]
        else { replyHandler(nil, "Invalid credential request"); return }
        guard body["namespace"] == nil || body["namespace"] == "background"
        else { replyHandler(nil, "Invalid credential namespace"); return }
        var service = body["namespace"] == "background"
            ? "app.openmuse.mobile.background.v1" : "app.openmuse.mobile.direct-ma.v1"
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.environment["MUSE_UI_TEST_SIGNED_OUT"] == "1" { service += ".signed-out-test" }
        #endif
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service, kSecAttrAccount as String: "active"]
        if body["operation"] == "read" {
            var lookup = query
            lookup[kSecReturnData as String] = true
            lookup[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(lookup as CFDictionary, &result)
            if status == errSecItemNotFound { replyHandler("", nil); return }
            guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8)
            else { replyHandler(nil, "Cannot restore credentials"); return }
            replyHandler(value, nil)
        } else if body["operation"] == "write", let value = body["value"], value.utf8.count <= 65536 {
            var status: OSStatus
            if value.isEmpty {
                status = SecItemDelete(query as CFDictionary)
                if status == errSecItemNotFound { status = errSecSuccess }
            } else {
                let values: [String: Any] = [kSecValueData as String: Data(value.utf8),
                                            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
                status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
                if status == errSecItemNotFound { status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil) }
            }
            replyHandler(status == errSecSuccess ? true : nil, status == errSecSuccess ? nil : "Cannot save credentials")
        } else { replyHandler(nil, "Invalid credential operation") }
    }
}

// Plays system haptics the web interface asks for: a selection tick, a light
// or medium impact, or a success notification. Only the bundled main frame
// may ask, and unknown kinds are ignored.
final class MuseHapticsHandler: NSObject, WKScriptMessageHandler {
    private let selection = UISelectionFeedbackGenerator()
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let medium = UIImpactFeedbackGenerator(style: .medium)
    private let notification = UINotificationFeedbackGenerator()

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost",
              let kind = message.body as? String
        else { return }
        switch kind {
        case "selection": selection.selectionChanged()
        case "light": light.impactOccurred()
        case "medium": medium.impactOccurred()
        case "success": notification.notificationOccurred(.success)
        default: break
        }
    }
}

class MuseBridgeViewController: CAPBridgeViewController {
    private var keyboardObservers: [NSObjectProtocol] = []
    private let credentialsHandler = MuseCredentialsHandler()
    private lazy var filesHandler = MuseFilesHandler(presenter: self)
    private let healthHandler = MuseHealthHandler()
    private let hapticsHandler = MuseHapticsHandler()

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Read native preferences before the React bundle initializes. This also
        // respects the language selected for this app in system Settings.
        if let data = try? JSONSerialization.data(withJSONObject: Locale.preferredLanguages),
           let languages = String(data: data, encoding: .utf8) {
            webView?.configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__OPEN_MUSE_LANGUAGES__ = \(languages);",
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        webView?.configuration.userContentController.addScriptMessageHandler(credentialsHandler, contentWorld: .page, name: "museCredentials")
        webView?.configuration.userContentController.addScriptMessageHandler(filesHandler, contentWorld: .page, name: "museFiles")
        webView?.configuration.userContentController.addScriptMessageHandler(healthHandler, contentWorld: .page, name: "museHealth")
        webView?.configuration.userContentController.add(hapticsHandler, contentWorld: .page, name: "museHaptics")
        #if DEBUG && targetEnvironment(simulator)
        // Real-MA acceptance uses separate mappings/resources without changing
        // the user's normal main chat or personal memory. No credential is injected.
        if let profile = ProcessInfo.processInfo.environment["MUSE_UI_TEST_PROFILE"],
           profile.range(of: "^welcome-[a-z0-9-]{1,60}$", options: .regularExpression) != nil {
            webView?.configuration.userContentController.addUserScript(WKUserScript(
                source: "Object.defineProperty(globalThis, '__MUSE_TEST_PROFILE__', { value: '\(profile)' });",
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        #endif
        // Keep the composer above the keyboard without spending the reduced
        // viewport on the bottom navigation. No third-party app is inspected.
        for (notification, visible) in [
            (UIResponder.keyboardWillShowNotification, true),
            (UIResponder.keyboardWillHideNotification, false)
        ] {
            keyboardObservers.append(NotificationCenter.default.addObserver(
                forName: notification, object: nil, queue: .main
            ) { [weak self] _ in
                self?.webView?.evaluateJavaScript(
                    "document.documentElement.classList.toggle('keyboard-open', \(visible));"
                )
            })
        }
    }

    // Use the page color of the current appearance behind the web view, so
    // launch, overscroll and rotation never flash the other appearance.
    override func viewDidLoad() {
        super.viewDidLoad()
        let page = UIColor { traits in
            traits.userInterfaceStyle == .dark ? .black : UIColor(white: 252.0 / 255, alpha: 1)
        }
        view.backgroundColor = page
        webView?.isOpaque = false
        webView?.backgroundColor = page
        webView?.scrollView.backgroundColor = page
    }

    deinit {
        keyboardObservers.forEach { NotificationCenter.default.removeObserver($0) }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MuseBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
