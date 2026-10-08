package app.openmuse.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

// Android freezes an app soon after the person leaves it, which would stop a
// reply mid-way. While one is being written, leaving Open Muse starts this
// short foreground service so the reply can finish and be announced, as iOS
// allows on its own; it ends when the reply does, when the person returns, or
// when Android's few-minute limit for such work is reached. Android 14 and
// later only.
public final class MuseReplyService extends Service {
    private static final String CHANNEL = "working";
    private static final int NOTIFICATION = 1;
    // A reply is being written, as the page last reported.
    static volatile boolean replying;

    static boolean supported() {
        return Build.VERSION.SDK_INT >= 34;
    }

    // Whether the service started.
    static boolean start(Context context) {
        if (!supported() || !replying) return false;
        try {
            context.startForegroundService(new Intent(context, MuseReplyService.class));
            return true;
        } catch (Exception notAllowed) {
            // Android did not allow it now; the reply resumes when the app does.
            return false;
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, MuseReplyService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
            CHANNEL, getString(R.string.channel_working), NotificationManager.IMPORTANCE_MIN));
        startForeground(NOTIFICATION, new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(R.string.finishing_reply))
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setSilent(true)
                .build(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        if (!replying) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onTimeout(int startId) {
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
