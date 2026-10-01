import AppKit
import Carbon.HIToolbox
import CryptoKit
import WebKit
import Security
import ServiceManagement
import UniformTypeIdentifiers

// A named profile (--open-muse-profile <name>) keeps its own Keychain items and
// web data, so an acceptance run never reads or changes the person's own login.
private let profile: String? = {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: "--open-muse-profile"), index + 1 < arguments.count,
          arguments[index + 1].range(of: "^[a-z0-9-]{1,32}$", options: .regularExpression) != nil
    else { return nil }
    return arguments[index + 1]
}()

// Match the web UI's supported-language selection without changing system state.
private func localized(_ english: String) -> String {
    let language = Locale.preferredLanguages.first {
        let base = $0.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first
        return base == "zh" || base == "en"
    } ?? "en"
    let name = language.lowercased().hasPrefix("zh") ? "zh-Hans" : "en"
    guard let path = Bundle.main.path(forResource: name, ofType: "lproj"),
          let bundle = Bundle(path: path) else { return english }
    return bundle.localizedString(forKey: english, value: english, table: nil)
}

// Serve bundled assets through WebKit, not a socket or a background process.
private final class BundleAssets: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.scheme == "muse", url.host == "app",
              let root = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true)
        else { urlSchemeTask.didFailWithError(URLError(.badURL)); return }
        let file = root.appendingPathComponent(url.path == "/" || url.path.isEmpty ? "index.html" : String(url.path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file)
        else { urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return }
        let mime = ["js": "text/javascript", "css": "text/css", "html": "text/html", "svg": "image/svg+xml", "json": "application/json"][file.pathExtension] ?? UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

// Motion for the desktop presence surfaces, kept in one place.
private enum Motion {
    static let pressScale: CGFloat = 0.9
    static let hoverScale: CGFloat = 1.06
    static let springDamping: CGFloat = 16
    static let springStiffness: CGFloat = 320
    static let fade: TimeInterval = 0.18
    static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    // A short ease-out with a slight overshoot reads like a spring for window frames.
    static let settle = CAMediaTimingFunction(controlPoints: 0.22, 1.2, 0.36, 1)
    static let appear: TimeInterval = 0.26
    static let dismiss: TimeInterval = 0.12
}

// Quick chat geometry. The card reports its own height inside these bounds.
private enum QuickChat {
    static let width: CGFloat = 440
    static let initialHeight: CGFloat = 132
    static let minHeight: CGFloat = 132
    static let maxHeight: CGFloat = 560
    static let cornerRadius: CGFloat = 18
    // Distance from the top of the screen, as a share of its visible height.
    static let topInset: CGFloat = 0.2
    static let rise: CGFloat = 10
}

// A borderless panel that can take typing without activating the app, so the
// app in front keeps its place.
private final class QuickPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// Carbon delivers the global shortcut to a C callback, which forwards it here.
nonisolated(unsafe) private var quickChatToggle: (() -> Void)?

// A round button that stays on screen while the workspace window is closed.
// It follows the pointer while dragged, and a press that did not move reopens
// the window on release. Press and hover answer immediately with a spring.
private final class FloatingButtonView: NSView {
    var onOpen: (() -> Void)?
    private let bubble = CALayer()
    private let icon = CALayer()
    private var pressOrigin: NSPoint?
    private var windowOrigin: NSPoint = .zero
    private var dragging = false
    private var hovering = false
    static let diameter: CGFloat = 46

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = false
        let side = Self.diameter
        bubble.bounds = CGRect(x: 0, y: 0, width: side, height: side)
        bubble.position = CGPoint(x: frame.width / 2, y: frame.height / 2)
        bubble.shadowColor = NSColor.black.cgColor
        bubble.shadowOpacity = 0.22
        bubble.shadowRadius = 7
        bubble.shadowOffset = CGSize(width: 0, height: -2)
        bubble.shadowPath = CGPath(ellipseIn: bubble.bounds, transform: nil)
        icon.frame = bubble.bounds
        icon.cornerRadius = side / 2
        icon.masksToBounds = true
        icon.contentsGravity = .resizeAspectFill
        icon.backgroundColor = NSColor.windowBackgroundColor.cgColor
        if let image = NSApplication.shared.applicationIconImage {
            var rect = CGRect(x: 0, y: 0, width: side * 2, height: side * 2)
            icon.contents = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
        }
        bubble.addSublayer(icon)
        layer?.addSublayer(bubble)
        setAccessibilityRole(.button)
        setAccessibilityLabel(localized("Show Open Muse"))
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    required init?(coder: NSCoder) { nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func accessibilityPerformPress() -> Bool { onOpen?(); return true }

    private func settle(_ scale: CGFloat) {
        if Motion.reduced {
            // Reduce Motion keeps the feedback as a short opacity change.
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = bubble.presentation()?.opacity ?? bubble.opacity
            bubble.opacity = scale < 1 ? 0.7 : 1
            fade.duration = Motion.fade
            bubble.add(fade, forKey: "opacity")
            return
        }
        let spring = CASpringAnimation(keyPath: "transform.scale")
        spring.fromValue = bubble.presentation()?.value(forKeyPath: "transform.scale") ?? 1
        spring.toValue = scale
        spring.damping = Motion.springDamping
        spring.stiffness = Motion.springStiffness
        spring.duration = spring.settlingDuration
        bubble.setValue(scale, forKeyPath: "transform.scale")
        bubble.add(spring, forKey: "scale")
    }
    override func mouseEntered(with event: NSEvent) { hovering = true; if pressOrigin == nil { settle(Motion.hoverScale) } }
    override func mouseExited(with event: NSEvent) { hovering = false; if pressOrigin == nil { settle(1) } }
    override func mouseDown(with event: NSEvent) {
        pressOrigin = NSEvent.mouseLocation
        windowOrigin = window?.frame.origin ?? .zero
        dragging = false
        settle(Motion.pressScale)
    }
    override func mouseDragged(with event: NSEvent) {
        guard let start = pressOrigin, let window else { return }
        let now = NSEvent.mouseLocation
        if !dragging && hypot(now.x - start.x, now.y - start.y) > 3 { dragging = true }
        guard dragging else { return }
        window.setFrameOrigin(NSPoint(x: windowOrigin.x + now.x - start.x, y: windowOrigin.y + now.y - start.y))
    }
    override func mouseUp(with event: NSEvent) {
        let moved = dragging
        pressOrigin = nil
        dragging = false
        settle(hovering ? Motion.hoverScale : 1)
        if !moved { onOpen?() }
    }
}

@main
final class OpenMuseApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var settingsWindow: NSWindow?
    private var settingsWebView: WKWebView?
    private var configuration: WKWebViewConfiguration!
    private let assets = BundleAssets()
    private var closingApproved = false
    private var discardPromptOpen = false
    private var statusItem: NSStatusItem?
    private var floatingPanel: NSPanel?
    private var quickPanel: QuickPanel?
    private var quickWebView: WKWebView?
    private var quickHotKey: EventHotKeyRef?
    private var quickShortcutRegistered = false
    private let menuBarKey = "presence.menuBar"
    private let computerKey = "computerUse.enabled"
    private let computer = Computer()
    private let dictation = Dictation()
    private weak var dictationView: WKWebView?
    private let floatingButtonKey = "presence.floatingButton"

    static func main() {
        let app = NSApplication.shared
        let delegate = OpenMuseApp()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: [menuBarKey: true, floatingButtonKey: true])
        installMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1152, height: 768), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Open Muse"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.toolbar = nil
        window.minSize = NSSize(width: 900, height: 600)
        window.center()
        window.setFrameAutosaveName("OpenMuseDesktopWorkspace")
        let configuration = WKWebViewConfiguration()
        if let profile {
            // A stable identifier per profile name keeps its data between launches.
            let bytes = Array(SHA256.hash(data: Data("open-muse-profile:\(profile)".utf8)))
            let id = UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                                 bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: id)
            window.title = "Open Muse (\(profile))"
        }
        configuration.setURLSchemeHandler(assets, forURLScheme: "muse")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "museCredentials")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "musePresence")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "museComputer")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "museDictation")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "museShortcut")
        configuration.userContentController.add(self, name: "museExport")
        configuration.userContentController.add(self, name: "museWindow")
        configuration.userContentController.addUserScript(WKUserScript(source: "window.__OPEN_MUSE_DESKTOP__ = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
           let data = try? JSONSerialization.data(withJSONObject: version, options: .fragmentsAllowed),
           let json = String(data: data, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__OPEN_MUSE_VERSION__ = \(json);",
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        if let data = try? JSONSerialization.data(withJSONObject: Locale.preferredLanguages),
           let languages = String(data: data, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__OPEN_MUSE_LANGUAGES__ = \(languages);",
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        self.configuration = configuration
        webView = makeWebView(window.contentView!.bounds)
        window.contentView = webView
        webView.load(URLRequest(url: URL(string: "muse://app/")!))
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        updateStatusItem()
        registerQuickChatShortcut()
    }
    private func makeWebView(_ frame: NSRect) -> WKWebView {
        let view = WKWebView(frame: frame, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        view.uiDelegate = self
        #if DEBUG
        view.isInspectable = true
        #endif
        return view
    }
    // The settings window is its own fixed-size window, and it keeps its web view
    // so reopening it does not repeat the Keychain authorization prompt.
    @objc private func openSettings() {
        if settingsWindow == nil {
            let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600), styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
            panel.title = localized("Settings")
            panel.titleVisibility = .hidden
            panel.titlebarAppearsTransparent = true
            panel.isReleasedWhenClosed = false
            panel.delegate = self
            panel.center()
            let view = makeWebView(panel.contentView!.bounds)
            panel.contentView = view
            view.load(URLRequest(url: URL(string: "muse://app/#/settings")!))
            settingsWebView = view
            settingsWindow = panel
        }
        settingsWindow?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
    private func trusted(_ message: WKScriptMessage) -> Bool {
        message.frameInfo.isMainFrame && message.frameInfo.securityOrigin.protocol == "muse" && message.frameInfo.securityOrigin.host == "app" && message.webView?.url?.scheme == "muse" && message.webView?.url?.host == "app"
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard trusted(message), let body = message.body as? [String: String]
        else { replyHandler(nil, "Untrusted credential request"); return }
        if message.name == "musePresence" { presence(body, from: message.webView, replyHandler: replyHandler); return }
        if message.name == "museComputer" { computerUse(body, from: message.webView, replyHandler: replyHandler); return }
        if message.name == "museDictation" { dictate(body, from: message.webView, replyHandler: replyHandler); return }
        if message.name == "museShortcut" { shortcut(body, replyHandler: replyHandler); return }
        // Keychain can wait for an OS authorization dialog. Never block AppKit
        // or discard the eventual reply while the user is deciding.
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            credentials(body) { value, error in
                DispatchQueue.main.async {
                    replyHandler(value, error)
                    // Both windows share one connection, so a credential change in
                    // either of them refreshes the other instead of going stale.
                    guard error == nil, body["operation"] == "write" else { return }
                    self.broadcast("muse-credentials-changed", except: message.webView)
                }
            }
        }
    }
    private func credentials(_ body: [String: String], replyHandler: @escaping (Any?, String?) -> Void) {
        guard body["namespace"] == nil || body["namespace"] == "background"
        else { replyHandler(nil, "Invalid credential namespace"); return }
        let base = body["namespace"] == "background"
            ? "app.openmuse.desktop.background.v1" : "app.openmuse.desktop.direct-ma.v1"
        let service = profile.map { "\(base).profile.\($0)" } ?? base
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "active"]
        if body["operation"] == "read" {
            var lookup = query
            lookup[kSecReturnData as String] = true
            lookup[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(lookup as CFDictionary, &result)
            if status == errSecItemNotFound { replyHandler("", nil); return }
            guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8)
            else { replyHandler(nil, localized("Cannot restore secure credentials")); return }
            replyHandler(value, nil)
        } else if body["operation"] == "write", let value = body["value"], value.utf8.count <= 65536 {
            var status: OSStatus
            if value.isEmpty {
                status = SecItemDelete(query as CFDictionary)
                if status == errSecItemNotFound { status = errSecSuccess }
            } else {
                let values: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
                status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
                if status == errSecItemNotFound { status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil) }
            }
            replyHandler(status == errSecSuccess ? true : nil, status == errSecSuccess ? nil : localized("Cannot save secure credentials"))
        } else { replyHandler(nil, "Invalid credential operation") }
    }
    // Desktop presence is a device-local window preference, not a credential, so
    // it lives in UserDefaults. The login item's state is read back from macOS
    // every time, because the user can change it in System Settings.
    private func startupState() -> String {
        switch SMAppService.mainApp.status {
        case .enabled: return "enabled"
        case .requiresApproval: return "requires-approval"
        case .notRegistered: return "not-registered"
        default: return "unavailable"
        }
    }
    private func presenceState() -> [String: Any] {
        ["startup": startupState(),
         "menuBar": UserDefaults.standard.bool(forKey: menuBarKey),
         "floatingButton": UserDefaults.standard.bool(forKey: floatingButtonKey)]
    }
    private func presence(_ body: [String: String], from sender: WKWebView?, replyHandler: @escaping (Any?, String?) -> Void) {
        switch body["operation"] {
        case "read":
            replyHandler(presenceState(), nil)
        case "login-items":
            SMAppService.openSystemSettingsLoginItems()
            replyHandler(presenceState(), nil)
        case "write":
            guard let value = body["value"], value == "true" || value == "false"
            else { replyHandler(nil, "Invalid presence value"); return }
            let on = value == "true"
            switch body["key"] {
            case "startup":
                do {
                    if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                } catch {
                    replyHandler(nil, localized("macOS did not change the login item."))
                    return
                }
            case "menuBar":
                UserDefaults.standard.set(on, forKey: menuBarKey)
                updateStatusItem()
            case "floatingButton":
                UserDefaults.standard.set(on, forKey: floatingButtonKey)
                updateFloatingButton()
            default:
                replyHandler(nil, "Invalid presence key"); return
            }
            replyHandler(presenceState(), nil)
            broadcast("muse-presence-changed", except: sender)
        default:
            replyHandler(nil, "Invalid presence operation")
        }
    }
    // Computer use is off until the user turns it on for this Mac. Only the
    // workspace window, where each call is approved, may run a tool.
    private let keepAwakeKey = "computerUse.keepAwake"
    private let blockedAppsKey = "computerUse.blockedApps"
    // Blocked apps are stored by bundle identifier with the name shown to the person.
    private var blockedApps: [[String: String]] {
        (UserDefaults.standard.array(forKey: blockedAppsKey) as? [[String: String]] ?? [])
            .filter { $0["id"] != nil && $0["name"] != nil }
    }
    private func computerState() -> [String: Any] {
        ["enabled": UserDefaults.standard.bool(forKey: computerKey),
         "accessibility": computer.accessibility,
         "screen": computer.screen,
         "keepAwake": UserDefaults.standard.bool(forKey: keepAwakeKey),
         "blocked": blockedApps]
    }
    private func chooseBlockedApp(for sender: WKWebView?, done: @escaping () -> Void) {
        let panel = NSOpenPanel()
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.allowedContentTypes = [.application]
        panel.allowsMultipleSelection = false
        panel.prompt = localized("Block")
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else { return }
            if response == .OK, let url = panel.url, let bundle = Bundle(url: url), let id = bundle.bundleIdentifier,
               id != Bundle.main.bundleIdentifier {
                let name = FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
                var apps = self.blockedApps.filter { $0["id"] != id }
                apps.append(["id": id, "name": name])
                UserDefaults.standard.set(apps, forKey: self.blockedAppsKey)
            }
            done()
        }
        if let host = sender?.window { panel.beginSheetModal(for: host, completionHandler: finish) }
        else { finish(panel.runModal()) }
    }
    private func computerUse(_ body: [String: String], from sender: WKWebView?, replyHandler: @escaping (Any?, String?) -> Void) {
        switch body["operation"] {
        case "status":
            replyHandler(computerState(), nil)
        case "enable":
            guard let value = body["value"], value == "true" || value == "false"
            else { replyHandler(nil, "Invalid computer use value"); return }
            UserDefaults.standard.set(value == "true", forKey: computerKey)
            replyHandler(computerState(), nil)
            broadcast("muse-computer-changed", except: sender)
        case "keep-awake":
            guard let value = body["value"], value == "true" || value == "false"
            else { replyHandler(nil, "Invalid computer use value"); return }
            UserDefaults.standard.set(value == "true", forKey: keepAwakeKey)
            replyHandler(computerState(), nil)
        case "block-app":
            chooseBlockedApp(for: sender) { [weak self] in
                guard let self else { return }
                replyHandler(self.computerState(), nil)
                self.broadcast("muse-computer-changed", except: sender)
            }
        case "unblock-app":
            guard let id = body["id"] else { replyHandler(nil, "Invalid app"); return }
            UserDefaults.standard.set(blockedApps.filter { $0["id"] != id }, forKey: blockedAppsKey)
            replyHandler(computerState(), nil)
            broadcast("muse-computer-changed", except: sender)
        case "request":
            let pane: String
            if body["kind"] == "accessibility" {
                computer.requestAccessibility()
                pane = "Privacy_Accessibility"
            } else if body["kind"] == "screen" {
                computer.requestScreen()
                pane = "Privacy_ScreenCapture"
            } else { replyHandler(nil, "Invalid permission"); return }
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") { NSWorkspace.shared.open(url) }
            replyHandler(computerState(), nil)
        case "run":
            guard sender === webView else { replyHandler(nil, "Only the workspace window runs computer use"); return }
            guard UserDefaults.standard.bool(forKey: computerKey)
            else { replyHandler(nil, localized("Computer use is off on this Mac.")); return }
            guard let tool = body["tool"], Computer.tools.contains(tool),
                  let raw = body["input"], raw.utf8.count <= 16384,
                  let data = raw.data(using: .utf8),
                  let input = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            else { replyHandler(nil, "Invalid computer use request"); return }
            computer.blocked = Set(blockedApps.compactMap { $0["id"] })
            computer.keepAwake = UserDefaults.standard.bool(forKey: keepAwakeKey)
            Task { @MainActor in
                let output = await computer.run(tool, input)
                replyHandler(["ok": output.ok, "text": output.text, "image": output.image ?? ""], nil)
            }
        default:
            replyHandler(nil, "Invalid computer use operation")
        }
    }
    // Dictation streams its text to the window that started it, as
    // muse-dictation events, until it is stopped or recognition ends.
    private func dictationState(_ language: String?) -> [String: Any] {
        ["microphone": Dictation.microphoneState(),
         "speech": Dictation.speechState(),
         "onDevice": Dictation.onDeviceSupported(language ?? "en-US"),
         "running": dictation.running]
    }
    private func sendDictation(_ detail: [String: Any]) {
        guard let view = dictationView,
              let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        view.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-dictation', {detail:\(json)}))", completionHandler: nil)
    }
    private func dictate(_ body: [String: String], from sender: WKWebView?, replyHandler: @escaping (Any?, String?) -> Void) {
        let language = body["language"].flatMap { $0.range(of: "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$", options: .regularExpression) != nil ? $0 : nil }
        switch body["operation"] {
        case "status":
            replyHandler(dictationState(language), nil)
        case "request":
            Dictation.requestAccess { [weak self] _ in
                Task { @MainActor in replyHandler(self?.dictationState(language), nil) }
            }
        case "start":
            guard sender === webView || sender === quickWebView else { replyHandler(nil, "Dictation is not available here"); return }
            dictationView = sender
            // Audio cues use the system's own sounds when listening starts and ends.
            let cues = body["cues"] == "true"
            dictation.onText = { [weak self] text, final in self?.sendDictation(["text": text, "final": final]) }
            dictation.onEnd = { [weak self] error in
                if cues { NSSound(named: "Pop")?.play() }
                var detail: [String: Any] = ["ended": true]
                if let error { detail["error"] = localized(error) }
                self?.sendDictation(detail)
            }
            if let error = dictation.start(language: language ?? "en-US") { replyHandler(nil, localized(error)); return }
            if cues { NSSound(named: "Tink")?.play() }
            replyHandler(dictationState(language), nil)
        case "stop":
            dictation.stop(cancel: body["cancel"] == "true")
            replyHandler(dictationState(language), nil)
        case "settings":
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") { NSWorkspace.shared.open(url) }
            replyHandler(dictationState(language), nil)
        default:
            replyHandler(nil, "Invalid dictation operation")
        }
    }
    private func updateStatusItem() {
        guard UserDefaults.standard.bool(forKey: menuBarKey) else {
            if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
            statusItem = nil
            return
        }
        guard statusItem == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Open Muse")
        image?.isTemplate = true
        item.button?.image = image
        let menu = NSMenu()
        let open = menu.addItem(withTitle: localized("Show Open Muse"), action: #selector(showWorkspace), keyEquivalent: "")
        open.target = self
        let quick = menu.addItem(withTitle: localized("Quick chat"), action: #selector(toggleQuickChat), keyEquivalent: " ")
        quick.keyEquivalentModifierMask = [.option]
        quick.target = self
        defer { updateQuickMenuItem() }
        menu.addItem(.separator())
        menu.addItem(withTitle: localized("Quit Open Muse"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        item.menu = menu
        statusItem = item
    }
    // The button stands in for the workspace window: it appears when that
    // window is closed or minimized and goes away as soon as it is back.
    private func updateFloatingButton() {
        let wanted = UserDefaults.standard.bool(forKey: floatingButtonKey)
            && window != nil && (!window.isVisible || window.isMiniaturized)
        if wanted {
            let panel = floatingPanel ?? makeFloatingPanel()
            floatingPanel = panel
            guard !panel.isVisible else { return }
            panel.alphaValue = 0
            panel.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { context in
                context.duration = Motion.fade
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().alphaValue = 1
            }
        } else if let panel = floatingPanel, panel.isVisible {
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = Motion.fade
                context.timingFunction = CAMediaTimingFunction(name: .easeIn)
                panel.animator().alphaValue = 0
            }, completionHandler: { [weak self] in
                guard let self, let panel = self.floatingPanel, panel.alphaValue == 0 else { return }
                panel.orderOut(nil)
            })
        }
    }
    private func makeFloatingPanel() -> NSPanel {
        let side: CGFloat = FloatingButtonView.diameter + 20
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: side, height: side), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        let view = FloatingButtonView(frame: NSRect(x: 0, y: 0, width: side, height: side))
        view.onOpen = { [weak self] in self?.showWorkspace() }
        panel.contentView = view
        if !panel.setFrameUsingName("OpenMuseFloatingButton"), let screen = NSScreen.main?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: screen.maxX - side - 16, y: screen.minY + 16))
        }
        panel.setFrameAutosaveName("OpenMuseFloatingButton")
        return panel
    }
    // Every window shares one connection; tell the others what changed.
    private func broadcast(_ event: String, except sender: WKWebView?) {
        for view in [webView, settingsWebView, quickWebView] where view != nil && view !== sender {
            view?.evaluateJavaScript("window.dispatchEvent(new Event('\(event)'))", completionHandler: nil)
        }
    }
    // Option-Space opens a small chat card over whatever app is in front, and
    // pressing it again closes the card. Carbon hot keys need no Accessibility
    // permission and never see other keystrokes.
    private func registerQuickChatShortcut() {
        quickChatToggle = { [weak self] in self?.toggleQuickChat() }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { quickChatToggle?() }
            return OSStatus(noErr)
        }, 1, &spec, nil, nil)
        quickShortcutRegistered = applyQuickChatShortcut()
    }
    // The shortcut is a device-local preference: a virtual key code plus Carbon
    // modifiers, Option-Space unless the person chose another one.
    private let quickKeyKey = "quickChat.keyCode"
    private let quickModifiersKey = "quickChat.modifiers"
    private static let shortcutModifiers = UInt32(cmdKey | optionKey | controlKey | shiftKey)
    private var quickShortcut: (code: UInt32, modifiers: UInt32) {
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: quickKeyKey) != nil else { return (UInt32(kVK_Space), UInt32(optionKey)) }
        return (UInt32(defaults.integer(forKey: quickKeyKey)), UInt32(defaults.integer(forKey: quickModifiersKey)))
    }
    private func applyQuickChatShortcut() -> Bool {
        if let quickHotKey { UnregisterEventHotKey(quickHotKey) }
        quickHotKey = nil
        let (code, modifiers) = quickShortcut
        let id = EventHotKeyID(signature: OSType(0x4F4D_5143), id: 1)
        let status = RegisterEventHotKey(code, modifiers, id, GetApplicationEventTarget(), 0, &quickHotKey)
        updateQuickMenuItem()
        return status == noErr
    }
    private func shortcutState() -> [String: Any] {
        let (code, modifiers) = quickShortcut
        return ["code": Int(code), "modifiers": Int(modifiers), "registered": quickShortcutRegistered]
    }
    private func shortcut(_ body: [String: String], replyHandler: @escaping (Any?, String?) -> Void) {
        switch body["operation"] {
        case "read":
            replyHandler(shortcutState(), nil)
        case "write":
            guard let code = body["code"].flatMap(Int.init), (0...127).contains(code),
                  let modifiers = body["modifiers"].flatMap(UInt32.init),
                  modifiers & ~Self.shortcutModifiers == 0,
                  modifiers & UInt32(cmdKey | optionKey | controlKey) != 0
            else { replyHandler(nil, "Invalid shortcut"); return }
            UserDefaults.standard.set(code, forKey: quickKeyKey)
            UserDefaults.standard.set(Int(modifiers), forKey: quickModifiersKey)
            quickShortcutRegistered = applyQuickChatShortcut()
            replyHandler(shortcutState(), nil)
        case "reset":
            UserDefaults.standard.removeObject(forKey: quickKeyKey)
            UserDefaults.standard.removeObject(forKey: quickModifiersKey)
            quickShortcutRegistered = applyQuickChatShortcut()
            replyHandler(shortcutState(), nil)
        default:
            replyHandler(nil, "Invalid shortcut operation")
        }
    }
    // The menu bar item shows the current shortcut when AppKit can draw it.
    private func updateQuickMenuItem() {
        guard let item = statusItem?.menu?.items.first(where: { $0.action == #selector(toggleQuickChat) }) else { return }
        let (code, modifiers) = quickShortcut
        let keys: [UInt32: String] = [UInt32(kVK_Space): " ", UInt32(kVK_Return): "\r", UInt32(kVK_Tab): "\t"]
        let letters = "asdfhgzxcv bqweryt123465=97-80]ou[ip lj'k;\\,/nm."
        var key = keys[code] ?? ""
        if key.isEmpty, code < letters.count {
            let character = letters[letters.index(letters.startIndex, offsetBy: Int(code))]
            if character != " " { key = String(character) }
        }
        item.keyEquivalent = key
        var mask: NSEvent.ModifierFlags = []
        if modifiers & UInt32(cmdKey) != 0 { mask.insert(.command) }
        if modifiers & UInt32(optionKey) != 0 { mask.insert(.option) }
        if modifiers & UInt32(controlKey) != 0 { mask.insert(.control) }
        if modifiers & UInt32(shiftKey) != 0 { mask.insert(.shift) }
        item.keyEquivalentModifierMask = mask
    }
    @objc private func toggleQuickChat() {
        if let panel = quickPanel, panel.isVisible, panel.alphaValue > 0 { hideQuickChat() } else { showQuickChat() }
    }
    private func makeQuickPanel() -> QuickPanel {
        let frame = NSRect(x: 0, y: 0, width: QuickChat.width, height: QuickChat.initialHeight)
        let panel = QuickPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.appearance = NSApplication.shared.appearance
        panel.delegate = self
        let container = NSView(frame: frame)
        container.wantsLayer = true
        container.layer?.cornerRadius = QuickChat.cornerRadius
        container.layer?.cornerCurve = .continuous
        container.layer?.masksToBounds = true
        container.layer?.borderWidth = 0.5
        container.layer?.borderColor = NSColor.separatorColor.cgColor
        let view = makeWebView(frame)
        container.addSubview(view)
        panel.contentView = container
        view.load(URLRequest(url: URL(string: "muse://app/#/quick")!))
        quickWebView = view
        return panel
    }
    private func showQuickChat() {
        let panel = quickPanel ?? makeQuickPanel()
        quickPanel = panel
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        guard let area = screen?.visibleFrame else { return }
        let height = panel.frame.height
        let top = area.maxY - area.height * QuickChat.topInset
        let target = NSRect(x: area.midX - QuickChat.width / 2, y: top - height, width: QuickChat.width, height: height)
        let reduced = Motion.reduced
        panel.setFrame(reduced ? target : target.offsetBy(dx: 0, dy: QuickChat.rise), display: false)
        panel.alphaValue = 0
        panel.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = reduced ? Motion.fade : Motion.appear
            context.timingFunction = reduced ? CAMediaTimingFunction(name: .easeOut) : Motion.settle
            panel.animator().alphaValue = 1
            if !reduced { panel.animator().setFrame(target, display: true) }
        }
        quickWebView?.evaluateJavaScript("window.dispatchEvent(new Event('muse-quick-shown'))", completionHandler: nil)
    }
    private func hideQuickChat() {
        guard let panel = quickPanel, panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = Motion.dismiss
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().alphaValue = 0
        }, completionHandler: {
            if panel.alphaValue == 0 { panel.orderOut(nil) }
        })
    }
    // The card asks for the height of its content; the top edge stays put so
    // the card grows downward as the conversation fills in.
    private func resizeQuickChat(_ value: String?) {
        guard let panel = quickPanel, let raw = value.flatMap(Double.init) else { return }
        let height = min(QuickChat.maxHeight, max(QuickChat.minHeight, CGFloat(raw)))
        var frame = panel.frame
        guard abs(frame.height - height) >= 1 else { return }
        frame.origin.y += frame.height - height
        frame.size.height = height
        guard panel.isVisible, !Motion.reduced else { panel.setFrame(frame, display: true); return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Motion.appear
            context.timingFunction = Motion.settle
            panel.animator().setFrame(frame, display: true)
        }
    }
    func windowDidResignKey(_ notification: Notification) {
        // Clicking anywhere else puts the card away, like the shortcut does.
        if let panel = quickPanel, (notification.object as? NSWindow) === panel { hideQuickChat() }
    }
    @objc private func showWorkspace() {
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        updateFloatingButton()
    }
    func windowWillClose(_ notification: Notification) {
        guard (notification.object as? NSWindow) === window else { return }
        DispatchQueue.main.async { self.updateFloatingButton() }
    }
    func windowDidMiniaturize(_ notification: Notification) {
        if (notification.object as? NSWindow) === window { updateFloatingButton() }
    }
    func windowDidDeminiaturize(_ notification: Notification) {
        if (notification.object as? NSWindow) === window { updateFloatingButton() }
    }
    func windowDidBecomeKey(_ notification: Notification) {
        if (notification.object as? NSWindow) === window { updateFloatingButton() }
    }
    // The web UI owns the preference; the shell only matches the window chrome,
    // native dialogs and the other window to it.
    private func applyAppearance(_ value: String?, from sender: WKWebView?) {
        let appearance: NSAppearance? = value == "dark"
            ? NSAppearance(named: .darkAqua)
            : value == "light" ? NSAppearance(named: .aqua) : nil
        guard value == "dark" || value == "light" || value == "system" else { return }
        NSApplication.shared.appearance = appearance
        window?.appearance = appearance
        settingsWindow?.appearance = appearance
        quickPanel?.appearance = appearance
        broadcast("muse-appearance-changed", except: sender)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard trusted(message) else { return }
        if message.name == "museWindow" {
            let body = message.body as? [String: String]
            if message.webView === quickWebView {
                switch body?["name"] {
                case "quick-size": resizeQuickChat(body?["value"]); return
                case "quick-close": hideQuickChat(); return
                case "quick-sent": webView?.evaluateJavaScript("window.dispatchEvent(new Event('muse-conversations-changed'))", completionHandler: nil); return
                case "workspace": hideQuickChat(); showWorkspace(); return
                case "settings": hideQuickChat()
                default: break
                }
            }
            if body?["name"] == "settings" {
                openSettings()
                // Open a named section; the settings route ignores anything else.
                if let section = body?["value"], section.range(of: "^[a-z-]{1,40}$", options: .regularExpression) != nil {
                    settingsWebView?.evaluateJavaScript("location.hash = '#/settings/\(section)'", completionHandler: nil)
                }
            }
            if body?["name"] == "appearance" { applyAppearance(body?["value"], from: message.webView) }
            return
        }
        guard message.name == "museExport", let value = message.body as? [String: String], let id = value["id"], let name = value["name"], let content = value["content"], content.utf8.count <= 20_000_000 else { return }
        // Answer the web view that asked, and sheet its own window, so a second
        // window never steals or loses another window's export result.
        guard let sender = message.webView, let host = sender.window else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = URL(fileURLWithPath: name).lastPathComponent
        panel.beginSheetModal(for: host) { [weak sender] response in
            var result: [String: Any] = ["id": id, "success": false, "cancelled": response != .OK]
            if response == .OK, let url = panel.url {
                do { try Data(content.utf8).write(to: url, options: .atomic); result["success"] = true } catch {}
            }
            if let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) {
                sender?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-export-result', {detail:\(json)}))", completionHandler: nil)
            }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "muse" && url.host == "app" { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated && ["https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    private func installMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: localized("About Open Muse"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settings = appMenu.addItem(withTitle: localized("Settings…"), action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: localized("Hide Open Muse"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: localized("Quit Open Muse"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let fileItem = NSMenuItem(title: localized("File"), action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: localized("File"))
        let newChat = fileMenu.addItem(withTitle: localized("New Side Chat"), action: #selector(newSideChat), keyEquivalent: "n")
        newChat.target = self
        fileMenu.addItem(withTitle: localized("Close Window"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu; menu.addItem(fileItem)
        let editItem = NSMenuItem(title: localized("Edit"), action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: localized("Edit"))
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] { editMenu.addItem(withTitle: localized(title), action: Selector(selector), keyEquivalent: key) }
        editItem.submenu = editMenu; menu.addItem(editItem)
        let viewItem = NSMenuItem(title: localized("View"), action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: localized("View"))
        let search = viewMenu.addItem(withTitle: localized("Search"), action: #selector(openSearch), keyEquivalent: "k")
        search.target = self
        let mainChat = viewMenu.addItem(withTitle: localized("Main Chat"), action: #selector(openMainChat), keyEquivalent: "1")
        mainChat.target = self
        viewItem.submenu = viewMenu; menu.addItem(viewItem)
        let windowItem = NSMenuItem(title: localized("Window"), action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: localized("Window"))
        windowMenu.addItem(withTitle: localized("Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: localized("Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu; menu.addItem(windowItem)
        NSApplication.shared.windowsMenu = windowMenu
        NSApplication.shared.mainMenu = menu
    }
    private func command(_ name: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: name, options: .fragmentsAllowed), let json = String(data: data, encoding: .utf8) else { return }
        window.makeKeyAndOrderFront(nil)
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-command', {detail:\(json)}))", completionHandler: nil)
    }
    @objc private func newSideChat() { command("new-chat") }
    @objc private func openSearch() { command("search") }
    @objc private func openMainChat() { command("main-chat") }
    private func confirmDiscard(_ completion: @escaping (Bool) -> Void) {
        guard !discardPromptOpen else { completion(false); return }
        webView.evaluateJavaScript("({dirty: Boolean(window.__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__), saving: Boolean(window.__OPEN_MUSE_DOCUMENT_SAVING__)})") { [weak self] result, error in
            guard let self else { completion(false); return }
            // Fail closed when the document state cannot be checked.
            guard error == nil else { completion(false); return }
            guard let state = result as? [String: Bool] else { completion(false); return }
            guard state["dirty"] == true else { completion(true); return }
            guard !self.discardPromptOpen else { completion(false); return }
            self.discardPromptOpen = true
            let alert = NSAlert()
            if state["saving"] == true {
                alert.messageText = localized("The document is still being saved.")
                alert.informativeText = localized("Wait for MA to confirm the result before closing the workspace.")
                alert.addButton(withTitle: localized("Keep Open"))
                alert.beginSheetModal(for: self.window) { _ in
                    self.discardPromptOpen = false
                    completion(false)
                }
                return
            }
            alert.messageText = localized("This document has unsaved changes.")
            alert.informativeText = localized("Keep editing to save your work, or discard the draft. The saved cloud document will not be changed.")
            alert.addButton(withTitle: localized("Keep Editing"))
            alert.addButton(withTitle: localized("Discard Draft"))
            alert.beginSheetModal(for: self.window) { response in
                self.discardPromptOpen = false
                guard response == .alertSecondButtonReturn else { completion(false); return }
                self.webView.evaluateJavaScript("window.dispatchEvent(new Event('muse-discard-document'))") { _, error in
                    completion(error == nil)
                }
            }
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        // Only the workspace window holds an editable document.
        guard sender === window else { return true }
        if closingApproved { return true }
        confirmDiscard { [weak self] allowed in
            guard let self, allowed else { return }
            self.closingApproved = true
            sender.performClose(nil)
            self.closingApproved = false
        }
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        confirmDiscard { allowed in sender.reply(toApplicationShouldTerminate: allowed) }
        return .terminateLater
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWorkspace() }
        return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
