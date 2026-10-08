package app.openmuse.mobile;

import android.os.LocaleList;
import android.webkit.JsResult;
import android.webkit.WebView;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

// The page's alert and confirm dialogs, with their buttons in the page's
// language rather than fixed English titles. The page names its language when
// it starts (see initializeLanguage in shared/i18n.ts). Everything else, such
// as file choosers and permission prompts, stays with Capacitor's client.
final class MuseDialogs extends BridgeWebChromeClient {
    private final Bridge bridge;
    private boolean chinese;

    MuseDialogs(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        LocaleList locales = LocaleList.getDefault();
        for (int i = 0; i < locales.size(); i++) {
            String language = locales.get(i).getLanguage();
            if (language.equals("en") || language.equals("zh")) {
                chinese = language.equals("zh");
                break;
            }
        }
    }

    void setLanguage(String language) {
        chinese = language.startsWith("zh");
    }

    @Override
    public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
        if (bridge.getActivity().isFinishing()) {
            result.cancel();
            return true;
        }
        new AlertDialog.Builder(bridge.getActivity())
            .setMessage(message)
            .setPositiveButton(chinese ? "好" : "OK", (dialog, which) -> result.confirm())
            .setOnCancelListener((dialog) -> result.confirm())
            .show();
        return true;
    }

    @Override
    public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
        if (bridge.getActivity().isFinishing()) {
            result.cancel();
            return true;
        }
        new AlertDialog.Builder(bridge.getActivity())
            .setMessage(message)
            .setNegativeButton(chinese ? "取消" : "Cancel", (dialog, which) -> result.cancel())
            .setPositiveButton(chinese ? "好" : "OK", (dialog, which) -> result.confirm())
            .setOnCancelListener((dialog) -> result.cancel())
            .show();
        return true;
    }
}
