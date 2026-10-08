package app.openmuse.mobile;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.SystemClock;

// A shake of the phone while Open Muse is in front, reported at most once a
// second, the way the iPhone app turns the system shake gesture into the
// page's "muse-shake" event (see shake.ts).
final class MuseShake implements SensorEventListener {
    // About 2.5 g of acceleration on top of gravity, for two readings within
    // half a second, separates a deliberate shake from a bump or a step.
    private static final float THRESHOLD = 2.5f * SensorManager.GRAVITY_EARTH;
    private final SensorManager sensors;
    private final Runnable onShake;
    private long firstPeak;
    private long lastShake;

    MuseShake(Context context, Runnable onShake) {
        this.sensors = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        this.onShake = onShake;
    }

    void start() {
        Sensor sensor = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
        if (sensor != null) sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI);
    }

    void stop() {
        if (sensors != null) sensors.unregisterListener(this);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        float x = event.values[0], y = event.values[1], z = event.values[2];
        if (x * x + y * y + z * z < THRESHOLD * THRESHOLD) return;
        long now = SystemClock.uptimeMillis();
        if (now - firstPeak > 500) {
            firstPeak = now;
            return;
        }
        if (now - lastShake < 1000) return;
        lastShake = now;
        firstPeak = 0;
        onShake.run();
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
