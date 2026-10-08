package app.openmuse.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Bundle;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.function.Consumer;

public class MainActivity extends BridgeActivity {
    private ActivityResultLauncher<String[]> permissionRequest;
    // Requests wait for the one on screen; Android shows one at a time.
    private final ArrayDeque<Object[]> permissionQueue = new ArrayDeque<>();
    private Consumer<Boolean> permissionDone;
    private String[] permissionAsked;

    @Override
    protected void attachBaseContext(Context base) {
        MuseAppearance.restore(base);
        super.attachBaseContext(base);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        permissionRequest = registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), this::permissionsAnswered);
        registerPlugin(MuseBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }

    // A light or dark mode chosen in the app is applied in place (uiMode is
    // in the activity's configChanges); the WebView hears of it here and
    // updates prefers-color-scheme without reloading the page.
    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (getBridge() != null) getBridge().getWebView().dispatchConfigurationChanged(configuration);
    }

    static boolean granted(Context context, String... permissions) {
        for (String permission : permissions) {
            if (ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    // Whether the app has asked for these permissions before, to tell a
    // question not asked yet from a refusal.
    static boolean asked(Context context, String... permissions) {
        SharedPreferences preferences = context.getSharedPreferences("open-muse.permissions", MODE_PRIVATE);
        for (String permission : permissions) {
            if (!preferences.getBoolean(permission, false)) return false;
        }
        return true;
    }

    // Shows the system permission question; `done` hears whether every one of
    // them is now granted.
    void requestPermissions(String[] permissions, Consumer<Boolean> done) {
        runOnUiThread(() -> {
            if (granted(this, permissions)) {
                done.accept(true);
                return;
            }
            permissionQueue.add(new Object[] {permissions, done});
            if (permissionDone == null) nextPermissionRequest();
        });
    }

    @SuppressWarnings("unchecked")
    private void nextPermissionRequest() {
        Object[] next = permissionQueue.poll();
        if (next == null) return;
        permissionAsked = (String[]) next[0];
        permissionDone = (Consumer<Boolean>) next[1];
        SharedPreferences.Editor edit = getSharedPreferences("open-muse.permissions", MODE_PRIVATE).edit();
        for (String permission : permissionAsked) edit.putBoolean(permission, true);
        edit.apply();
        permissionRequest.launch(permissionAsked);
    }

    private void permissionsAnswered(Map<String, Boolean> answers) {
        Consumer<Boolean> done = permissionDone;
        String[] asked = permissionAsked;
        permissionDone = null;
        permissionAsked = null;
        if (done != null) done.accept(asked != null && granted(this, asked));
        nextPermissionRequest();
    }
}
