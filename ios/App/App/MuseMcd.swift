import Foundation
import Security
import UIKit
import WebKit

// Connects McDonald's on this iPhone. The person signs in on McDonald's own
// page (phone number plus the code it texts) inside a web view the app
// presents; the device fingerprint and any slider check are handled by that
// page's own scripts. Once the page has the account's MCP access token, the
// app reads it back, keeps it in the Keychain, and returns it so it can be
// given to the person's MA agent. Nothing McDonald's-specific is signed or
// forged here; only the official page is loaded.
final class MuseMcdHandler: NSObject, WKScriptMessageHandlerWithReply {
    private weak var presenter: UIViewController?
    private static let service = "app.openmuse.mobile.mcd.v1"
    private static let loginURL = URL(string: "https://open.mcd.cn/mcp/login")!
    private var login: MuseMcdLogin?

    init(presenter: UIViewController) {
        self.presenter = presenter
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost",
              message.webView?.url?.scheme == "capacitor", message.webView?.url?.host == "localhost",
              let body = message.body as? [String: Any], let operation = body["operation"] as? String
        else { replyHandler(nil, "Invalid McDonald's request"); return }
        let reply: (Any?, String?) -> Void = { value, error in
            DispatchQueue.main.async { replyHandler(value, error) }
        }
        switch operation {
        case "status":
            reply(Self.token() == nil ? "none" : "connected", nil)
        case "token":
            reply(Self.token() ?? "", nil)
        case "disconnect":
            Self.store(nil)
            reply(true, nil)
        case "connect":
            present(reply)
        default:
            reply(nil, "Invalid McDonald's request")
        }
    }

    private func present(_ reply: @escaping (Any?, String?) -> Void) {
        guard let presenter, presenter.presentedViewController == nil, login == nil else {
            reply("", nil)
            return
        }
        let login = MuseMcdLogin(url: Self.loginURL) { [weak self] token in
            guard let self else { return }
            self.login = nil
            if let token, !token.isEmpty { Self.store(token) }
            reply(token ?? "", nil)
        }
        self.login = login
        presenter.present(login, animated: true)
    }

    // The token kept on this device, if any.
    private static func token() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "active",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let value = String(data: data, encoding: .utf8), !value.isEmpty
        else { return nil }
        return value
    }

    // Save, replace, or (nil) clear the token.
    private static func store(_ value: String?) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "active",
        ]
        guard let value, !value.isEmpty else {
            SecItemDelete(base as CFDictionary)
            return
        }
        let values: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        if SecItemUpdate(base as CFDictionary, values as CFDictionary) == errSecItemNotFound {
            SecItemAdd(base.merging(values) { _, new in new } as CFDictionary, nil)
        }
    }
}

// A modal web view that loads McDonald's sign-in page and watches its own
// network calls for the MCP access token the page retrieves after sign-in.
private final class MuseMcdLogin: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private let url: URL
    private var finish: ((String?) -> Void)?
    private var webView: WKWebView!

    // Wraps fetch and XMLHttpRequest so the api-key response the page makes
    // after sign-in is read as it arrives, and its token handed to native.
    private static let capture = """
    (function () {
      var seen = false;
      function take(url, text) {
        if (seen || typeof url !== "string" || url.indexOf("/bff/member/user/api-key/") < 0) return;
        try {
          var key = JSON.parse(text && text.length ? text : "{}");
          key = key && key.data && key.data.key;
          if (typeof key === "string" && key.length) {
            seen = true;
            window.webkit.messageHandlers.museMcdCapture.postMessage(key);
          }
        } catch (e) {}
      }
      var fetch0 = window.fetch;
      if (fetch0) {
        window.fetch = function () {
          return fetch0.apply(this, arguments).then(function (res) {
            try { res.clone().text().then(function (t) { take(res.url, t); }); } catch (e) {}
            return res;
          });
        };
      }
      var open0 = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__mcdUrl = url;
        return open0.apply(this, arguments);
      };
      var send0 = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function () {
        this.addEventListener("load", function () {
          try { take(this.__mcdUrl, this.responseText); } catch (e) {}
        });
        return send0.apply(this, arguments);
      };
    })();
    """

    init(url: URL, finish: @escaping (String?) -> Void) {
        self.url = url
        self.finish = finish
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: Self.capture, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.add(self, name: "museMcdCapture")
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        // Keep the sign-in self-contained: nothing is written to disk.
        config.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false

        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        let divider = UIView()
        divider.backgroundColor = .separator
        divider.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(divider)
        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold)), for: .normal)
        close.tintColor = .label
        close.backgroundColor = .secondarySystemBackground
        close.layer.cornerRadius = 22
        close.layer.borderWidth = 1
        close.layer.borderColor = UIColor.separator.cgColor
        close.accessibilityLabel = "Close"
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(close)
        let title = UILabel()
        title.text = "McDonald's"
        title.font = .preferredFont(forTextStyle: .headline)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.accessibilityTraits = .header
        title.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(title)
        view.addSubview(webView)

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
            webView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        webView.load(URLRequest(url: url))
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "museMcdCapture", let token = message.body as? String, !token.isEmpty else { return }
        done(token)
    }

    @objc private func cancel() { done(nil) }

    // The person swiped the sheet away without finishing.
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        done(nil)
    }

    private func done(_ token: String?) {
        guard let finish else { return }
        self.finish = nil
        let complete = { finish(token) }
        if token != nil, presentingViewController != nil {
            dismiss(animated: true, completion: complete)
        } else {
            complete()
        }
    }
}
