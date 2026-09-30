import AppKit
import WebKit
import Security
import UniformTypeIdentifiers

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

    static func main() {
        let app = NSApplication.shared
        let delegate = OpenMuseApp()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
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
        configuration.setURLSchemeHandler(assets, forURLScheme: "muse")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "museCredentials")
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
        // Keychain can wait for an OS authorization dialog. Never block AppKit
        // or discard the eventual reply while the user is deciding.
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            credentials(body) { value, error in
                DispatchQueue.main.async {
                    replyHandler(value, error)
                    // Both windows share one connection, so a credential change in
                    // either of them refreshes the other instead of going stale.
                    guard error == nil, body["operation"] == "write" else { return }
                    let other = message.webView === self.webView ? self.settingsWebView : self.webView
                    other?.evaluateJavaScript("window.dispatchEvent(new Event('muse-credentials-changed'))", completionHandler: nil)
                }
            }
        }
    }
    private func credentials(_ body: [String: String], replyHandler: @escaping (Any?, String?) -> Void) {
        guard body["namespace"] == nil || body["namespace"] == "background"
        else { replyHandler(nil, "Invalid credential namespace"); return }
        let service = body["namespace"] == "background"
            ? "app.openmuse.desktop.background.v1" : "app.openmuse.desktop.direct-ma.v1"
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
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard trusted(message) else { return }
        if message.name == "museWindow" {
            if (message.body as? [String: String])?["name"] == "settings" { openSettings() }
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
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
