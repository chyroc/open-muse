package app.openmuse.mobile;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.ImageView;
import androidx.appcompat.app.AppCompatDelegate;

// The light or dark mode chosen in Settings > Appearance. It overrides the
// system's for this app, which the WebView follows for prefers-color-scheme,
// and is kept for the next launch so the app opens in the chosen mode before
// the page loads.
final class MuseAppearance {
    private static final String PREFERENCES = "open-muse";
    private static final String KEY = "appearance";

    private MuseAppearance() {}

    static int nightMode(String mode) {
        switch (mode == null ? "" : mode) {
            case "light": return AppCompatDelegate.MODE_NIGHT_NO;
            case "dark": return AppCompatDelegate.MODE_NIGHT_YES;
            default: return AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
        }
    }

    // Before the activity is created, so the first frame is already right.
    static void restore(Context context) {
        String mode = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(KEY, "system");
        AppCompatDelegate.setDefaultNightMode(nightMode(mode));
    }

    static void choose(Activity activity, String mode) {
        if (!mode.equals("system") && !mode.equals("light") && !mode.equals("dark")) return;
        activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(KEY, mode).apply();
        activity.runOnUiThread(() -> {
            if (AppCompatDelegate.getDefaultNightMode() == nightMode(mode)) return;
            crossfade(activity, () -> AppCompatDelegate.setDefaultNightMode(nightMode(mode)));
        });
    }

    // The old appearance fades out over the new one, as on the iPhone, instead
    // of every color changing in one frame.
    private static void crossfade(Activity activity, Runnable change) {
        Window window = activity.getWindow();
        ViewGroup content = window.getDecorView().findViewById(android.R.id.content);
        if (content == null || content.getWidth() == 0 || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            change.run();
            return;
        }
        Bitmap shot = Bitmap.createBitmap(content.getWidth(), content.getHeight(), Bitmap.Config.ARGB_8888);
        int[] at = new int[2];
        content.getLocationInWindow(at);
        Rect area = new Rect(at[0], at[1], at[0] + content.getWidth(), at[1] + content.getHeight());
        PixelCopy.request(window, area, shot, (result) -> {
            if (result != PixelCopy.SUCCESS) {
                change.run();
                return;
            }
            ImageView cover = new ImageView(activity);
            cover.setImageBitmap(shot);
            content.addView(cover, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            change.run();
            // The page repaints in the new mode a frame or two later.
            cover.animate().alpha(0f).setStartDelay(60).setDuration(250)
                .withEndAction(() -> content.removeView(cover)).start();
        }, new Handler(Looper.getMainLooper()));
    }
}
