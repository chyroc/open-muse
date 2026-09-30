import AppKit
import WebKit
import Security

// Native window with an embedded BFF. Secrets never appear in the URL; external links open in the system browser.
@main
final class OpenMuseApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var output = Data()
    private var startupTimer: Timer?
    private var port = 0
    private var accessToken = ""
    private let keychainService = "app.openmuse.desktop"

    static func main() {
        let app = NSApplication.shared
        let delegate = OpenMuseApp()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 830), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Open Muse"
        window.minSize = NSSize(width: 720, height: 580)
        window.backgroundColor = NSColor(red: 0.965, green: 0.961, blue: 0.941, alpha: 1)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        let label = NSTextField(labelWithString: "Starting Open Muse…")
        label.alignment = .center
        label.frame = NSRect(x: 0, y: 360, width: 1180, height: 36)
        label.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        window.contentView?.addSubview(label)
        startService()
    }

    private func startService() {
        guard let resources = Bundle.main.resourceURL else { fail("App resources are missing; rebuild the app."); return }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { fail("Could not generate a local access token."); return }
        accessToken = Data(bytes).base64EncodedString()
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Open Muse", isDirectory: true)
        let task = Process()
        task.executableURL = resources.appendingPathComponent("node")
        task.arguments = [resources.appendingPathComponent("app/server.cjs").path]
        task.currentDirectoryURL = resources.appendingPathComponent("app")
        // Do not inherit shell credentials such as NODE_OPTIONS or ARK_API_KEY; demo mode by default, switched per user after login.
        task.environment = ["PATH": "/usr/bin:/bin", "MUSE_MODE": "demo", "HOST": "127.0.0.1", "MUSE_ACCESS_TOKEN": accessToken, "MUSE_DATA_DIR": support.path, "NODE_ENV": "production"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.readServiceOutput(data) }
        }
        task.terminationHandler = { [weak self] _ in DispatchQueue.main.async { if NSApplication.shared.isRunning { self?.fail("The local service stopped. Quit and reopen Open Muse.")} } }
        do { try task.run(); server = task }
        catch { fail("Could not start the local service; rebuild the Mac app."); return }
        startupTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            if self?.port == 0 { self?.fail("The local service timed out during startup; check permissions on the app data directory and reopen.") }
        }
    }

    private func readServiceOutput(_ data: Data) {
        guard port == 0 else { return }
        output.append(data)
        guard output.count < 65536 else { fail("Unexpected startup response from the local service."); return }
        while let end = output.firstIndex(of: 10) {
            let line = output.prefix(upTo: end)
            output.removeSubrange(...end)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any], value["ready"] as? Bool == true, let assignedPort = value["port"] as? Int, assignedPort > 0 && assignedPort < 65536 else { continue }
            port = assignedPort
            startupTimer?.invalidate()
            showWebApp()
        }
    }

    private func showWebApp() {
        let origin = "http://127.0.0.1:\(port)"
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "museSession")
        configuration.userContentController.add(self, name: "museExport")
        configuration.userContentController.addUserScript(bootstrapScript())
        webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true
        window.contentView = webView
        webView.load(URLRequest(url: URL(string: origin)!))
    }

    private func bootstrapScript() -> WKUserScript {
        let origin = "http://127.0.0.1:\(port)"
        let stored = keychainRead()
        let values: [String: String] = ["muse.access": accessToken, "muse.sso:\(origin)": stored]
        let json = String(data: try! JSONSerialization.data(withJSONObject: values), encoding: .utf8)!
        let script = "if(location.origin === '\(origin)') { for (const [k,v] of Object.entries(\(json))) { if(v) sessionStorage.setItem(k,v); } window.__OPEN_MUSE_DESKTOP__ = true; }"
        return WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == port else { return }
        if message.name == "museSession", let token = message.body as? String, token.count <= 128 {
            keychainWrite(token)
            webView.configuration.userContentController.removeAllUserScripts()
            webView.configuration.userContentController.addUserScript(bootstrapScript())
        }
        if message.name == "museExport", let value = message.body as? [String: String], let id = value["id"], let name = value["name"], let content = value["content"], content.utf8.count <= 20_000_000 {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = URL(fileURLWithPath: name).lastPathComponent
            panel.beginSheetModal(for: window) { [weak self] response in
                var result: [String: Any] = ["id": id, "success": false, "cancelled": response != .OK]
                if response == .OK, let url = panel.url {
                    do { try Data(content.utf8).write(to: url, options: .atomic); result["success"] = true } catch { result["success"] = false }
                }
                if let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) {
                    self?.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-export-result', {detail:\(json)}))", completionHandler: nil)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.host == "127.0.0.1" && url.port == port && url.scheme == "http" { decisionHandler(.allow); return }
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

    private func keychainRead() -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: "local-sso", kSecReturnData as String: true]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    private func keychainWrite(_ token: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: "local-sso"]
        if token.isEmpty { SecItemDelete(query as CFDictionary); return }
        let attributes = [kSecValueData as String: Data(token.utf8)]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            var create = query
            create.merge(attributes) { _, new in new }
            create[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(create as CFDictionary, nil)
        }
    }

    private func fail(_ message: String) {
        startupTimer?.invalidate()
        let label = NSTextField(wrappingLabelWithString: message)
        label.alignment = .center
        label.frame = NSRect(x: 60, y: 260, width: max(500, window.frame.width - 120), height: 100)
        let view = NSView(frame: window.contentView!.bounds)
        view.addSubview(label)
        window.contentView = view
    }

    private func installMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Open Muse", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Open Muse", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] { editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key) }
        editItem.submenu = editMenu; menu.addItem(editItem)
        NSApplication.shared.mainMenu = menu
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { server?.terminationHandler = nil; server?.terminate() }
}
