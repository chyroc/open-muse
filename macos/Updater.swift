import AppKit
import CryptoKit
import Foundation
import Security

// Keeps a released build up to date. Only an app signed with Developer ID
// takes part: it asks the website for the current release a little after
// launch and every few hours, downloads the disk image in the background, and
// stages the app inside it once the image matches the published size and
// SHA-256, the app carries a valid signature from the same team as this one,
// and Gatekeeper accepts it as notarized. A staged update replaces this app
// when it quits, or at once with Restart to Update. Development builds,
// copies run from a disk image, and folders this user cannot write to never
// change themselves; the page offers the download instead.
final class Updater {
    enum Phase: String { case idle, checking, current, available, downloading, ready, failed }
    struct Release { let version: String; let build: Int; let url: URL; let size: Int; let sha256: String }

    // The main site picks the nearer download mirror; the mainland China
    // mirror answers when the main site cannot be reached.
    private let feeds = [
        URL(string: "https://getopenmuse.com/download/macos.json")!,
        URL(string: "https://cn.getopenmuse.com/download/macos.json")!,
    ]
    static let downloadPage = URL(string: "https://getopenmuse.com/download/macos")!
    private let automaticKey = "updates.automatic"
    private let interval: TimeInterval = 6 * 60 * 60

    var onChange: (() -> Void)?
    private(set) var phase = Phase.idle
    private(set) var release: Release?
    private(set) var progress = 0.0
    private(set) var checkedAt: Date?
    // What went wrong, for a check or download the person started.
    private(set) var failure: String?
    private var staged: URL?
    private var timer: Timer?
    private var task: URLSessionDownloadTask?
    private var observation: NSKeyValueObservation?
    // The team that signed this app; an update must come from the same one.
    private let team: String?
    private let current = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0

    init() {
        team = Updater.developerTeam()
        UserDefaults.standard.register(defaults: [automaticKey: true])
    }

    var supported: Bool { team != nil }
    var automatic: Bool { UserDefaults.standard.bool(forKey: automaticKey) }
    var hasStagedUpdate: Bool { staged != nil }
    // Replacing the app needs a real install location this user can write.
    var installable: Bool {
        let path = Bundle.main.bundleURL.path
        guard !path.contains("/AppTranslocation/"), !path.hasPrefix("/Volumes/") else { return false }
        return FileManager.default.isWritableFile(atPath: Bundle.main.bundleURL.deletingLastPathComponent().path)
    }

    func start() {
        guard supported else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in self?.check(userInitiated: false) }
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.check(userInitiated: false)
        }
    }

    func state() -> [String: Any] {
        var value: [String: Any] = [
            "supported": supported, "phase": phase.rawValue, "automatic": automatic,
            "installable": installable, "progress": progress,
        ]
        if let release { value["version"] = release.version; value["build"] = release.build }
        if let checkedAt { value["checkedAt"] = checkedAt.timeIntervalSince1970 * 1000 }
        if let failure { value["failure"] = failure }
        return value
    }

    func setAutomatic(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: automaticKey)
        if value, phase == .available { download(userInitiated: false) }
        changed()
    }

    func check(userInitiated: Bool) {
        guard supported, phase != .checking, phase != .downloading, phase != .ready else { return }
        let previous = phase
        phase = .checking
        failure = nil
        changed()
        fetchRelease(feeds) { [weak self] release in
            guard let self else { return }
            guard let release else {
                // A background check that could not reach the site stays quiet.
                self.phase = userInitiated ? .failed : (previous == .checking ? .idle : previous)
                if userInitiated { self.failure = "check" }
                self.changed()
                return
            }
            self.checkedAt = Date()
            guard release.build > self.current else {
                self.release = nil
                self.phase = .current
                self.changed()
                return
            }
            self.release = release
            self.phase = .available
            self.changed()
            if self.installable, self.automatic || userInitiated { self.download(userInitiated: userInitiated) }
        }
    }

    func download(userInitiated: Bool) {
        guard let release, installable, phase == .available || phase == .failed else { return }
        phase = .downloading
        progress = 0
        failure = nil
        changed()
        let task = URLSession.shared.downloadTask(with: release.url) { [weak self] file, response, error in
            // The temporary file is gone once this returns, so verify it here.
            let result = file.flatMap { try? self?.stage($0, release: release, response: response) }
            DispatchQueue.main.async {
                guard let self else { return }
                self.observation = nil
                self.task = nil
                if let result {
                    self.staged = result
                    self.phase = .ready
                } else {
                    // Try again on the next check; say so only when asked.
                    self.phase = userInitiated ? .failed : .available
                    if userInitiated { self.failure = error == nil ? "verify" : "download" }
                }
                self.changed()
            }
        }
        observation = task.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
            DispatchQueue.main.async {
                guard let self, self.phase == .downloading else { return }
                // Report whole percents, not every packet.
                let value = (progress.fractionCompleted * 100).rounded() / 100
                if value != self.progress { self.progress = value; self.changed() }
            }
        }
        self.task = task
        task.resume()
    }

    // Swaps the staged app in after this process exits, and opens it again
    // when asked. Another running copy of the app would keep using files that
    // changed under it, so the update then waits for a later quit.
    func installOnExit(relaunch: Bool) {
        guard let staged, FileManager.default.fileExists(atPath: staged.path),
              NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "").count <= 1
        else { return }
        let script = """
        while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
        rm -rf "$3.old"
        mv "$2" "$3.old" || exit 1
        if mv "$3" "$2"; then rm -rf "$3.old"; else mv "$3.old" "$2"; exit 1; fi
        if [ "$4" = 1 ]; then open "$2"; fi
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "open-muse-update", String(ProcessInfo.processInfo.processIdentifier),
                             Bundle.main.bundleURL.path, staged.path, relaunch ? "1" : "0"]
        try? process.run()
        self.staged = nil
    }

    private func changed() { onChange?() }

    private func fetchRelease(_ urls: [URL], completion: @escaping (Release?) -> Void) {
        guard let url = urls.first else { DispatchQueue.main.async { completion(nil) }; return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            if let data, (response as? HTTPURLResponse)?.statusCode == 200, let release = Updater.parse(data) {
                DispatchQueue.main.async { completion(release) }
            } else {
                self?.fetchRelease(Array(urls.dropFirst()), completion: completion)
            }
        }.resume()
    }

    static func parse(_ data: Data) -> Release? {
        guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = value["version"] as? String, version.count <= 32,
              let build = value["build"] as? Int, build > 0,
              let link = value["url"] as? String, let url = URL(string: link),
              url.scheme == "https", let host = url.host,
              host == "getopenmuse.com" || host.hasSuffix(".getopenmuse.com"),
              let size = value["size"] as? Int, size > 0, size < 1 << 30,
              let sha256 = value["sha256"] as? String, sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
        else { return nil }
        return Release(version: version, build: build, url: url, size: size, sha256: sha256)
    }

    private struct Rejected: Error {}

    // Checks the image, copies the app out of it, and checks the app.
    private func stage(_ file: URL, release: Release, response: URLResponse?) throws -> URL {
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Rejected() }
        let data = try Data(contentsOf: file, options: .mappedIfSafe)
        guard data.count == release.size,
              SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == release.sha256
        else { throw Rejected() }
        let fileManager = FileManager.default
        let root = try fileManager.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "app.openmuse.desktop")
            .appendingPathComponent("Update")
        try? fileManager.removeItem(at: root)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let image = root.appendingPathComponent("update.dmg")
        try fileManager.copyItem(at: file, to: image)
        let mount = root.appendingPathComponent("mount")
        try fileManager.createDirectory(at: mount, withIntermediateDirectories: true)
        guard Updater.run("/usr/bin/hdiutil", ["attach", image.path, "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount.path])
        else { throw Rejected() }
        defer {
            _ = Updater.run("/usr/bin/hdiutil", ["detach", mount.path, "-force"])
            try? fileManager.removeItem(at: image)
        }
        let target = root.appendingPathComponent(Bundle.main.bundleURL.lastPathComponent)
        guard Updater.run("/usr/bin/ditto", [mount.appendingPathComponent("Open Muse.app").path, target.path]),
              // Bundle caches by path, so read the copy's own Info.plist.
              let info = NSDictionary(contentsOf: target.appendingPathComponent("Contents/Info.plist")),
              info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
              info["CFBundleVersion"] as? String == String(release.build),
              let team, Updater.signed(target, team: team),
              Updater.run("/usr/sbin/spctl", ["--assess", "--type", "execute", target.path])
        else { try? fileManager.removeItem(at: target); throw Rejected() }
        return target
    }

    private static func requirement(_ team: String) -> SecRequirement? {
        // Apple's Developer ID requirement, pinned to one team.
        let text = "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"\(team)\""
        var requirement: SecRequirement?
        return SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess ? requirement : nil
    }

    private static func developerTeam() -> String? {
        var code: SecCode?
        var staticCode: SecStaticCode?
        var info: CFDictionary?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
              SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode,
              SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let team = (info as? [String: Any])?[kSecCodeInfoTeamIdentifier as String] as? String,
              team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil,
              let requirement = requirement(team),
              SecCodeCheckValidity(code, [], requirement) == errSecSuccess
        else { return nil }
        return team
    }

    private static func signed(_ app: URL, team: String) -> Bool {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess, let code,
              let requirement = requirement(team)
        else { return false }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode)
        return SecStaticCodeCheckValidityWithErrors(code, flags, requirement, nil) == errSecSuccess
    }

    @discardableResult
    private static func run(_ tool: String, _ arguments: [String]) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return false }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }
}
