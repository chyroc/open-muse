package app.openmuse.mobile;

import android.os.LocaleList;
import android.webkit.JsResult;
import android.webkit.WebView;
import android.content.res.Configuration;
import android.os.Build;
import android.view.ContextThemeWrapper;
import android.widget.Button;
import androidx.appcompat.app.AlertDialog;
import com.google.android.material.color.DynamicColors;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

// The page's alert and confirm dialogs, in the system's own dialog style and
// with their buttons in the page's language rather than fixed English titles. The page names its language when
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

    // Material 3 in the phone's own colors, light or dark with the app.
    private AlertDialog.Builder builder() {
        return new MaterialAlertDialogBuilder(DynamicColors.wrapContextIfAvailable(
            new ContextThemeWrapper(bridge.getActivity(), com.google.android.material.R.style.Theme_Material3_DayNight),
            com.google.android.material.R.style.ThemeOverlay_Material3_DynamicColors_DayNight));
    }

    // Buttons in the system's accent color, as the phone's own dialogs have.
    private void tint(AlertDialog dialog) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        boolean dark = (bridge.getActivity().getResources().getConfiguration().uiMode
            & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int color = bridge.getActivity().getColor(dark ? android.R.color.system_accent1_200 : android.R.color.system_accent1_600);
        for (int which : new int[] {AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE}) {
            Button button = dialog.getButton(which);
            if (button != null) button.setTextColor(color);
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
        tint(builder()
            .setMessage(message)
            .setPositiveButton(chinese ? "好" : "OK", (dialog, which) -> result.confirm())
            .setOnCancelListener((dialog) -> result.confirm())
            .show());
        return true;
    }

    @Override
    public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
        if (bridge.getActivity().isFinishing()) {
            result.cancel();
            return true;
        }
        tint(builder()
            .setMessage(message)
            .setNegativeButton(chinese ? "取消" : "Cancel", (dialog, which) -> result.cancel())
            .setPositiveButton(chinese ? "好" : "OK", (dialog, which) -> result.confirm())
            .setOnCancelListener((dialog) -> result.cancel())
            .show());
        return true;
    }
}
