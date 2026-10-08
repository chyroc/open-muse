package app.openmuse.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

// Reminders from the person's Upcoming list become notifications, so a due
// item is announced while Open Muse is closed. The page sends the full set of
// upcoming occurrences each time; it replaces every earlier one. Android
// forgets alarms when the phone restarts, so the plan is kept and scheduled
// again after a restart or an app update.
final class MuseReminders implements MuseBridgePlugin.Feature {
    private static final String PREFERENCES = "open-muse.reminders";
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9._-]{1,120}$");
    private static final int LIMIT = 48;
    // Whether Open Muse is in front, where the main chat delivers the reminder
    // itself and no notification repeats it.
    static volatile boolean foreground;
    private final MainActivity activity;

    MuseReminders(Activity activity) {
        this.activity = (MainActivity) activity;
    }

    @Override
    public void handle(Object body, MuseBridgePlugin.Reply reply) {
        JSONArray rows = body instanceof JSONObject ? ((JSONObject) body).optJSONArray("items") : null;
        if (rows == null) {
            reply.fail("Invalid reminders");
            return;
        }
        long now = System.currentTimeMillis();
        JSONArray items = new JSONArray();
        for (int i = 0; i < rows.length() && items.length() < LIMIT; i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            String id = row.optString("id");
            String title = row.optString("title");
            long at = (long) row.optDouble("at", 0);
            if (!ID.matcher(id).matches() || title.isEmpty() || at <= now) continue;
            try {
                items.put(new JSONObject().put("id", id).put("title", MuseNotifications.clip(title, 160)).put("at", at));
            } catch (Exception ignored) {
                // Skipped like any malformed row.
            }
        }
        replace(activity, items);
        reply.ok(null);
        // Ask once, when there is first something to announce.
        if (items.length() > 0 && Build.VERSION.SDK_INT >= 33
                && !MainActivity.asked(activity, Manifest.permission.POST_NOTIFICATIONS)) {
            MuseNotifications.authorize(activity, (allowed) -> {});
        }
    }

    private static void replace(Context context, JSONArray items) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        JSONArray previous = saved(context);
        for (int i = 0; i < previous.length(); i++) {
            JSONObject item = previous.optJSONObject(i);
            if (item != null) alarms.cancel(intent(context, item));
        }
        preferences.edit().putString("items", items.toString()).apply();
        schedule(context, items);
    }

    private static JSONArray saved(Context context) {
        try {
            return new JSONArray(context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("items", "[]"));
        } catch (Exception error) {
            return new JSONArray();
        }
    }

    private static void schedule(Context context, JSONArray items) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        long now = System.currentTimeMillis();
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || item.optLong("at") <= now) continue;
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.optLong("at"), intent(context, item));
            else alarms.setWindow(AlarmManager.RTC_WAKEUP, item.optLong("at"), 60_000, intent(context, item));
        }
    }

    private static PendingIntent intent(Context context, JSONObject item) {
        Intent intent = new Intent(context, Due.class)
            .setAction("app.openmuse.mobile.REMINDER")
            .putExtra("id", item.optString("id"))
            .putExtra("title", item.optString("title"));
        return PendingIntent.getBroadcast(context, item.optString("id").hashCode(), intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // A reminder fell due.
    public static final class Due extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            String id = intent.getStringExtra("id");
            String title = intent.getStringExtra("title");
            if (id == null || title == null || foreground) return;
            MuseNotifications.post(context, MuseNotifications.REMINDERS, "open-muse-reminder-" + id, title, "");
        }
    }

    // The phone restarted or Open Muse was updated, which clears every alarm.
    public static final class Restore extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                    || "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(action)) {
                schedule(context, saved(context));
            }
        }
    }
}
