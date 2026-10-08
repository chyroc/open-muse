package app.openmuse.mobile;

import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import org.json.JSONException;
import org.json.JSONObject;

// Mirrors the iPhone app's WKScriptMessageHandler bridge on Android, so the
// web layer reaches native features through the same
// `window.webkit.messageHandlers.<name>.postMessage(...)` contract without any
// Android-specific branches. A document-start script defines those handlers
// and forwards each call to the native dispatcher here, which runs the work
// and resolves or rejects the returned promise. Only handlers actually
// implemented are exposed, so feature-detection on the web stays honest.
@CapacitorPlugin(name = "MuseBridge")
public class MuseBridgePlugin extends Plugin {
    // Keep in sync with the native dispatch in handle(): only names we answer.
    private static final String SHIM =
        "(function(){"
      + "if(window.webkit&&window.webkit.messageHandlers)return;"
      + "var pending={};"
      + "window.__museResolve=function(id,json){var p=pending[id];if(p){delete pending[id];p.resolve(json===undefined||json===null?undefined:JSON.parse(json));}};"
      + "window.__museReject=function(id,msg){var p=pending[id];if(p){delete pending[id];p.reject(new Error(msg||'bridge error'));}};"
      + "function make(name){return{postMessage:function(body){"
      + "var id=String(Date.now())+'-'+Math.random().toString(36).slice(2);"
      + "var promise=new Promise(function(res,rej){pending[id]={resolve:res,reject:rej};});"
      + "try{window.__MuseAndroid.post(name,id,JSON.stringify(body===undefined?null:body));}"
      + "catch(e){delete pending[id];return Promise.reject(e);}"
      + "return promise;}};}"
      + "var mh={};['museHaptics'].forEach(function(n){mh[n]=make(n);});"
      + "window.webkit={messageHandlers:mh};"
      + "})();";

    @Override
    public void load() {
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new Iface(), "__MuseAndroid");
        // Let the WebView report prefers-color-scheme from the app's night mode
        // (content with its own dark styles is not auto-inverted).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            androidx.webkit.WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.getSettings(), true);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, SHIM, Collections.singleton("https://localhost"));
        }
    }

    private class Iface {
        @JavascriptInterface
        public void post(String name, String id, String body) {
            Object parsed;
            try {
                parsed = (body == null || body.equals("null")) ? null : new JSONObject("{\"v\":" + body + "}").get("v");
            } catch (JSONException error) {
                parsed = null;
            }
            final Object value = parsed;
            getActivity().runOnUiThread(() -> {
                try {
                    handle(name, value);
                    resolve(id, null);
                } catch (Exception error) {
                    reject(id, error.getMessage() == null ? "bridge error" : error.getMessage());
                }
            });
        }
    }

    // Dispatch to the native implementation. Fire-and-forget handlers return
    // void and resolve with no value.
    private void handle(String name, Object body) {
        switch (name) {
            case "museHaptics":
                haptic(body instanceof String ? (String) body : "");
                return;
            case "museAppearance":
                appearance(body instanceof String ? (String) body : "system");
                return;
            default:
                throw new IllegalArgumentException("Unknown bridge handler");
        }
    }

    private void haptic(String kind) {
        Vibrator vibrator = (Vibrator) getContext().getSystemService(android.content.Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        int ms;
        switch (kind) {
            case "light":
            case "selection": ms = 12; break;
            case "medium": ms = 20; break;
            case "success": ms = 30; break;
            default: return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(ms);
        }
    }

    // Light/dark/system, applied app-wide. The activity declares uiMode in its
    // configChanges, so the WebView updates prefers-color-scheme in place
    // without a reload.
    private void appearance(String mode) {
        int night;
        switch (mode) {
            case "light": night = AppCompatDelegate.MODE_NIGHT_NO; break;
            case "dark": night = AppCompatDelegate.MODE_NIGHT_YES; break;
            default: night = AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM; break;
        }
        AppCompatDelegate.setDefaultNightMode(night);
        // Apply to the running activity without a reload; uiMode is in the
        // activity's configChanges so the WebView updates in place.
        if (getActivity() instanceof androidx.appcompat.app.AppCompatActivity) {
            ((androidx.appcompat.app.AppCompatActivity) getActivity()).getDelegate().setLocalNightMode(night);
        }
    }

    private void resolve(String id, String json) {
        eval("window.__museResolve(" + quote(id) + "," + (json == null ? "null" : json) + ")");
    }

    private void reject(String id, String message) {
        eval("window.__museReject(" + quote(id) + "," + quote(message) + ")");
    }

    private void eval(String script) {
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private static String quote(String value) {
        return JSONObject.quote(value == null ? "" : value);
    }
}
