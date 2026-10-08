package app.openmuse.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.UUID;
import org.json.JSONObject;

// Settings > Notifications: whether Android lets Open Muse notify, asking when
// the person turns notifications on, and a notification when a reply finishes
// after the person left the app.
final class MuseNotifications implements MuseBridgePlugin.Feature {
    static final String REPLIES = "replies";
    static final String REMINDERS = "reminders";
    // Whether Open Muse is in front, where the chat itself shows what a
    // notification would.
    static volatile boolean foreground;
    private final MainActivity activity;

    MuseNotifications(Activity activity) {
        this.activity = (MainActivity) activity;
    }

    @Override
    public void handle(Object body, MuseBridgePlugin.Reply reply) {
        if (!(body instanceof JSONObject)) {
            reply.fail("Invalid notification request");
            return;
        }
        JSONObject request = (JSONObject) body;
        switch (request.optString("operation")) {
            case "status":
                reply.ok(status(activity));
                return;
            case "authorize":
                authorize(activity, (allowed) -> reply.ok(status(activity)));
                return;
            case "reply":
                String title = request.optString("title");
                if (title.isEmpty() || !(request.opt("body") instanceof String)) {
                    reply.fail("Invalid notification");
                    return;
                }
                if (foreground || status(activity).equals("denied")) {
                    reply.ok(false);
                    return;
                }
                post(activity, REPLIES, "open-muse-reply-" + UUID.randomUUID(), clip(title, 80), clip(request.optString("body"), 240));
                reply.ok(true);
                return;
            default:
                reply.fail("Unknown notification operation");
        }
    }

    static String status(Context context) {
        if (NotificationManagerCompat.from(context).areNotificationsEnabled()) return "allowed";
        if (Build.VERSION.SDK_INT >= 33 && !MainActivity.asked(context, Manifest.permission.POST_NOTIFICATIONS)) return "not-asked";
        return "denied";
    }

    static void authorize(MainActivity activity, java.util.function.Consumer<Boolean> done) {
        if (Build.VERSION.SDK_INT >= 33) {
            activity.requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, done);
        } else {
            done.accept(NotificationManagerCompat.from(activity).areNotificationsEnabled());
        }
    }

    static String clip(String text, int length) {
        return text.length() <= length ? text : text.substring(0, length);
    }

    // The two kinds of notification, each with its own switch in Android's
    // settings for the app.
    static void channels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
            REPLIES, context.getString(R.string.channel_replies), NotificationManager.IMPORTANCE_HIGH));
        manager.createNotificationChannel(new NotificationChannel(
            REMINDERS, context.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH));
    }

    // Tapping a notification brings Open Muse back where the person left it.
    static void post(Context context, String channel, String tag, String title, String text) {
        channels(context);
        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, tag.hashCode(), open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .setGroup(channel)
            .setCategory(channel.equals(REMINDERS) ? NotificationCompat.CATEGORY_REMINDER : NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH);
        if (!text.isEmpty()) {
            builder.setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text));
        }
        try {
            NotificationManagerCompat.from(context).notify(tag, 0, builder.build());
        } catch (SecurityException refused) {
            // Notifications were turned off in the meantime.
        }
    }
}
