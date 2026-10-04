import AppKit
import Carbon.HIToolbox
import CryptoKit
import EventKit
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
              // Standardize the root too: standardizing drops a leading /private,
              // so an app opened from /private/tmp would otherwise fail the prefix check.
              let root = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true).standardizedFileURL
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

// The pages draw under a transparent title bar, so the web view covers it. The
// page asks to move the window when an empty part of its top strip is pressed;
// the view keeps that press so the window can follow the pointer from it.
final class WindowWebView: WKWebView {
    // The page's drag strip along the top edge (titleStripHeight in
    // ui/windowDrag.ts). Like a title bar, it answers the click that brings an
    // inactive window forward, so the window can be dragged right away; the
    // rest of the page keeps the usual activate-first behavior.
    static let titleStripHeight: CGFloat = 52
    private(set) var lastMouseDown: NSEvent?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        guard let event, event.window === window else { return super.acceptsFirstMouse(for: event) }
        let point = convert(event.locationInWindow, from: nil)
        let fromTop = isFlipped ? point.y : bounds.height - point.y
        return fromTop <= Self.titleStripHeight || super.acceptsFirstMouse(for: event)
    }
    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }
    // Moves the window with the pointer while the press that began it is held.
    func dragWindow() {
        guard let event = lastMouseDown, let window, event.window === window,
              NSEvent.pressedMouseButtons & 1 != 0 else { return }
        // The page answers a moment after the press, so first catch the window
        // up with any distance the pointer has already travelled.
        let pressed = window.convertPoint(toScreen: event.locationInWindow)
        let now = NSEvent.mouseLocation
        let origin = window.frame.origin
        window.setFrameOrigin(NSPoint(x: origin.x + now.x - pressed.x, y: origin.y + now.y - pressed.y))
        window.performDrag(with: event)
    }
    // A double click on the strip does what the system's title-bar setting asks.
    func titleBarDoubleClick() {
        guard let window else { return }
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
        case "Minimize": window.miniaturize(nil)
        case "None": break
        default: if window.styleMask.contains(.resizable) { window.zoom(nil) }
        }
    }
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

// Quick chat geometry. The panel is clear: the page draws the 416-point card,
// its shadow and the portrait on its top edge inside the panel's margins, and
// reports the height it needs inside these bounds (QUICK_* in ui/QuickChat.tsx).
private enum QuickChat {
    static let width: CGFloat = 520
    static let initialHeight: CGFloat = 204
    static let minHeight: CGFloat = 204
    static let maxHeight: CGFloat = 720
    // The panel's bottom edge sits this far above the bottom of the visible
    // screen, and the card grows upward from there.
    static let bottomInset: CGFloat = 40
    static let rise: CGFloat = 10
}

// A borderless panel that can take typing without activating the app, so the
// app in front keeps its place.
private final class QuickPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// Carbon delivers the global shortcut to a C callback, which forwards it here.
nonisolated(unsafe) private var hotKeyAction: ((UInt32, Bool) -> Void)?

// A dark pill that stays on screen while the workspace window is closed: the
// companion's portrait, its name, and what it is doing while it replies. It
// follows the pointer while dragged, and a press that did not move reopens the
// window on release. Press and hover answer immediately with a spring.
private final class FloatingButtonView: NSView {
    var onOpen: (() -> Void)?
    var onResize: ((NSSize) -> Void)?
    var onDrop: (([URL]) -> Void)?
    private let bubble = CALayer()
    private let icon = CALayer()
    private let title = CATextLayer()
    private let detail = CATextLayer()
    private var pressOrigin: NSPoint?
    private var windowOrigin: NSPoint = .zero
    private var dragging = false
    private var hovering = false
    private var name = "Muse"
    private var state = ""
    private var dropping = false
    static let height: CGFloat = 46
    static let portrait: CGFloat = 38
    static let margin: CGFloat = 10

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = false
        bubble.backgroundColor = NSColor(calibratedWhite: 0.17, alpha: 0.96).cgColor
        bubble.borderColor = NSColor(calibratedWhite: 1, alpha: 0.12).cgColor
        bubble.borderWidth = 1
        bubble.cornerRadius = Self.height / 2
        bubble.shadowColor = NSColor.black.cgColor
        bubble.shadowOpacity = 0.25
        bubble.shadowRadius = 8
        bubble.shadowOffset = CGSize(width: 0, height: -2)
        let side = Self.portrait
        icon.bounds = CGRect(x: 0, y: 0, width: side, height: side)
        icon.cornerRadius = side / 2
        icon.masksToBounds = true
        icon.contentsGravity = .resizeAspectFill
        icon.backgroundColor = NSColor(calibratedWhite: 0.95, alpha: 1).cgColor
        var rect = CGRect(x: 0, y: 0, width: side * 2, height: side * 2)
        icon.contents = Self.portraitImage(side: side).cgImage(forProposedRect: &rect, context: nil, hints: nil)
        for text in [title, detail] {
            text.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
            text.truncationMode = .end
        }
        title.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        title.fontSize = 15
        title.foregroundColor = NSColor.white.cgColor
        detail.font = NSFont.systemFont(ofSize: 11, weight: .regular)
        detail.fontSize = 11
        detail.foregroundColor = NSColor(calibratedWhite: 1, alpha: 0.65).cgColor
        bubble.addSublayer(icon)
        bubble.addSublayer(title)
        bubble.addSublayer(detail)
        layer?.addSublayer(bubble)
        setAccessibilityRole(.button)
        setAccessibilityLabel(localized("Show Open Muse"))
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
        // Files dropped on the pill open the chat with them attached.
        registerForDraggedTypes([.fileURL])
        layoutPill()
    }
    required init?(coder: NSCoder) { nil }

    // The companion as the workspace draws it (a 43 by 48 figure), close up on
    // a light disc.
    static func portraitImage(side: CGFloat) -> NSImage {
        NSImage(size: NSSize(width: side, height: side), flipped: true) { bounds in
            NSColor(calibratedWhite: 0.95, alpha: 1).setFill()
            NSBezierPath(ovalIn: bounds).fill()
            // A close-up: the head and shoulders fill the disc.
            let scale = bounds.width / 54 * 1.5
            let transform = NSAffineTransform()
            transform.translateX(by: bounds.midX - 21.5 * scale, yBy: bounds.midY - 24 * scale + 7 * scale)
            transform.scale(by: scale)
            transform.concat()
            func color(_ hex: UInt32) -> NSColor {
                NSColor(calibratedRed: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
            }
            func arm(_ rect: NSRect, _ degrees: CGFloat) {
                NSGraphicsContext.saveGraphicsState()
                let turn = NSAffineTransform()
                turn.translateX(by: rect.midX, yBy: rect.midY)
                turn.rotate(byDegrees: degrees)
                turn.translateX(by: -rect.midX, yBy: -rect.midY)
                turn.concat()
                color(0xd6c8a7).setFill()
                NSBezierPath(ovalIn: rect).fill()
                NSGraphicsContext.restoreGraphicsState()
            }
            arm(NSRect(x: 4, y: 21, width: 7, height: 20), 15)
            arm(NSRect(x: 36, y: 21, width: 7, height: 20), -17)
            color(0xd7c9a9).setFill()
            NSBezierPath(roundedRect: NSRect(x: 13, y: 38, width: 8, height: 9), xRadius: 4, yRadius: 4).fill()
            NSBezierPath(roundedRect: NSRect(x: 24, y: 38, width: 8, height: 9), xRadius: 4, yRadius: 4).fill()
            let body = NSBezierPath(roundedRect: NSRect(x: 8, y: 3, width: 29, height: 40), xRadius: 13, yRadius: 16)
            NSGradient(starting: color(0xf0e7d2), ending: color(0xd8cbae))?.draw(in: body, angle: 20)
            let face = NSBezierPath(roundedRect: NSRect(x: 12, y: 9, width: 21, height: 18), xRadius: 9, yRadius: 8)
            NSGradient(starting: color(0xf7eccf), ending: color(0xecdbb4))?.draw(in: face, angle: 90)
            color(0x493f2d).setFill()
            NSBezierPath(ovalIn: NSRect(x: 17, y: 17, width: 2, height: 3)).fill()
            NSBezierPath(ovalIn: NSRect(x: 26, y: 17, width: 2, height: 3)).fill()
            let mouth = NSBezierPath()
            mouth.move(to: NSPoint(x: 21, y: 21.5))
            mouth.curve(to: NSPoint(x: 25, y: 21.5), controlPoint1: NSPoint(x: 22, y: 23), controlPoint2: NSPoint(x: 24, y: 23))
            mouth.lineWidth = 1
            color(0x86684a).setStroke()
            mouth.stroke()
            return true
        }
    }

    // The companion's name, and what it is doing ("" while idle).
    func show(name: String, state: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.name = name.isEmpty ? "Muse" : String(name.prefix(24))
        self.state = state
        layoutPill()
    }

    private func fileURLs(_ info: NSDraggingInfo) -> [URL] {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        return (info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL] ?? [])
            .filter { !$0.hasDirectoryPath }
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard !fileURLs(sender).isEmpty else { return [] }
        dropping = true
        layoutPill()
        settle(Motion.hoverScale)
        return .copy
    }
    override func draggingExited(_ sender: NSDraggingInfo?) {
        dropping = false
        layoutPill()
        settle(hovering ? Motion.hoverScale : 1)
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = fileURLs(sender)
        dropping = false
        layoutPill()
        settle(1)
        guard !urls.isEmpty else { return false }
        onDrop?(urls)
        return true
    }

    static func size(name: String, state: String) -> NSSize {
        let width = max(
            (name as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 15, weight: .semibold)]).width,
            (state as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 11)]).width,
            (localized("Drop files") as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 11)]).width)
        let pill = 4 + portrait + 10 + min(ceil(width), 160) + 18
        return NSSize(width: pill + margin * 2, height: height + margin * 2)
    }

    private func layoutPill() {
        let size = Self.size(name: name, state: state)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let pill = CGRect(x: 0, y: 0, width: size.width - Self.margin * 2, height: Self.height)
        bubble.bounds = pill
        bubble.position = CGPoint(x: size.width / 2, y: size.height / 2)
        bubble.shadowPath = CGPath(roundedRect: pill, cornerWidth: Self.height / 2, cornerHeight: Self.height / 2, transform: nil)
        icon.position = CGPoint(x: 4 + Self.portrait / 2, y: Self.height / 2)
        let textX = 4 + Self.portrait + 10
        let textWidth = pill.width - textX - 14
        let state = dropping ? localized("Drop files") : self.state
        title.string = name
        detail.string = state
        if state.isEmpty {
            title.frame = CGRect(x: textX, y: (Self.height - 20) / 2, width: textWidth, height: 20)
            detail.frame = .zero
        } else {
            title.frame = CGRect(x: textX, y: Self.height / 2 - 2, width: textWidth, height: 19)
            detail.frame = CGRect(x: textX, y: Self.height / 2 - 16, width: textWidth, height: 14)
        }
        CATransaction.commit()
        setAccessibilityValue(state.isEmpty ? nil : state)
        if frame.size != size { onResize?(size) }
    }
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
    private var companionName = "Muse"
    private var companionState = ""
    private var quickPanel: QuickPanel?
    private var quickWebView: WKWebView?
    private var hotKeyRefs: [String: EventHotKeyRef] = [:]
    private var hotKeyRegistered: [String: Bool] = [:]
    // Dictation asked for by a shortcut before the Quick Chat page was ready.
    private var quickReady = false
    private var pendingQuickDictation: String?
    private let menuBarKey = "presence.menuBar"
    private let computerKey = "computerUse.enabled"
    private let computer = Computer()
    // Calendar and Reminders are a local connector with their own switch,
    // separate from computer use, and read only.
    private let calendarKey = "connectors.calendar.enabled"
    private let calendar = LocalCalendar()
    private let locationKey = "connectors.location.enabled"
    private let location = LocalLocation()
    private let dictation = Dictation()
    // Read aloud reports back to the window that asked.
    private let speaker = Speaker()
    private weak var speechView: WKWebView?
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
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "museSpeech")
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
        // The Mac's own name, so the account's device list can show it.
        if let data = try? JSONSerialization.data(withJSONObject: ["name": Host.current().localizedName ?? "Mac"]),
           let device = String(data: data, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__OPEN_MUSE_DEVICE__ = \(device);",
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        // The macOS version, for the diagnostics a person may copy into a report.
        if let data = try? JSONSerialization.data(withJSONObject: "macOS \(ProcessInfo.processInfo.operatingSystemVersionString)", options: .fragmentsAllowed),
           let system = String(data: data, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__OPEN_MUSE_SYSTEM__ = \(system);",
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        // The page gets the system's own list: an app language picked in
        // Settings is stored for this app and would otherwise hide it.
        let systemLanguages = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain)?["AppleLanguages"] as? [String]
        if let data = try? JSONSerialization.data(withJSONObject: systemLanguages ?? Locale.preferredLanguages),
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
        registerHotKeys()
        #if SNAPSHOT_TOUR
        startSnapshotTour()
        #endif
    }
    private func makeWebView(_ frame: NSRect) -> WKWebView {
        let view = WindowWebView(frame: frame, configuration: configuration)
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
    @objc private func openSettings() { showSettings(section: nil) }
    // The standard About window, naming the commit the app was built from.
    @objc private func showAbout() {
        var options: [NSApplication.AboutPanelOptionKey: Any] = [:]
        if let commit = Bundle.main.object(forInfoDictionaryKey: "OpenMuseCommit") as? String, !commit.isEmpty {
            options[.applicationVersion] = commit
            options[.version] = ""
        }
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: options)
    }
    // A section is a route name already checked by the caller. A window made
    // now loads straight into it; an existing one switches to it.
    private func showSettings(section: String?) {
        let route = section.map { "#/settings/\($0)" } ?? "#/settings"
        if let view = settingsWebView, section != nil {
            view.evaluateJavaScript("location.hash = '\(route)'", completionHandler: nil)
        }
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
            view.load(URLRequest(url: URL(string: "muse://app/\(route)")!))
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
        if message.name == "museSpeech" { speech(body, from: message.webView, replyHandler: replyHandler); return }
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
        case "reset":
            // Only the settings window resets, after the page removed the
            // saved logins and its own records.
            guard sender === settingsWebView else { replyHandler(nil, "Only Settings resets this Mac"); return }
            replyHandler(true, nil)
            DispatchQueue.main.async { self.resetDevice() }
        default:
            replyHandler(nil, "Invalid presence operation")
        }
    }
    // Returns the app on this Mac to first launch: every preference it keeps,
    // the login item and all web data go, and the windows start over. macOS
    // privacy permissions stay in System Settings, as after a reinstall, and
    // nothing in the cloud changes.
    private func resetDevice() {
        dictation.stop(cancel: true)
        speaker.stop()
        hideQuickChat()
        if SMAppService.mainApp.status == .enabled { try? SMAppService.mainApp.unregister() }
        if let domain = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: domain) }
        NSApp.dockTile.badgeLabel = nil
        applyAppearance("system", from: nil)
        updateStatusItem()
        updateFloatingButton()
        applyHotKeys()
        settingsWindow?.close()
        settingsWindow = nil
        settingsWebView = nil
        let store = configuration.websiteDataStore
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
            guard let self else { return }
            self.quickWebView?.reload()
            self.webView.load(URLRequest(url: URL(string: "muse://app/")!))
            self.showWorkspace()
        }
    }
    // Computer use is off until the user turns it on for this Mac. Only the
    // workspace window, where each call is approved, may run a tool.
    private let keepAwakeKey = "computerUse.keepAwake"
    // How computer control calls are answered: ask each time (the default),
    // always allow or always deny. It never covers Calendar or Location.
    private let policyKey = "computerUse.policy"
    private var computerPolicy: String {
        let value = UserDefaults.standard.string(forKey: policyKey) ?? "ask"
        return ["ask", "allow", "deny"].contains(value) ? value : "ask"
    }
    private let blockedAppsKey = "computerUse.blockedApps"
    private let blockedFoldersKey = "computerUse.blockedFolders"
    private var blockedFolders: [String] {
        (UserDefaults.standard.array(forKey: blockedFoldersKey) as? [String] ?? []).filter { $0.hasPrefix("/") }
    }
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
         "blocked": blockedApps,
         "fullDiskAccess": computer.fullDiskAccess,
         "blockedFolders": blockedFolders,
         "policy": computerPolicy,
         "calendar": ["enabled": UserDefaults.standard.bool(forKey: calendarKey),
                      "events": LocalCalendar.state(.event),
                      "reminders": LocalCalendar.state(.reminder)],
         "location": ["enabled": UserDefaults.standard.bool(forKey: locationKey),
                      "permission": location.state]]
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
    // The real icons of the apps behind the connectors in Settings, from the
    // apps installed on this Mac. Only this fixed list is looked up, and an app
    // that is not installed is left out so the page keeps its own glyph.
    private static let connectorApps: [String: [String]] = [
        "lark": ["com.electron.lark", "com.larksuite.larkApp", "com.bytedance.lark"],
        "browser": ["com.google.Chrome"],
        "files": ["com.apple.Terminal"],
        "calendar": ["com.apple.iCal"],
        "location": ["com.apple.Maps"],
    ]
    private var connectorIcons: [String: String]?
    private func appIcons() -> [String: String] {
        if let cached = connectorIcons { return cached }
        var icons: [String: String] = [:]
        func encode(_ image: NSImage) -> String? {
            let side = 64
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8,
                                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            image.draw(in: NSRect(x: 0, y: 0, width: side, height: side))
            NSGraphicsContext.restoreGraphicsState()
            return rep.representation(using: .png, properties: [:]).map { "data:image/png;base64," + $0.base64EncodedString() }
        }
        for (id, bundles) in Self.connectorApps {
            guard let url = bundles.lazy.compactMap({ NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }).first
            else { continue }
            icons[id] = encode(NSWorkspace.shared.icon(forFile: url.path))
        }
        if let mac = NSImage(named: NSImage.computerName) { icons["mac"] = encode(mac) }
        connectorIcons = icons
        return icons
    }
    private func computerUse(_ body: [String: String], from sender: WKWebView?, replyHandler: @escaping (Any?, String?) -> Void) {
        switch body["operation"] {
        case "status":
            replyHandler(computerState(), nil)
        case "app-icons":
            replyHandler(appIcons(), nil)
        case "enable":
            guard let value = body["value"], value == "true" || value == "false"
            else { replyHandler(nil, "Invalid computer use value"); return }
            UserDefaults.standard.set(value == "true", forKey: computerKey)
            replyHandler(computerState(), nil)
            broadcast("muse-computer-changed", except: sender)
        case "calendar-enable":
            guard let value = body["value"], value == "true" || value == "false"
            else { replyHandler(nil, "Invalid calendar value"); return }
            UserDefaults.standard.set(value == "true", forKey: calendarKey)
            replyHandler(computerState(), nil)
            broadcast("muse-computer-changed", except: sender)
        case "calendar-request":
            // macOS asks only once; after that the choice lives in System Settings.
            let type: EKEntityType
            switch body["kind"] {
            case "events": type = .event
            case "reminders": type = .reminder
            default: replyHandler(nil, "Invalid permission"); return
            }
            if LocalCalendar.state(type) == "not-asked" {
                calendar.request(type) { [weak self] in
                    Task { @MainActor in
                        guard let self else { return }
                        replyHandler(self.computerState(), nil)
                        self.broadcast("muse-computer-changed", except: sender)
                    }
                }
                return
            }
            let pane = type == .event ? "Privacy_Calendars" : "Privacy_Reminders"
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") { NSWorkspace.shared.open(url) }
            replyHandler(computerState(), nil)
        case "location-enable":
            guard let value = body["value"], value == "true" || value == "false"
            else { replyHandler(nil, "Invalid location value"); return }
            UserDefaults.standard.set(value == "true", forKey: locationKey)
            replyHandler(computerState(), nil)
            broadcast("muse-computer-changed", except: sender)
        case "location-request":
            if location.state == "not-asked" {
                location.request { [weak self] in
                    guard let self else { return }
                    replyHandler(self.computerState(), nil)
                    self.broadcast("muse-computer-changed", except: sender)
                }
                return
            }
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices") { NSWorkspace.shared.open(url) }
            replyHandler(computerState(), nil)
        case "policy":
            guard let value = body["value"], ["ask", "allow", "deny"].contains(value)
            else { replyHandler(nil, "Invalid computer use policy"); return }
            UserDefaults.standard.set(value, forKey: policyKey)
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
        case "block-folder":
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.prompt = localized("Block")
            let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
                guard let self else { return }
                if response == .OK, let url = panel.url?.standardizedFileURL.resolvingSymlinksInPath() {
                    UserDefaults.standard.set(Array(Set(self.blockedFolders + [url.path])).sorted(), forKey: self.blockedFoldersKey)
                }
                replyHandler(self.computerState(), nil)
            }
            if let host = sender?.window { panel.beginSheetModal(for: host, completionHandler: finish) }
            else { finish(panel.runModal()) }
        case "unblock-folder":
            guard let path = body["path"] else { replyHandler(nil, "Invalid folder"); return }
            UserDefaults.standard.set(blockedFolders.filter { $0 != path }, forKey: blockedFoldersKey)
            replyHandler(computerState(), nil)
        case "full-disk-access":
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") { NSWorkspace.shared.open(url) }
            replyHandler(computerState(), nil)
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
            if body["tool"] == LocalLocation.tool {
                guard UserDefaults.standard.bool(forKey: locationKey)
                else { replyHandler(nil, localized("Location is off on this Mac.")); return }
                Task { @MainActor in
                    let output = await location.run()
                    replyHandler(["ok": output.ok, "text": output.text, "image": ""], nil)
                }
                return
            }
            if body["tool"] == LocalCalendar.tool {
                guard UserDefaults.standard.bool(forKey: calendarKey)
                else { replyHandler(nil, localized("Calendar and Reminders are off on this Mac.")); return }
                guard let raw = body["input"], raw.utf8.count <= 16384,
                      let data = raw.data(using: .utf8),
                      let input = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                else { replyHandler(nil, "Invalid calendar request"); return }
                Task { @MainActor in
                    let output = await calendar.run(input)
                    replyHandler(["ok": output.ok, "text": output.text, "image": ""], nil)
                }
                return
            }
            guard UserDefaults.standard.bool(forKey: computerKey)
            else { replyHandler(nil, localized("Computer use is off on this Mac.")); return }
            guard let tool = body["tool"], Computer.tools.contains(tool),
                  let raw = body["input"], raw.utf8.count <= 16384,
                  let data = raw.data(using: .utf8),
                  let input = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            else { replyHandler(nil, "Invalid computer use request"); return }
            computer.blocked = Set(blockedApps.compactMap { $0["id"] })
            computer.blockedFolders = blockedFolders
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
    private let dictationDeviceKey = "dictation.inputDevice"
    private func dictationState(_ language: String?) -> [String: Any] {
        ["microphone": Dictation.microphoneState(),
         "speech": Dictation.speechState(),
         "onDevice": Dictation.onDeviceSupported(language ?? "en-US"),
         "running": dictation.running,
         "device": UserDefaults.standard.string(forKey: dictationDeviceKey) ?? "",
         "devices": Dictation.inputDevices().map { ["id": $0.uid, "name": $0.name] }]
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
            // The microphone must not hear the Mac reading aloud.
            speaker.stop()
            // Audio cues use the system's own sounds when listening starts and ends.
            let cues = body["cues"] == "true"
            dictation.onText = { [weak self] text, final in self?.sendDictation(["text": text, "final": final]) }
            dictation.onEnd = { [weak self] error in
                if cues { NSSound(named: "Pop")?.play() }
                var detail: [String: Any] = ["ended": true]
                if let error { detail["error"] = localized(error) }
                self?.sendDictation(detail)
            }
            let device = UserDefaults.standard.string(forKey: dictationDeviceKey) ?? ""
            if let error = dictation.start(language: language ?? "en-US", device: device) { replyHandler(nil, localized(error)); return }
            if cues { NSSound(named: "Tink")?.play() }
            replyHandler(dictationState(language), nil)
        case "stop":
            dictation.stop(cancel: body["cancel"] == "true")
            replyHandler(dictationState(language), nil)
        case "device":
            // Empty means the system input; otherwise only a microphone that exists now.
            let device = body["device"] ?? ""
            guard device.isEmpty || Dictation.inputDevices().contains(where: { $0.uid == device })
            else { replyHandler(nil, "Invalid dictation operation"); return }
            if device.isEmpty { UserDefaults.standard.removeObject(forKey: dictationDeviceKey) }
            else { UserDefaults.standard.set(device, forKey: dictationDeviceKey) }
            replyHandler(dictationState(language), nil)
        case "settings":
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") { NSWorkspace.shared.open(url) }
            replyHandler(dictationState(language), nil)
        default:
            replyHandler(nil, "Invalid dictation operation")
        }
    }
    private func speech(_ body: [String: String], from sender: WKWebView?, replyHandler: @escaping (Any?, String?) -> Void) {
        switch body["operation"] {
        case "speak":
            guard let text = body["text"], !text.isEmpty, text.utf16.count <= 20_000,
                  let id = body["id"], id.range(of: "^[A-Za-z0-9_-]{1,200}$", options: .regularExpression) != nil
            else { replyHandler(nil, "Invalid speech request"); return }
            let language = body["language"].flatMap {
                $0.range(of: "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$", options: .regularExpression) != nil ? $0 : nil
            } ?? "en-US"
            speaker.onEnd = { [weak self] id, finished in
                guard let data = try? JSONSerialization.data(withJSONObject: ["id": id, "finished": finished]),
                      let json = String(data: data, encoding: .utf8) else { return }
                self?.speechView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-speech', {detail:\(json)}))", completionHandler: nil)
            }
            speaker.speak(text, language: language, id: id)
            speechView = sender
            replyHandler(true, nil)
        case "stop":
            speaker.stop()
            replyHandler(true, nil)
        default:
            replyHandler(nil, "Invalid speech operation")
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
        let size = FloatingButtonView.size(name: companionName, state: companionState)
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        let view = FloatingButtonView(frame: NSRect(origin: .zero, size: size))
        view.onOpen = { [weak self] in self?.showWorkspace() }
        view.onDrop = { [weak self] urls in self?.openChat(with: urls) }
        // The pill grows and shrinks with its text and keeps its left edge.
        view.onResize = { [weak self, weak panel] size in
            guard let panel else { return }
            panel.setContentSize(size)
            self?.keepOnScreen(panel)
        }
        panel.contentView = view
        if !panel.setFrameUsingName("OpenMuseFloatingButton"), let screen = NSScreen.main?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: screen.maxX - size.width - 16, y: screen.minY + 16))
        }
        panel.setFrameAutosaveName("OpenMuseFloatingButton")
        panel.setContentSize(size)
        keepOnScreen(panel)
        view.show(name: companionName, state: companionState)
        view.toolTip = quickShortcutTip()
        return panel
    }
    // Files dropped on the pill: the window opens on the main chat, which
    // stages them under the same checks as a drop on the composer. Only small
    // regular files are read; the page rejects anything else it is given.
    private func openChat(with urls: [URL]) {
        showWorkspace()
        var files: [[String: String]] = []
        for url in urls.prefix(4) {
            guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .typeIdentifierKey]),
                  values.isRegularFile == true, (values.fileSize ?? .max) <= 10 * 1024 * 1024,
                  let data = try? Data(contentsOf: url) else { continue }
            let type = values.typeIdentifier.flatMap { UTType($0)?.preferredMIMEType } ?? ""
            files.append(["name": url.lastPathComponent, "type": type, "data": data.base64EncodedString()])
        }
        guard !files.isEmpty, let json = try? JSONSerialization.data(withJSONObject: files),
              let text = String(data: json, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-dropped-files', {detail:\(text)}))", completionHandler: nil)
    }
    // A restored or resized pill stays wholly on its screen.
    private func keepOnScreen(_ panel: NSPanel) {
        guard let screen = (panel.screen ?? NSScreen.main)?.visibleFrame else { return }
        var origin = panel.frame.origin
        origin.x = min(max(origin.x, screen.minX), screen.maxX - panel.frame.width)
        origin.y = min(max(origin.y, screen.minY), screen.maxY - panel.frame.height)
        if origin != panel.frame.origin { panel.setFrameOrigin(origin) }
    }
    // "Press ⌥ Space to start a chat", in the shortcut Quick Chat listens for.
    private func quickShortcutTip() -> String {
        let (code, modifiers) = quickShortcut
        var keys = ""
        if modifiers & UInt32(controlKey) != 0 { keys += "⌃" }
        if modifiers & UInt32(optionKey) != 0 { keys += "⌥" }
        if modifiers & UInt32(shiftKey) != 0 { keys += "⇧" }
        if modifiers & UInt32(cmdKey) != 0 { keys += "⌘" }
        let named: [UInt32: String] = [UInt32(kVK_Space): localized("Space"), UInt32(kVK_Return): "↩", UInt32(kVK_Tab): "⇥"]
        let letters = "asdfhgzxcv bqweryt123465=97-80]ou[ip lj'k;\\,/nm."
        var key = named[code] ?? ""
        if key.isEmpty, code < letters.count {
            key = String(letters[letters.index(letters.startIndex, offsetBy: Int(code))]).uppercased()
        }
        return String(format: localized("Press %@ to start a chat"), "\(keys) \(key)")
    }
    // The workspace reports the companion's name and what it is doing, for the
    // pill shown while the window is closed.
    private func updateCompanion(name: String, state: String) {
        companionName = name
        companionState = state
        (floatingPanel?.contentView as? FloatingButtonView)?.show(name: name, state: state)
    }
    // Every window shares one connection; tell the others what changed.
    private func broadcast(_ event: String, except sender: WKWebView?) {
        for view in [webView, settingsWebView, quickWebView] where view != nil && view !== sender {
            view?.evaluateJavaScript("window.dispatchEvent(new Event('\(event)'))", completionHandler: nil)
        }
    }
    // Option-Space opens a small chat card over whatever app is in front, and
    // pressing it again closes the card. The dictation shortcuts speak into that
    // card: push to talk listens while held, hands-free starts and stops on each
    // press. Carbon hot keys need no Accessibility permission and never see
    // other keystrokes.
    private func registerHotKeys() {
        hotKeyAction = { [weak self] id, pressed in self?.hotKeyFired(id, pressed: pressed) }
        var specs = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var key = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &key)
            let pressed = GetEventKind(event) == UInt32(kEventHotKeyPressed)
            let id = key.id
            DispatchQueue.main.async { hotKeyAction?(id, pressed) }
            return OSStatus(noErr)
        }, 2, &specs, nil, nil)
        applyHotKeys()
    }
    private func hotKeyFired(_ id: UInt32, pressed: Bool) {
        switch id {
        case Self.hotKeys["quickChat"]?.id: if pressed { toggleQuickChat() }
        case Self.hotKeys["dictationHold"]?.id: quickDictate(pressed ? "start" : "stop")
        case Self.hotKeys["dictationToggle"]?.id: if pressed { quickDictate("toggle") }
        default: break
        }
    }
    private func quickDictate(_ action: String) {
        if action != "stop", !(quickPanel?.isVisible == true && (quickPanel?.alphaValue ?? 0) > 0) { showQuickChat() }
        guard let view = quickWebView, quickReady else {
            // Released before the card was ready: nothing was heard.
            pendingQuickDictation = action == "stop" && pendingQuickDictation == "start" ? nil : action
            return
        }
        view.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-quick-dictate', {detail:'\(action)'}))", completionHandler: nil)
    }
    // Shortcuts are device-local preferences: a virtual key code plus Carbon
    // modifiers. Quick Chat is Option-Space unless the person chose another
    // one; the dictation shortcuts are unset until recorded.
    private struct HotKey {
        let id: UInt32
        let codeKey: String
        let modifiersKey: String
        let fallback: (code: UInt32, modifiers: UInt32)?
    }
    private static let hotKeys: [String: HotKey] = [
        "quickChat": HotKey(id: 1, codeKey: "quickChat.keyCode", modifiersKey: "quickChat.modifiers",
                            fallback: (UInt32(kVK_Space), UInt32(optionKey))),
        "dictationHold": HotKey(id: 2, codeKey: "dictation.holdKeyCode", modifiersKey: "dictation.holdModifiers", fallback: nil),
        "dictationToggle": HotKey(id: 3, codeKey: "dictation.toggleKeyCode", modifiersKey: "dictation.toggleModifiers", fallback: nil),
    ]
    private static let shortcutModifiers = UInt32(cmdKey | optionKey | controlKey | shiftKey)
    private func hotKey(_ name: String) -> (code: UInt32, modifiers: UInt32)? {
        guard let slot = Self.hotKeys[name] else { return nil }
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: slot.codeKey) != nil else { return slot.fallback }
        return (UInt32(defaults.integer(forKey: slot.codeKey)), UInt32(defaults.integer(forKey: slot.modifiersKey)))
    }
    private var quickShortcut: (code: UInt32, modifiers: UInt32) {
        hotKey("quickChat") ?? (UInt32(kVK_Space), UInt32(optionKey))
    }
    private func applyHotKey(_ name: String) {
        guard let slot = Self.hotKeys[name] else { return }
        if let ref = hotKeyRefs[name] { UnregisterEventHotKey(ref) }
        hotKeyRefs[name] = nil
        var registered = false
        if let keys = hotKey(name) {
            var ref: EventHotKeyRef?
            let id = EventHotKeyID(signature: OSType(0x4F4D_5143), id: slot.id)
            if RegisterEventHotKey(keys.code, keys.modifiers, id, GetApplicationEventTarget(), 0, &ref) == noErr, let ref {
                hotKeyRefs[name] = ref
                registered = true
            }
        }
        hotKeyRegistered[name] = registered
        if name == "quickChat" { updateQuickMenuItem(); floatingPanel?.contentView?.toolTip = quickShortcutTip() }
    }
    private func applyHotKeys() {
        for name in Self.hotKeys.keys.sorted() { applyHotKey(name) }
    }
    private func shortcutState(_ name: String) -> [String: Any] {
        let keys = hotKey(name)
        return ["code": keys.map { Int($0.code) } ?? -1,
                "modifiers": keys.map { Int($0.modifiers) } ?? 0,
                "registered": hotKeyRegistered[name] ?? false]
    }
    private func shortcut(_ body: [String: String], replyHandler: @escaping (Any?, String?) -> Void) {
        let name = body["id"] ?? "quickChat"
        guard let slot = Self.hotKeys[name] else { replyHandler(nil, "Invalid shortcut"); return }
        switch body["operation"] {
        case "read":
            replyHandler(shortcutState(name), nil)
        case "write":
            guard let code = body["code"].flatMap(Int.init), (0...127).contains(code),
                  let modifiers = body["modifiers"].flatMap(UInt32.init),
                  modifiers & ~Self.shortcutModifiers == 0,
                  modifiers & UInt32(cmdKey | optionKey | controlKey) != 0
            else { replyHandler(nil, "Invalid shortcut"); return }
            // One combination belongs to one Open Muse shortcut.
            let taken = Self.hotKeys.keys.contains { other in
                other != name && hotKey(other).map { $0.code == UInt32(code) && $0.modifiers == modifiers } == true
            }
            if taken { replyHandler(nil, localized("Another Open Muse shortcut already uses these keys.")); return }
            UserDefaults.standard.set(code, forKey: slot.codeKey)
            UserDefaults.standard.set(Int(modifiers), forKey: slot.modifiersKey)
            applyHotKey(name)
            replyHandler(shortcutState(name), nil)
        case "reset":
            UserDefaults.standard.removeObject(forKey: slot.codeKey)
            UserDefaults.standard.removeObject(forKey: slot.modifiersKey)
            applyHotKey(name)
            replyHandler(shortcutState(name), nil)
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
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.appearance = NSApplication.shared.appearance
        panel.delegate = self
        let view = makeWebView(frame)
        // The page is see-through around the card.
        view.setValue(false, forKey: "drawsBackground")
        view.underPageBackgroundColor = .clear
        panel.contentView = view
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
        let target = NSRect(x: area.midX - QuickChat.width / 2, y: area.minY + QuickChat.bottomInset, width: QuickChat.width, height: height)
        let reduced = Motion.reduced
        panel.setFrame(reduced ? target : target.offsetBy(dx: 0, dy: -QuickChat.rise), display: false)
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
    // The card asks for the height of its content; the bottom edge stays put
    // so the card grows upward as the conversation fills in.
    private func resizeQuickChat(_ value: String?) {
        guard let panel = quickPanel, let raw = value.flatMap(Double.init) else { return }
        let height = min(QuickChat.maxHeight, max(QuickChat.minHeight, CGFloat(raw)))
        var frame = panel.frame
        guard abs(frame.height - height) >= 1 else { return }
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
            // Any window's page may move or zoom its own window, never another.
            if let view = message.webView as? WindowWebView {
                if body?["name"] == "window-drag" { view.dragWindow(); return }
                if body?["name"] == "window-zoom" { view.titleBarDoubleClick(); return }
            }
            if message.webView === quickWebView {
                switch body?["name"] {
                case "quick-size": resizeQuickChat(body?["value"]); return
                case "quick-close": hideQuickChat(); return
                case "quick-ready":
                    quickReady = true
                    if let action = pendingQuickDictation {
                        pendingQuickDictation = nil
                        quickDictate(action)
                    }
                    return
                case "quick-sent": webView?.evaluateJavaScript("window.dispatchEvent(new Event('muse-conversations-changed'))", completionHandler: nil); return
                case "workspace": hideQuickChat(); showWorkspace(); return
                case "settings": hideQuickChat()
                default: break
                }
            }
            // Settings can hand a draft to the main chat; it is never sent from here.
            if body?["name"] == "draft", message.webView === settingsWebView,
               let text = body?["value"], !text.isEmpty, text.utf16.count <= 16000,
               let data = try? JSONSerialization.data(withJSONObject: text, options: .fragmentsAllowed),
               let json = String(data: data, encoding: .utf8) {
                showWorkspace()
                webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('muse-draft', {detail:\(json)}))", completionHandler: nil)
                return
            }
            if body?["name"] == "settings" {
                // Open a named section; the settings route ignores anything else.
                let section = body?["value"].flatMap { $0.range(of: "^[a-z-]{1,40}$", options: .regularExpression) != nil ? $0 : nil }
                showSettings(section: section)
            }
            if body?["name"] == "appearance" { applyAppearance(body?["value"], from: message.webView) }
            // Settings picked the app language: menus and dialogs follow it from
            // the next launch, and every page reloads in it now.
            if body?["name"] == "language", message.webView === settingsWebView {
                switch body?["value"] {
                case "en": UserDefaults.standard.set(["en"], forKey: "AppleLanguages")
                case "zh-CN": UserDefaults.standard.set(["zh-Hans"], forKey: "AppleLanguages")
                case "system": UserDefaults.standard.removeObject(forKey: "AppleLanguages")
                default: return
                }
                for view in [webView, settingsWebView, quickWebView] { view?.reload() }
            }
            // The workspace names the companion and says whether it is thinking
            // or speaking; anything else reads as idle.
            if body?["name"] == "companion", message.webView === webView {
                let state: String
                switch body?["state"] {
                case "thinking": state = localized("Thinking")
                case "speaking": state = localized("Speaking")
                default: state = ""
                }
                updateCompanion(name: body?["value"] ?? "", state: state)
            }
            // Only the workspace counts unread replies; the label is a short count.
            if body?["name"] == "badge", message.webView === webView {
                let label = body?["value"] ?? ""
                guard label.isEmpty || label.range(of: "^[1-9][0-9]?\\+?$", options: .regularExpression) != nil else { return }
                NSApp.dockTile.badgeLabel = label.isEmpty ? nil : label
            }
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
        let about = appMenu.addItem(withTitle: localized("About Open Muse"), action: #selector(showAbout), keyEquivalent: "")
        about.target = self
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

#if SNAPSHOT_TOUR
// Acceptance builds only (OPEN_MUSE_SNAPSHOT_TOUR=1). With --snapshot-tour <dir>
// the app renders each page, settings section and Quick Chat in both
// appearances into PNGs from the web views' own snapshots, then quits. It needs
// no screen recording permission and never clicks, types or sends anything.
extension OpenMuseApp {
    static let tourPages = ["chat", "feed", "ideas", "goals", "library"]
    static let tourSections = [
        "general", "connectors", "computer-use", "file-system", "dictation", "wallet",
        "secure-storage", "permissions", "message-channels", "devices", "data-controls",
        "help", "legal",
    ]

    func startSnapshotTour() {
        let arguments = CommandLine.arguments
        guard let index = arguments.firstIndex(of: "--snapshot-tour"), index + 1 < arguments.count else { return }
        let folder = URL(fileURLWithPath: arguments[index + 1], isDirectory: true)
        Task { @MainActor in
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            var log: [String] = []
            await tourPause(4)
            for appearance in ["light", "dark"] {
                await tourScript(webView, "localStorage.setItem('muse.appearance', '\(appearance)'); true")
                applyAppearance(appearance, from: nil)
                await tourPause(0.8)
                for page in Self.tourPages {
                    await tourScript(webView, "location.hash = '#/\(page == "chat" ? "" : page)'; true")
                    await tourPause(1.2)
                    log.append(await tourSnapshot(webView, folder, "\(appearance)-workspace-\(page)"))
                    if await tourScrollEnd(webView) != nil {
                        log.append(await tourSnapshot(webView, folder, "\(appearance)-workspace-\(page)-end"))
                    }
                }
                openSettings()
                await tourPause(3)
                for section in Self.tourSections {
                    await tourScript(settingsWebView, "location.hash = '#/settings/\(section)'; true")
                    await tourPause(1.2)
                    log.append(await tourSnapshot(settingsWebView, folder, "\(appearance)-settings-\(section)"))
                    if await tourScrollEnd(settingsWebView) != nil {
                        log.append(await tourSnapshot(settingsWebView, folder, "\(appearance)-settings-\(section)-end"))
                    }
                }
                settingsWindow?.orderOut(nil)
                showQuickChat()
                await tourPause(2.5)
                log.append(await tourSnapshot(quickWebView, folder, "\(appearance)-quick-chat"))
                hideQuickChat()
                await tourPause(0.6)
            }
            await tourScript(webView, "localStorage.removeItem('muse.appearance'); true")
            applyAppearance("system", from: nil)
            let report = log.joined(separator: "\n") + "\n"
            try? report.write(to: folder.appendingPathComponent("tour.txt"), atomically: true, encoding: .utf8)
            NSApplication.shared.terminate(nil)
        }
    }

    private func tourPause(_ seconds: Double) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    private func tourScript(_ view: WKWebView?, _ script: String) async {
        guard let view else { return }
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            view.evaluateJavaScript(script) { _, _ in done.resume() }
        }
    }

    // A page taller than its window is also captured scrolled to the end, so
    // content below the first screen is seen too. Returns nil when nothing
    // scrolls; the next route starts from the top again.
    private func tourScrollEnd(_ view: WKWebView?) async -> Bool? {
        guard let view else { return nil }
        let script = """
        (() => {
          const scrollers = [document.scrollingElement, ...document.querySelectorAll("*")].filter((node) =>
            node && node.scrollHeight > node.clientHeight + 8 &&
            (node === document.scrollingElement || /auto|scroll/.test(getComputedStyle(node).overflowY)));
          scrollers.forEach((node) => { node.scrollTop = node.scrollHeight; });
          return scrollers.length > 0;
        })()
        """
        let scrolled: Bool = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
            view.evaluateJavaScript(script) { value, _ in done.resume(returning: (value as? Bool) ?? false) }
        }
        guard scrolled else { return nil }
        await tourPause(0.8)
        return true
    }

    private func tourSnapshot(_ view: WKWebView?, _ folder: URL, _ name: String) async -> String {
        guard let view else { return "\(name): no view" }
        let image: NSImage? = await withCheckedContinuation { (done: CheckedContinuation<NSImage?, Never>) in
            view.takeSnapshot(with: nil) { image, _ in done.resume(returning: image) }
        }
        guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:])
        else { return "\(name): snapshot failed" }
        do {
            try png.write(to: folder.appendingPathComponent("\(name).png"))
            return "\(name): ok"
        } catch {
            return "\(name): \(error.localizedDescription)"
        }
    }
}
#endif
