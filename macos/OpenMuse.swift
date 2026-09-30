import AppKit
import WebKit
import Security
import UniformTypeIdentifiers

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
final class OpenMuseApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let assets = BundleAssets()

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
        configuration.userContentController.addUserScript(WKUserScript(source: "window.__OPEN_MUSE_DESKTOP__ = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        webView.isInspectable = true
        #endif
        window.contentView = webView
        webView.load(URLRequest(url: URL(string: "muse://app/")!))
        window.makeKeyAndOrderFront(nil)
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
                DispatchQueue.main.async { replyHandler(value, error) }
            }
        }
    }
    private func credentials(_ body: [String: String], replyHandler: @escaping (Any?, String?) -> Void) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.openmuse.desktop.direct-ma.v1", kSecAttrAccount as String: "active"]
        if body["operation"] == "read" {
            var lookup = query
            lookup[kSecReturnData as String] = true
            lookup[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(lookup as CFDictionary, &result)
            if status == errSecItemNotFound { replyHandler("", nil); return }
            guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8)
            else { replyHandler(nil, "Cannot restore secure credentials"); return }
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
            replyHandler(status == errSecSuccess ? true : nil, status == errSecSuccess ? nil : "Cannot save secure credentials")
        } else { replyHandler(nil, "Invalid credential operation") }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard trusted(message), message.name == "museExport", let value = message.body as? [String: String], let id = value["id"], let name = value["name"], let content = value["content"], content.utf8.count <= 20_000_000 else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = URL(fileURLWithPath: name).lastPathComponent
        panel.beginSheetModal(for: window) { [weak self] response in
            var result: [String: Any] = ["id": id, "success": false, "cancelled": response != .OK]
            if response == .OK, let url = panel.url {
                do { try Data(content.utf8).write(to: url, options: .atomic); result["success"] = true } catch {}
            }
            if let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) {
                self?.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-export-result', {detail:\(json)}))", completionHandler: nil)
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
        appMenu.addItem(withTitle: "About Open Muse", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settings = appMenu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Open Muse", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Open Muse", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let fileItem = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: "File")
        let newChat = fileMenu.addItem(withTitle: "New Side Chat", action: #selector(newSideChat), keyEquivalent: "n")
        newChat.target = self
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu; menu.addItem(fileItem)
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] { editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key) }
        editItem.submenu = editMenu; menu.addItem(editItem)
        let viewItem = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "View")
        let search = viewMenu.addItem(withTitle: "Search", action: #selector(openSearch), keyEquivalent: "k")
        search.target = self
        let mainChat = viewMenu.addItem(withTitle: "Main Chat", action: #selector(openMainChat), keyEquivalent: "1")
        mainChat.target = self
        viewItem.submenu = viewMenu; menu.addItem(viewItem)
        let windowItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu; menu.addItem(windowItem)
        NSApplication.shared.windowsMenu = windowMenu
        NSApplication.shared.mainMenu = menu
    }
    private func command(_ name: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: name, options: .fragmentsAllowed), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-command', {detail:\(json)}))", completionHandler: nil)
    }
    @objc private func openSettings() { command("settings") }
    @objc private func newSideChat() { command("new-chat") }
    @objc private func openSearch() { command("search") }
    @objc private func openMainChat() { command("main-chat") }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
