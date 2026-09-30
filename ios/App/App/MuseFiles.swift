import Foundation
import UIKit
import WebKit
import QuickLook

private enum MuseFileFailure: Error {
    case unavailable
    case tooLarge
}

// Download only a fresh MA-issued TOS capability. Cookies, API keys, redirects
// and a disk-backed HTTP cache are deliberately absent from this connection.
private final class MuseFileDownload: NSObject, URLSessionDataDelegate {
    private static let limit = 10 * 1024 * 1024
    private var bytes = Data()
    private var failure: MuseFileFailure?
    private var completion: ((Result<Data, MuseFileFailure>) -> Void)?
    private var session: URLSession?

    func start(_ url: URL, completion: @escaping (Result<Data, MuseFileFailure>) -> Void) {
        self.completion = completion
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        let session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        self.session = session
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        session.dataTask(with: request).resume()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        failure = .unavailable
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            failure = .unavailable
            completionHandler(.cancel)
            return
        }
        guard response.expectedContentLength <= Int64(Self.limit) else {
            failure = .tooLarge
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard bytes.count + data.count <= Self.limit else {
            failure = .tooLarge
            bytes.removeAll()
            dataTask.cancel()
            return
        }
        bytes.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let callback = completion
        completion = nil
        if let failure = failure { callback?(.failure(failure)) }
        else if error != nil { callback?(.failure(.unavailable)) }
        else { callback?(.success(bytes)) }
        bytes.removeAll()
        session.finishTasksAndInvalidate()
        self.session = nil
    }
}

// Quick Look hides its own controls in some modes (for example the black image
// view), so the preview always keeps an app-owned, visible close control.
private final class MusePreviewContainer: UIViewController {
    private let preview: QLPreviewController
    private let closeLabel: String
    private var onDismiss: (() -> Void)?

    init(preview: QLPreviewController, closeLabel: String, onDismiss: @escaping () -> Void) {
        self.preview = preview
        self.closeLabel = closeLabel
        self.onDismiss = onDismiss
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        addChild(preview)
        preview.view.frame = view.bounds
        preview.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(preview.view)
        preview.didMove(toParent: self)

        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold)), for: .normal)
        close.tintColor = .label
        close.backgroundColor = UIColor.secondarySystemBackground.withAlphaComponent(0.94)
        close.layer.cornerRadius = 22
        close.layer.borderWidth = 1
        close.layer.borderColor = UIColor.separator.cgColor
        close.accessibilityLabel = closeLabel
        close.accessibilityIdentifier = "museFilePreviewClose"
        close.addTarget(self, action: #selector(closePreview), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)
        // Leading edge: Quick Look places its own title and actions on the trailing side.
        NSLayoutConstraint.activate([
            close.widthAnchor.constraint(equalToConstant: 44),
            close.heightAnchor.constraint(equalToConstant: 44),
            close.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
        ])
    }

    override var keyCommands: [UIKeyCommand]? {
        [UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(closePreview))]
    }

    override var canBecomeFirstResponder: Bool { true }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    // Covers both this control and Quick Look's own close action.
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil {
            onDismiss?()
            onDismiss = nil
        }
    }

    @objc private func closePreview() { dismiss(animated: true) }
}

final class MuseFilesHandler: NSObject, WKScriptMessageHandlerWithReply, QLPreviewControllerDataSource {
    private weak var presenter: UIViewController?
    private var download: MuseFileDownload?
    private var file: URL?
    private var directory: URL?
    private var busy = false

    init(presenter: UIViewController) {
        self.presenter = presenter
        super.init()
        // A terminated process cannot run dismissal cleanup; remove its copies.
        let temporary = FileManager.default.temporaryDirectory
        let stale = (try? FileManager.default.contentsOfDirectory(at: temporary, includingPropertiesForKeys: nil)) ?? []
        for folder in stale where folder.lastPathComponent.hasPrefix("muse-file-") {
            try? FileManager.default.removeItem(at: folder)
        }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost",
              message.webView?.url?.scheme == "capacitor", message.webView?.url?.host == "localhost",
              let body = message.body as? [String: String],
              let address = body["url"], address.utf8.count <= 16000,
              let url = URL(string: address), url.scheme == "https",
              let host = url.host,
              host.range(of: "^[a-z0-9][a-z0-9-]*\\.tos-cn-beijing\\.volces\\.com$", options: .regularExpression) != nil,
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let name = body["name"], name.utf8.count <= 4096,
              let action = body["action"], action == "preview" || action == "share",
              let closeLabel = body["closeLabel"], !closeLabel.isEmpty, closeLabel.utf8.count <= 200,
              !busy, let presenter = presenter, presenter.presentedViewController == nil
        else { replyHandler("unavailable", nil); return }
        busy = true
        let task = MuseFileDownload()
        download = task
        task.start(url) { [weak self] result in
            guard let self = self else { replyHandler("unavailable", nil); return }
            self.download = nil
            switch result {
            case .failure(let error):
                self.busy = false
                replyHandler(error == .tooLarge ? "too-large" : "unavailable", nil)
            case .success(let data):
                do {
                    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("muse-file-" + UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
                    self.directory = folder
                    let basename = String((name as NSString).lastPathComponent.prefix(120))
                        .components(separatedBy: .controlCharacters).joined()
                        .replacingOccurrences(of: ":", with: "-")
                    let filename = basename.isEmpty || basename == "." || basename == ".." ? "file" : basename
                    let file = folder.appendingPathComponent(filename)
                    try data.write(to: file, options: [.atomic, .completeFileProtection])
                    self.file = file
                    // Presentation never completes off-screen, which would leave the page waiting.
                    guard presenter.viewIfLoaded?.window != nil, presenter.presentedViewController == nil else { throw MuseFileFailure.unavailable }
                    if action == "preview" {
                        guard QLPreviewController.canPreview(file as NSURL) else { throw MuseFileFailure.unavailable }
                        let preview = QLPreviewController()
                        preview.dataSource = self
                        let container = MusePreviewContainer(preview: preview, closeLabel: closeLabel) { [weak self] in
                            self?.cleanup()
                        }
                        presenter.present(container, animated: true) { replyHandler("opened", nil) }
                    } else {
                        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                        share.popoverPresentationController?.sourceView = presenter.view
                        share.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                        share.completionWithItemsHandler = { [weak self] _, _, _, _ in self?.cleanup() }
                        presenter.present(share, animated: true) { replyHandler("opened", nil) }
                    }
                } catch {
                    self.cleanup()
                    replyHandler("unavailable", nil)
                }
            }
        }
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { file == nil ? 0 : 1 }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        return file! as NSURL
    }

    private func cleanup() {
        if let directory = directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
        file = nil
        busy = false
    }
}
