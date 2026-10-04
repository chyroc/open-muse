import Foundation
import ImageIO
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
// view), so the preview always keeps an app-owned bar with a visible close
// control. The preview sits below the bar so the control never covers content.
private final class MusePreviewContainer: UIViewController {
    private let preview: QLPreviewController
    private let fileName: String
    private let closeLabel: String
    private var onDismiss: (() -> Void)?

    init(preview: QLPreviewController, fileName: String, closeLabel: String, onDismiss: @escaping () -> Void) {
        self.preview = preview
        self.fileName = fileName
        self.closeLabel = closeLabel
        self.onDismiss = onDismiss
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        let divider = UIView()
        divider.backgroundColor = .separator
        divider.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(divider)

        addChild(preview)
        preview.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(preview.view)
        preview.didMove(toParent: self)

        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold)), for: .normal)
        close.tintColor = .label
        close.backgroundColor = .secondarySystemBackground
        close.layer.cornerRadius = 22
        close.layer.borderWidth = 1
        close.layer.borderColor = UIColor.separator.cgColor
        close.accessibilityLabel = closeLabel
        close.accessibilityIdentifier = "museFilePreviewClose"
        close.addTarget(self, action: #selector(closePreview), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(close)

        let title = UILabel()
        title.text = fileName
        title.font = .preferredFont(forTextStyle: .headline)
        title.adjustsFontForContentSizeCategory = true
        title.lineBreakMode = .byTruncatingMiddle
        title.textAlignment = .center
        title.accessibilityTraits = .header
        title.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(title)

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 56),
            divider.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
            divider.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
            divider.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
            divider.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),
            close.widthAnchor.constraint(equalToConstant: 44),
            close.heightAnchor.constraint(equalToConstant: 44),
            close.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            close.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            title.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            title.leadingAnchor.constraint(greaterThanOrEqualTo: close.trailingAnchor, constant: 12),
            preview.view.topAnchor.constraint(equalTo: bar.bottomAnchor),
            preview.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            preview.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            preview.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
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
    private var thumbnails = 0

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
              let action = body["action"]
        else { replyHandler("unavailable", nil); return }
        if action == "thumbnail" { thumbnail(url, reply: replyHandler); return }
        guard let name = body["name"], name.utf8.count <= 4096,
              action == "preview" || action == "share",
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
                        let container = MusePreviewContainer(preview: preview, fileName: filename, closeLabel: closeLabel) { [weak self] in
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

    // Thumbnails are decoded in memory and returned as re-encoded pixels, so
    // no signed URL, original bytes or temporary file reaches the page or disk.
    private func thumbnail(_ url: URL, reply: @escaping (Any?, String?) -> Void) {
        guard thumbnails < 2 else { reply("busy", nil); return }
        thumbnails += 1
        MuseFileDownload().start(url) { [weak self] result in
            guard case .success(let data) = result else {
                self?.thumbnails -= 1
                reply(result == .failure(.tooLarge) ? "too-large" : "unavailable", nil)
                return
            }
            DispatchQueue.global(qos: .utility).async {
                let encoded = Self.encodedThumbnail(data)
                DispatchQueue.main.async {
                    self?.thumbnails -= 1
                    reply(encoded ?? "unavailable", nil)
                }
            }
        }
    }

    // ImageIO downsamples without decoding the full image, which bounds memory
    // for very large dimensions. SVG and other non-bitmap types are rejected.
    // A PDF shows its first page, wide enough for a document card.
    private static func encodedThumbnail(_ data: Data) -> String? {
        if data.starts(with: Array("%PDF-".utf8)) { return pdfThumbnail(data) }
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) > 0,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceShouldCacheImmediately: true,
                  kCGImageSourceThumbnailMaxPixelSize: 480,
              ] as CFDictionary)
        else { return nil }
        let opaque = [.none, .noneSkipFirst, .noneSkipLast].contains(image.alphaInfo)
        let bitmap = UIImage(cgImage: image)
        if opaque, let jpeg = bitmap.jpegData(compressionQuality: 0.8) {
            return "data:image/jpeg;base64," + jpeg.base64EncodedString()
        }
        guard let png = bitmap.pngData() else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }

    private static func pdfThumbnail(_ data: Data) -> String? {
        guard let provider = CGDataProvider(data: data as CFData),
              let document = CGPDFDocument(provider),
              let page = document.page(at: 1)
        else { return nil }
        let box = page.getBoxRect(.cropBox)
        guard box.width > 0, box.height > 0 else { return nil }
        let scale = min(720 / box.width, 4)
        let size = CGSize(width: (box.width * scale).rounded(), height: (box.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let canvas = context.cgContext
            canvas.translateBy(x: 0, y: size.height)
            canvas.scaleBy(x: scale, y: -scale)
            canvas.translateBy(x: -box.minX, y: -box.minY)
            canvas.drawPDFPage(page)
        }
        guard let jpeg = image.jpegData(compressionQuality: 0.8) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

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
