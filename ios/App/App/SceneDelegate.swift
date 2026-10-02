import UIKit
import Capacitor
import WebKit
import Security
import UserNotifications


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

// Reminders from the person's Upcoming list become local notifications, so a
// due item is announced while Open Muse is closed. The page sends the full
// set of upcoming occurrences each time; it replaces every earlier one.
final class MuseRemindersHandler: NSObject, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    private static let prefix = "open-muse-reminder-"
    private let center = UNUserNotificationCenter.current()

    override init() {
        super.init()
        center.delegate = self
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost",
              let body = message.body as? [String: Any],
              let rows = body["items"] as? [[String: Any]]
        else { return }
        let now = Date()
        let items: [(id: String, title: String, at: Date)] = rows.prefix(48).compactMap { row in
            guard let id = row["id"] as? String, id.range(of: "^[A-Za-z0-9._-]{1,120}$", options: .regularExpression) != nil,
                  let title = row["title"] as? String, !title.isEmpty,
                  let at = row["at"] as? Double
            else { return nil }
            let date = Date(timeIntervalSince1970: at / 1000)
            return date > now ? (id, String(title.prefix(160)), date) : nil
        }
        center.getPendingNotificationRequests { [center] pending in
            center.removePendingNotificationRequests(withIdentifiers: pending
                .map(\.identifier)
                .filter { $0.hasPrefix(Self.prefix) })
            guard !items.isEmpty else { return }
            // Ask once, when there is first something to announce.
            center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                guard granted else { return }
                for item in items {
                    let content = UNMutableNotificationContent()
                    content.title = item.title
                    content.sound = .default
                    content.threadIdentifier = "open-muse-reminders"
                    let parts = Calendar.current.dateComponents(
                        [.year, .month, .day, .hour, .minute, .second], from: item.at)
                    center.add(UNNotificationRequest(
                        identifier: Self.prefix + item.id,
                        content: content,
                        trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
                }
            }
        }
    }

    // In front, the main chat delivers the reminder itself; no banner repeats it.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler(notification.request.identifier.hasPrefix(Self.prefix) ? [] : [.banner, .sound])
    }
}

// Native text fields show no form navigation bar above the keyboard, so the
// web view's content view reports no input accessory view.
private final class NoInputAccessory: NSObject {
    @objc var inputAccessoryView: AnyObject? { nil }
}

private extension WKWebView {
    func hideInputAccessoryBar() {
        guard let content = scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }), let base = object_getClass(content) else { return }
        let name = "\(base)_NoInputAccessory"
        var subclass: AnyClass? = NSClassFromString(name)
        if subclass == nil, let created = objc_allocateClassPair(base, name, 0) {
            let selector = #selector(getter: NoInputAccessory.inputAccessoryView)
            if let method = class_getInstanceMethod(NoInputAccessory.self, selector) {
                class_addMethod(created, selector, method_getImplementation(method), method_getTypeEncoding(method))
            }
            objc_registerClassPair(created)
            subclass = created
        }
        if let subclass { object_setClass(content, subclass) }
    }
}

class MuseBridgeViewController: CAPBridgeViewController {
    private var keyboardObservers: [NSObjectProtocol] = []
    private let credentialsHandler = MuseCredentialsHandler()
    private lazy var filesHandler = MuseFilesHandler(presenter: self)
    private let healthHandler = MuseHealthHandler()
    private let hapticsHandler = MuseHapticsHandler()
    private let remindersHandler = MuseRemindersHandler()

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
        // Floating sheets keep their corners concentric with the display's,
        // which the web view cannot read.
        let corner = (UIScreen.main.value(forKey: "_displayCornerRadius") as? CGFloat) ?? 0
        if corner > 0 {
            webView?.configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__OPEN_MUSE_DEVICE_CORNER__ = \(Int(corner.rounded()));",
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        webView?.configuration.userContentController.addScriptMessageHandler(credentialsHandler, contentWorld: .page, name: "museCredentials")
        webView?.configuration.userContentController.addScriptMessageHandler(filesHandler, contentWorld: .page, name: "museFiles")
        webView?.configuration.userContentController.addScriptMessageHandler(healthHandler, contentWorld: .page, name: "museHealth")
        webView?.configuration.userContentController.add(hapticsHandler, contentWorld: .page, name: "museHaptics")
        webView?.configuration.userContentController.add(remindersHandler, contentWorld: .page, name: "museReminders")
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
        webView?.hideInputAccessoryBar()
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
