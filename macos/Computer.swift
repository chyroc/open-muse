import AppKit
import ApplicationServices
import Carbon.HIToolbox
import IOKit.pwr_mgt
import ScreenCaptureKit

// Runs the mac_* custom tools on this Mac. Every entry point checks the macOS
// permission it needs and reports a refusal as a result instead of guessing.
// Coordinates are pixels of the latest screenshot, origin at the top left.
@MainActor
final class Computer {
    struct Output {
        var ok: Bool
        var text: String
        var image: String?
    }
    static let tools: Set<String> = ["mac_screenshot", "mac_action", "mac_open", "mac_apps"]
    // Screenshots are scaled down to this width before they leave the Mac.
    static let maxImageWidth: CGFloat = 1366
    // Time for the screen to settle before the follow-up screenshot.
    static let settleDelay: UInt64 = 600_000_000
    private var pointsPerPixel: CGFloat = 1
    private var shotSize: CGSize = .zero
    // Apps the person blocked: never shown, listed, opened or acted on.
    var blocked: Set<String> = []
    // Folders the person blocked: nothing inside them is opened.
    var blockedFolders: [String] = []
    // Keeps the display awake while the assistant is working, and a minute after.
    var keepAwake = false
    private var awake: IOPMAssertionID = 0
    private var awakeUntil = Date.distantPast

    var accessibility: Bool { AXIsProcessTrusted() }
    var screen: Bool { CGPreflightScreenCaptureAccess() }

    func requestAccessibility() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }
    func requestScreen() { _ = CGRequestScreenCaptureAccess() }
    // Full Disk Access cannot be queried directly; reading a file only it
    // unlocks is the accepted check, and nothing read is kept.
    var fullDiskAccess: Bool {
        let probe = NSHomeDirectory() + "/Library/Application Support/com.apple.TCC/TCC.db"
        return FileManager.default.isReadableFile(atPath: probe)
    }

    func run(_ tool: String, _ input: [String: Any]) async -> Output {
        if keepAwake { holdAwake() }
        switch tool {
        case "mac_screenshot": return await screenshot([:])
        case "mac_apps": return apps()
        case "mac_open": return await open(input["target"] as? String ?? "")
        case "mac_action": return await act(input)
        default: return failure("This Mac does not provide \(tool).")
        }
    }

    private func holdAwake() {
        awakeUntil = Date().addingTimeInterval(60)
        guard awake == 0 else { return }
        let reason = "Your assistant is using this Mac" as CFString
        guard IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                                          IOPMAssertionLevel(kIOPMAssertionLevelOn), reason, &awake) == kIOReturnSuccess
        else { awake = 0; return }
        Task { @MainActor in
            while Date() < self.awakeUntil { try? await Task.sleep(nanoseconds: 5_000_000_000) }
            IOPMAssertionRelease(self.awake)
            self.awake = 0
        }
    }
    private func isBlocked(_ app: NSRunningApplication?) -> Bool {
        guard let id = app?.bundleIdentifier else { return false }
        return blocked.contains(id)
    }

    private func json(_ value: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return "{\"ok\":false}" }
        return text
    }
    private func failure(_ message: String) -> Output {
        Output(ok: false, text: json(["ok": false, "error": message]))
    }

    private func screenshot(_ note: [String: Any]) async -> Output {
        guard screen else { return failure("Screen Recording is off for Open Muse, so it cannot see this Mac's screen.") }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            let main = CGMainDisplayID()
            guard let display = content.displays.first(where: { $0.displayID == main }) ?? content.displays.first
            else { return failure("No display is available.") }
            let scale = min(1, Self.maxImageWidth / CGFloat(display.width))
            let config = SCStreamConfiguration()
            config.width = max(1, Int(CGFloat(display.width) * scale))
            config.height = max(1, Int(CGFloat(display.height) * scale))
            config.showsCursor = true
            let hidden = content.applications.filter { blocked.contains($0.bundleIdentifier) }
            let filter = SCContentFilter(display: display, excludingApplications: hidden, exceptingWindows: [])
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            pointsPerPixel = CGFloat(display.width) / CGFloat(config.width)
            shotSize = CGSize(width: config.width, height: config.height)
            guard let data = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.7])
            else { return failure("The screenshot could not be encoded.") }
            var info = note
            info["ok"] = true
            info["width"] = config.width
            info["height"] = config.height
            let front = NSWorkspace.shared.frontmostApplication
            info["frontmost_app"] = isBlocked(front) ? "" : front?.localizedName ?? ""
            if !hidden.isEmpty { info["note"] = "Apps the person blocked are hidden from this screenshot." }
            return Output(ok: true, text: json(info), image: data.base64EncodedString())
        } catch {
            return failure("The screen could not be captured.")
        }
    }

    private func apps() -> Output {
        let visible = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && !isBlocked($0) }
        let running = visible.compactMap(\.localizedName)
        let pids = Set(visible.map(\.processIdentifier))
        let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        // Window titles are only readable with Screen Recording; owners always are.
        let windows: [[String: Any]] = info
            .filter { ($0[kCGWindowLayer as String] as? Int) == 0 }
            .filter { pids.contains(($0[kCGWindowOwnerPID as String] as? Int32) ?? -1) }
            .prefix(40)
            .map { window in
                var row: [String: Any] = ["app": window[kCGWindowOwnerName as String] as? String ?? ""]
                if let title = window[kCGWindowName as String] as? String, !title.isEmpty { row["title"] = title }
                return row
            }
        return Output(ok: true, text: json([
            "ok": true,
            "frontmost_app": isBlocked(NSWorkspace.shared.frontmostApplication) ? "" : NSWorkspace.shared.frontmostApplication?.localizedName ?? "",
            "apps": running,
            "windows": windows,
        ]))
    }

    private func open(_ target: String) async -> Output {
        let value = target.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 2048 else { return failure("Name an app, a web address or a file path.") }
        if let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
            return NSWorkspace.shared.open(url)
                ? Output(ok: true, text: json(["ok": true, "opened": value]))
                : failure("The address could not be opened.")
        }
        if value.hasPrefix("/") {
            let url = URL(fileURLWithPath: value).standardizedFileURL.resolvingSymlinksInPath()
            if blockedFolders.contains(where: { url.path == $0 || url.path.hasPrefix($0 + "/") }) {
                return failure("The person blocked this folder for their assistant.")
            }
            guard FileManager.default.fileExists(atPath: url.path) else { return failure("No file exists at that path.") }
            return NSWorkspace.shared.open(url)
                ? Output(ok: true, text: json(["ok": true, "opened": url.path]))
                : failure("The file could not be opened.")
        }
        guard !value.contains("/") else { return failure("Name an app, a web address or a file path.") }
        let name = value.lowercased().hasSuffix(".app") ? value : value + ".app"
        let folders = ["/Applications", "/System/Applications", "/Applications/Utilities",
                       "/System/Applications/Utilities", NSHomeDirectory() + "/Applications"]
        for folder in folders {
            let url = URL(fileURLWithPath: folder).appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            if let id = Bundle(url: url)?.bundleIdentifier, blocked.contains(id) {
                return failure("The person blocked this app for their assistant.")
            }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            do {
                _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
                return Output(ok: true, text: json(["ok": true, "opened": url.deletingPathExtension().lastPathComponent]))
            } catch {
                return failure("The app could not be opened.")
            }
        }
        return failure("No app named \(value) was found on this Mac.")
    }

    private func point(_ input: [String: Any], _ x: String, _ y: String) -> CGPoint? {
        guard shotSize != .zero,
              let px = (input[x] as? NSNumber)?.doubleValue,
              let py = (input[y] as? NSNumber)?.doubleValue,
              px >= 0, py >= 0, px <= shotSize.width, py <= shotSize.height
        else { return nil }
        return CGPoint(x: px * pointsPerPixel, y: py * pointsPerPixel)
    }
    private func post(_ event: CGEvent?) { event?.post(tap: .cghidEventTap) }

    private func act(_ input: [String: Any]) async -> Output {
        guard accessibility else { return failure("Accessibility is off for Open Muse, so it cannot control this Mac.") }
        guard !isBlocked(NSWorkspace.shared.frontmostApplication)
        else { return failure("The app in front is blocked for the assistant. Ask the person to switch apps.") }
        guard let action = input["action"] as? String else { return failure("Choose an action.") }
        let source = CGEventSource(stateID: .hidSystemState)
        let needsPoint = "Take a screenshot first, then give x and y inside it."
        switch action {
        case "click", "double_click", "right_click", "move":
            guard let at = point(input, "x", "y") else { return failure(needsPoint) }
            post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: at, mouseButton: .left))
            guard action != "move" else { break }
            let right = action == "right_click"
            let button: CGMouseButton = right ? .right : .left
            for count in 1...(action == "double_click" ? 2 : 1) {
                for type in right ? [CGEventType.rightMouseDown, .rightMouseUp] : [.leftMouseDown, .leftMouseUp] {
                    let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: at, mouseButton: button)
                    event?.setIntegerValueField(.mouseEventClickState, value: Int64(count))
                    post(event)
                }
            }
        case "drag":
            guard let from = point(input, "x", "y"), let to = point(input, "to_x", "to_y") else { return failure(needsPoint) }
            post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left))
            for step in 1...12 {
                let t = CGFloat(step) / 12
                let at = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
                post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: at, mouseButton: .left))
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
            post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left))
        case "scroll":
            let amount = (input["amount"] as? NSNumber)?.intValue ?? 0
            guard amount != 0, abs(amount) <= 50 else { return failure("Scroll by 1 to 50 lines; positive scrolls down.") }
            if let at = point(input, "x", "y") {
                post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: at, mouseButton: .left))
            }
            post(CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 1, wheel1: Int32(-amount), wheel2: 0, wheel3: 0))
        case "type":
            guard let text = input["text"] as? String, !text.isEmpty, text.count <= 2000
            else { return failure("Give 1 to 2000 characters to type.") }
            let units = Array(text.utf16)
            var index = 0
            while index < units.count {
                var chunk = Array(units[index..<min(index + 16, units.count)])
                for down in [true, false] {
                    let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
                    event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
                    post(event)
                }
                index += 16
                try? await Task.sleep(nanoseconds: 8_000_000)
            }
        case "key":
            guard let keys = input["keys"] as? String, case let (code, flags)? = Self.combo(keys)
            else { return failure("Give a key such as return, or a combination such as cmd+c.") }
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
                event?.flags = flags
                post(event)
            }
        default:
            return failure("Unknown action \(action).")
        }
        try? await Task.sleep(nanoseconds: Self.settleDelay)
        guard screen else { return Output(ok: true, text: json(["ok": true, "action": action])) }
        return await screenshot(["action": action])
    }

    private static let named: [String: Int] = [
        "return": kVK_Return, "enter": kVK_Return, "tab": kVK_Tab, "space": kVK_Space,
        "escape": kVK_Escape, "esc": kVK_Escape, "delete": kVK_Delete, "backspace": kVK_Delete,
        "forwarddelete": kVK_ForwardDelete, "up": kVK_UpArrow, "down": kVK_DownArrow,
        "left": kVK_LeftArrow, "right": kVK_RightArrow, "home": kVK_Home, "end": kVK_End,
        "pageup": kVK_PageUp, "pagedown": kVK_PageDown,
        "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5, "f6": kVK_F6,
        "f7": kVK_F7, "f8": kVK_F8, "f9": kVK_F9, "f10": kVK_F10, "f11": kVK_F11, "f12": kVK_F12,
        "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E,
        "f": kVK_ANSI_F, "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J,
        "k": kVK_ANSI_K, "l": kVK_ANSI_L, "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O,
        "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T,
        "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X, "y": kVK_ANSI_Y,
        "z": kVK_ANSI_Z, "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3,
        "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8,
        "9": kVK_ANSI_9, "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal, ",": kVK_ANSI_Comma,
        ".": kVK_ANSI_Period, "/": kVK_ANSI_Slash, ";": kVK_ANSI_Semicolon,
        "[": kVK_ANSI_LeftBracket, "]": kVK_ANSI_RightBracket,
    ]
    private static func combo(_ keys: String) -> (CGKeyCode, CGEventFlags)? {
        var flags: CGEventFlags = []
        var code: Int?
        for part in keys.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            switch part {
            case "cmd", "command": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "option", "opt", "alt": flags.insert(.maskAlternate)
            case "ctrl", "control": flags.insert(.maskControl)
            default:
                guard code == nil, let value = named[part] else { return nil }
                code = value
            }
        }
        guard let code else { return nil }
        return (CGKeyCode(code), flags)
    }
}
