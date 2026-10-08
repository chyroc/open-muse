package app.openmuse.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.LocaleList;
import android.provider.Settings;
import android.view.Display;
import android.view.RoundedCorner;
import android.view.Window;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

// The Android counterpart of the iPhone app's WKScriptMessageHandler bridge.
// A document-start script defines window.webkit.messageHandlers.<name> for each
// native feature, so the web layer reaches it through the same
// postMessage(...) contract as on the iPhone. Calls travel over a web message
// listener that the WebView injects only into documents from the bundled
// origin, and every request must come from the main frame; the native side
// replies through the same channel to settle the returned promise. Only
// handlers implemented here are defined, so web feature detection stays
// honest.
@CapacitorPlugin(name = "MuseBridge")
public class MuseBridgePlugin extends Plugin {
    static final String ORIGIN = "https://localhost";

    // One native feature behind a message handler name.
    interface Feature {
        void handle(Object body, Reply reply);
    }

    // Settles one postMessage promise. Handlers that only take a message
    // resolve with no value.
    interface Reply {
        void ok(Object value);

        void fail(String message);
    }

    private final Map<String, Feature> features = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private MuseShake shake;
    private boolean keyboardOpen;

    @Override
    public void load() {
        AppCompatActivity activity = getActivity();
        MuseDialogs dialogs = new MuseDialogs(getBridge());
        getBridge().getWebView().setWebChromeClient(dialogs);

        features.put("museCredentials", new MuseCredentials(getContext()));
        features.put("museHaptics", (body, reply) -> {
            MuseHaptics.play(getBridge().getWebView(), body instanceof String ? (String) body : "");
            reply.ok(null);
        });
        features.put("museAppearance", (body, reply) -> {
            if (body instanceof String) MuseAppearance.choose(activity, (String) body);
            reply.ok(null);
        });
        features.put("museLanguage", (body, reply) -> {
            if (body instanceof String) dialogs.setLanguage((String) body);
            reply.ok(null);
        });
        features.put("museNotifications", new MuseNotifications(activity));
        features.put("museReminders", new MuseReminders(activity));
        features.put("musePersonal", new MusePersonal(activity));
        features.put("museFiles", new MuseFiles(activity));
        if (MuseHealth.supported()) features.put("museHealth", new MuseHealth(activity));

        WebView webView = getBridge().getWebView();
        // Text keeps the app's own type scale at everyday font sizes and grows
        // only at the larger ones; the page sizes its layout metrics from the
        // same scale (window.__OPEN_MUSE_TYPE_SCALE__, see dynamic-type.ts).
        webView.getSettings().setTextZoom((int) Math.round(typeScale(getContext().getResources().getConfiguration()) * 100));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "__museNative", Collections.singleton(ORIGIN), this::receive);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, script(), Collections.singleton(ORIGIN));
        }
        paint(getContext().getResources().getConfiguration());
        shake = new MuseShake(getContext(), () -> evaluate("window.dispatchEvent(new Event('muse-shake'))"));
        watchKeyboard(webView);
        handleBack(activity, webView);
    }

    private void receive(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame,
                         JavaScriptReplyProxy proxy) {
        String origin = sourceOrigin == null ? "" : sourceOrigin.toString();
        String data = message.getData();
        if (data == null) return;
        long id;
        String name;
        Object body;
        try {
            JSONObject request = new JSONObject(data);
            id = request.getLong("id");
            name = request.getString("name");
            body = request.opt("body");
            if (body == JSONObject.NULL) body = null;
        } catch (Exception error) {
            return;
        }
        Reply reply = new Reply() {
            private boolean settled;

            @Override
            public void ok(Object value) {
                send(true, value, null);
            }

            @Override
            public void fail(String message) {
                send(false, null, message);
            }

            private void send(boolean ok, Object value, String error) {
                main.post(() -> {
                    if (settled) return;
                    settled = true;
                    try {
                        JSONObject answer = new JSONObject();
                        answer.put("id", id);
                        answer.put("ok", ok);
                        if (value != null) answer.put("value", value);
                        if (error != null) answer.put("error", error);
                        proxy.postMessage(answer.toString());
                    } catch (Exception ignored) {
                        // The page is gone; nothing waits for the answer.
                    }
                });
            }
        };
        Feature feature = features.get(name);
        if (!isMainFrame || !ORIGIN.equals(origin) || feature == null) {
            reply.fail("Invalid request");
            return;
        }
        try {
            feature.handle(body, reply);
        } catch (Exception error) {
            reply.fail("Invalid request");
        }
    }

    // Defines the message handlers and the values the iPhone app also hands the
    // page before it starts: languages, device, versions, and display corner.
    private String script() {
        Context context = getContext();
        JSONArray names = new JSONArray();
        for (String name : features.keySet()) names.put(name);
        JSONArray languages = new JSONArray();
        LocaleList locales = LocaleList.getDefault();
        for (int i = 0; i < locales.size(); i++) languages.put(locales.get(i).toLanguageTag());
        String version = "";
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (info.versionName != null) version = info.versionName;
        } catch (Exception ignored) {
            // The page shows no version.
        }
        String device = Settings.Global.getString(context.getContentResolver(), Settings.Global.DEVICE_NAME);
        if (device == null || device.isEmpty()) device = Build.MODEL;
        Map<String, Object> deviceInfo = new HashMap<>();
        deviceInfo.put("name", device);
        StringBuilder out = new StringBuilder("(function(){");
        out.append("if(window.webkit&&window.webkit.messageHandlers)return;")
            .append("var pending={},seq=0,listening=false;")
            .append("function port(){var p=window.__museNative;if(p&&!listening){listening=true;")
            .append("p.addEventListener('message',function(e){var m;try{m=JSON.parse(e.data);}catch(_){return;}")
            .append("var w=pending[m.id];if(!w)return;delete pending[m.id];")
            .append("if(m.ok)w[0](m.value===undefined?undefined:m.value);else w[1](new Error(m.error||'Native request failed'));});}")
            .append("return p;}")
            .append("function make(n){return{postMessage:function(b){var p=port();")
            .append("if(!p)return Promise.reject(new Error('Native bridge unavailable'));")
            .append("var id=++seq;return new Promise(function(res,rej){pending[id]=[res,rej];")
            .append("p.postMessage(JSON.stringify({id:id,name:n,body:b===undefined?null:b}));});}};}")
            .append("var mh={};").append(names).append(".forEach(function(n){mh[n]=make(n);});")
            .append("window.webkit={messageHandlers:mh};")
            .append("window.__OPEN_MUSE_LANGUAGES__=").append(languages).append(';')
            .append("window.__OPEN_MUSE_DEVICE__=").append(new JSONObject(deviceInfo)).append(';')
            .append("window.__OPEN_MUSE_VERSION__=").append(JSONObject.quote(version)).append(';')
            .append("window.__OPEN_MUSE_SYSTEM__=").append(JSONObject.quote("Android " + Build.VERSION.RELEASE)).append(';')
            .append("window.__OPEN_MUSE_TYPE_SCALE__=").append(typeScale(context.getResources().getConfiguration())).append(';');
        int corner = displayCorner();
        if (corner > 0) out.append("window.__OPEN_MUSE_DEVICE_CORNER__=").append(corner).append(';');
        return out.append("})();").toString();
    }

    // Android's font sizes up to 130% are everyday sizes and keep the app's
    // type scale, like iOS's standard Dynamic Type sizes; the larger sizes
    // enlarge text by how far they exceed it.
    static double typeScale(Configuration configuration) {
        double scale = configuration.fontScale / 1.3;
        return Math.round(Math.min(Math.max(scale, 1), 3) * 100) / 100.0;
    }

    // The display's corner radius in CSS pixels, so floating sheets keep their
    // corners concentric with the screen's.
    private int displayCorner() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return 0;
        Display display = getContext().getDisplay();
        if (display == null) return 0;
        RoundedCorner corner = display.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_LEFT);
        if (corner == null) return 0;
        return Math.round(corner.getRadius() / getContext().getResources().getDisplayMetrics().density);
    }

    // The composer stays above the keyboard; while it is up, the page hides
    // the bottom navigation (the keyboard-open class, as on the iPhone).
    private void watchKeyboard(WebView webView) {
        webView.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
            boolean open = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
            if (open == keyboardOpen) return;
            keyboardOpen = open;
            evaluate("document.documentElement.classList.toggle('keyboard-open'," + open + ")");
        });
    }

    // Back closes the sheet or menu on top, the way its close button or a
    // downward pull would; with nothing open it leaves the app running in the
    // background, as going home does, instead of closing the conversation.
    // The page hears it as its own Escape and cancel events, so no keyboard
    // focus ring appears as a real key press would make it. The conversation
    // sidebar is an open dialog without modality, so it counts too.
    private static final String BACK =
        "(function(){var a=document.activeElement;"
      + "var d=a&&a.closest&&a.closest('dialog[open]');"
      + "var all=[].slice.call(document.querySelectorAll('dialog[open]'));"
      + "if(!d)d=all.filter(function(x){return x.matches(':modal');}).pop()||all.pop();"
      + "if(!d)return 'none';"
      + "var k=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true});"
      + "(d.contains(a)?a:d).dispatchEvent(k);if(k.defaultPrevented)return 'closed';"
      + "var c=new Event('cancel',{cancelable:true});d.dispatchEvent(c);if(c.defaultPrevented)return 'closed';"
      + "d.close();return 'closed';})()";

    private void handleBack(AppCompatActivity activity, WebView webView) {
        activity.getOnBackPressedDispatcher().addCallback(activity, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript(BACK, (result) -> {
                    if (!"\"closed\"".equals(result)) activity.moveTaskToBack(true);
                });
            }
        });
    }

    // Behind the page, the page color of the current appearance, so launch,
    // overscroll and keyboard animations never flash the other one; the
    // system bars' icons stay readable on it.
    private void paint(Configuration configuration) {
        boolean dark = (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int page = dark ? Color.BLACK : Color.rgb(252, 252, 252);
        Window window = getActivity().getWindow();
        window.getDecorView().setBackgroundColor(page);
        getBridge().getWebView().setBackgroundColor(page);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration configuration) {
        super.handleOnConfigurationChanged(configuration);
        // After Capacitor's own system bar styling, which reads the previous mode.
        main.post(() -> paint(configuration));
    }

    // "app-settings:" opens this app's page in the system settings, where its
    // notifications and permissions are, as it does on the iPhone.
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (!"app-settings".equals(url.getScheme())) return null;
        Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null));
        getActivity().startActivity(settings);
        return true;
    }

    void evaluate(String script) {
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        shake.start();
        MuseReminders.foreground = true;
        MuseNotifications.foreground = true;
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        shake.stop();
        MuseReminders.foreground = false;
        MuseNotifications.foreground = false;
    }
}
