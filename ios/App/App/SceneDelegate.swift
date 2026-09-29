import UIKit
import Capacitor
import WebKit
import Security

// Only our bundled main frame may access our endpoint-scoped app sessions.
// Raw MA keys never cross this bridge or enter Keychain.
private final class MuseSessionHandler: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost",
              message.webView?.url?.scheme == "capacitor", message.webView?.url?.host == "localhost",
              let body = message.body as? [String: String],
              let endpoint = body["endpoint"], endpoint.count <= 2048,
              let url = URL(string: endpoint), let host = url.host,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/",
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host))
        else { replyHandler(nil, "Invalid session request"); return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "app.openmuse.mobile.sessions",
            kSecAttrAccount as String: endpoint
        ]
        if body["operation"] == "read" {
            var lookup = query
            lookup[kSecReturnData as String] = true
            lookup[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(lookup as CFDictionary, &result)
            if status == errSecItemNotFound { replyHandler("", nil); return }
            guard status == errSecSuccess, let data = result as? Data,
                  let token = String(data: data, encoding: .utf8)
            else { replyHandler(nil, "Cannot restore session"); return }
            replyHandler(token, nil)
        } else if body["operation"] == "write", let token = body["token"],
                  token.isEmpty || token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil {
            var status: OSStatus
            if token.isEmpty {
                status = SecItemDelete(query as CFDictionary)
                if status == errSecItemNotFound { status = errSecSuccess }
            } else {
                let values: [String: Any] = [
                    kSecValueData as String: Data(token.utf8),
                    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
                ]
                status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
                if status == errSecItemNotFound {
                    status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
                }
            }
            replyHandler(status == errSecSuccess ? true : nil, status == errSecSuccess ? nil : "Cannot save session")
        } else { replyHandler(nil, "Invalid session operation") }
    }
}

class MuseBridgeViewController: CAPBridgeViewController {
    private var keyboardObservers: [NSObjectProtocol] = []
    private let sessionHandler = MuseSessionHandler()

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.configuration.userContentController.addScriptMessageHandler(sessionHandler, contentWorld: .page, name: "museMobileSession")
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
        #if DEBUG && targetEnvironment(simulator)
        // Explicit test-only loopback endpoint. No credentials or production
        // server overrides are accepted through this launch hook.
        if ProcessInfo.processInfo.environment["MUSE_UI_TESTING"] == "1",
           let endpoint = ProcessInfo.processInfo.environment["MUSE_UI_TEST_ENDPOINT"],
           let url = URL(string: endpoint), url.scheme == "http", url.host == "127.0.0.1",
           url.path.isEmpty, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
           let encoded = try? JSONSerialization.data(withJSONObject: [endpoint]),
           let json = String(data: encoded, encoding: .utf8) {
            let script = "localStorage.setItem('muse.endpoint', \(json)[0]); location.hash = '/';"
            webView?.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #endif
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
