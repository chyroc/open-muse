package app.openmuse.mobile;

import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.View;

// The haptics the web interface asks for: a selection tick, a light or medium
// tap, or a success confirmation. They go through the view's haptic feedback,
// so the system's touch-feedback setting and the device's tuned effects apply.
// Unknown kinds are ignored.
final class MuseHaptics {
    private MuseHaptics() {}

    static void play(View view, String kind) {
        int effect;
        switch (kind) {
            case "selection":
                effect = Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.SEGMENT_TICK : HapticFeedbackConstants.CLOCK_TICK;
                break;
            case "light":
                effect = HapticFeedbackConstants.KEYBOARD_TAP;
                break;
            case "medium":
                effect = HapticFeedbackConstants.CONTEXT_CLICK;
                break;
            case "success":
                effect = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.LONG_PRESS;
                break;
            default:
                return;
        }
        view.post(() -> view.performHapticFeedback(effect));
    }
}
