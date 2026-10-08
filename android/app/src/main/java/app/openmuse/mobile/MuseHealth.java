package app.openmuse.mobile;

import android.app.Activity;
import android.health.connect.AggregateRecordsRequest;
import android.health.connect.AggregateRecordsResponse;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.ActiveCaloriesBurnedRecord;
import android.health.connect.datatypes.AggregationType;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.ExerciseSessionType;
import android.health.connect.datatypes.HeartRateRecord;
import android.health.connect.datatypes.Record;
import android.health.connect.datatypes.RestingHeartRateRecord;
import android.health.connect.datatypes.SleepSessionRecord;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.WeightRecord;
import android.health.connect.datatypes.units.Energy;
import android.health.connect.datatypes.units.Length;
import android.health.connect.datatypes.units.Mass;
import android.os.Build;
import android.os.OutcomeReceiver;
import androidx.annotation.RequiresApi;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.json.JSONObject;

// Reads one Health Connect metric over one time range when the bundled app
// asks, after the person shared that request in the chat: the Android
// counterpart of the iPhone app's Apple Health reader, with the same metrics
// and the same JSON summary. Health Connect is part of Android from version
// 14; nothing is written to it.
@RequiresApi(34)
final class MuseHealth implements MuseBridgePlugin.Feature {
    private static final long DAY = 86_400_000L;
    private static final String[] METRICS = {
        "steps", "active_energy", "exercise_minutes", "walking_running_distance",
        "heart_rate", "resting_heart_rate", "sleep", "workouts", "body_mass",
    };
    private final MainActivity activity;
    private final HealthConnectManager store;
    private final ExecutorService worker = Executors.newFixedThreadPool(4);
    // Health Connect answers on its own thread, so a worker waiting for an
    // answer never holds up another.
    private final java.util.concurrent.Executor answers = Runnable::run;

    MuseHealth(Activity activity) {
        this.activity = (MainActivity) activity;
        this.store = activity.getSystemService(HealthConnectManager.class);
    }

    static boolean supported() {
        return Build.VERSION.SDK_INT >= 34;
    }

    private static String permission(String metric) {
        switch (metric) {
            case "steps": return "android.permission.health.READ_STEPS";
            case "active_energy": return "android.permission.health.READ_ACTIVE_CALORIES_BURNED";
            case "exercise_minutes":
            case "workouts": return "android.permission.health.READ_EXERCISE";
            case "walking_running_distance": return "android.permission.health.READ_DISTANCE";
            case "heart_rate": return "android.permission.health.READ_HEART_RATE";
            case "resting_heart_rate": return "android.permission.health.READ_RESTING_HEART_RATE";
            case "sleep": return "android.permission.health.READ_SLEEP";
            case "body_mass": return "android.permission.health.READ_WEIGHT";
            default: return null;
        }
    }

    // Every metric this app reads, and data from before access was granted.
    private static String[] allPermissions() {
        List<String> permissions = new ArrayList<>();
        for (String metric : METRICS) {
            String permission = permission(metric);
            if (!permissions.contains(permission)) permissions.add(permission);
        }
        if (Build.VERSION.SDK_INT >= 35) permissions.add("android.permission.health.READ_HEALTH_DATA_HISTORY");
        return permissions.toArray(new String[0]);
    }

    private boolean anyGranted() {
        for (String permission : allPermissions()) {
            if (MainActivity.granted(activity, permission)) return true;
        }
        return false;
    }

    @Override
    public void handle(Object body, MuseBridgePlugin.Reply reply) {
        JSONObject request = body instanceof JSONObject ? (JSONObject) body : null;
        String operation = request == null ? "" : request.optString("operation");
        switch (operation) {
            case "available":
                reply.ok(store != null);
                return;
            // Like HealthKit, whether the question was asked, not the answer.
            case "access":
                if (store == null) reply.ok("unavailable");
                else reply.ok(anyGranted() || MainActivity.asked(activity, allPermissions()) ? "requested" : "not_requested");
                return;
            // Connecting asks once for every metric this app reads.
            case "authorize":
                if (store == null) {
                    reply.fail("Health data is not available on this device");
                    return;
                }
                activity.requestPermissions(allPermissions(), (all) -> {
                    if (anyGranted()) reply.ok(true);
                    else reply.fail("Health access was not granted");
                });
                return;
            case "read":
                read(request, reply);
                return;
            default:
                reply.fail("Invalid health request");
        }
    }

    private void read(JSONObject request, MuseBridgePlugin.Reply reply) {
        if (store == null) {
            reply.fail("Health data is not available on this device");
            return;
        }
        String metric = request.optString("metric");
        String granularity = request.optString("granularity");
        long start = (long) request.optDouble("start", 0);
        long end = (long) request.optDouble("end", 0);
        String permission = permission(metric);
        if (permission == null || !Arrays.asList("total", "day", "hour").contains(granularity)
                || !request.has("start") || !request.has("end") || end <= start || end - start > 366 * DAY
                || (granularity.equals("hour") && end - start > 16 * DAY)) {
            reply.fail("Invalid health request");
            return;
        }
        activity.requestPermissions(new String[] {permission}, (granted) -> {
            if (!granted) {
                reply.fail("Health access was not granted");
                return;
            }
            worker.execute(() -> {
                try {
                    Map<String, Object> body = summary(metric, Instant.ofEpochMilli(start), Instant.ofEpochMilli(end), granularity);
                    body.put("metric", metric);
                    body.put("start", MuseJson.stamp(start));
                    body.put("end", MuseJson.stamp(end));
                    body.put("time_zone", MuseJson.zone());
                    reply.ok(MuseJson.write(body));
                } catch (Exception error) {
                    reply.fail("Health data could not be read");
                }
            });
        });
    }

    private Map<String, Object> summary(String metric, Instant start, Instant end, String granularity) throws Exception {
        switch (metric) {
            case "sleep": return sleep(start, end, granularity);
            case "workouts": return workouts(start, end);
            default: return quantity(metric, start, end, granularity);
        }
    }

    // Bucket boundaries in local time; the first and last are clipped.
    private static List<Instant[]> buckets(Instant start, Instant end, String granularity) {
        List<Instant[]> result = new ArrayList<>();
        if (granularity.equals("total")) {
            result.add(new Instant[] {start, end});
            return result;
        }
        ZonedDateTime local = start.atZone(ZoneId.systemDefault());
        ZonedDateTime cursor = granularity.equals("hour")
            ? local.truncatedTo(ChronoUnit.HOURS) : local.toLocalDate().atStartOfDay(ZoneId.systemDefault());
        while (cursor.toInstant().isBefore(end) && result.size() < 400) {
            ZonedDateTime next = granularity.equals("hour") ? cursor.plusHours(1) : cursor.plusDays(1);
            Instant from = cursor.toInstant().isBefore(start) ? start : cursor.toInstant();
            Instant to = next.toInstant().isAfter(end) ? end : next.toInstant();
            result.add(new Instant[] {from, to});
            cursor = next;
        }
        return result;
    }

    private static TimeInstantRangeFilter range(Instant start, Instant end) {
        return new TimeInstantRangeFilter.Builder().setStartTime(start).setEndTime(end).build();
    }

    private <T> T await(Consumer<OutcomeReceiver<T, HealthConnectException>> call) throws Exception {
        CompletableFuture<T> result = new CompletableFuture<>();
        call.accept(new OutcomeReceiver<T, HealthConnectException>() {
            @Override
            public void onResult(T value) {
                result.complete(value);
            }

            @Override
            public void onError(HealthConnectException error) {
                result.completeExceptionally(error);
            }
        });
        return result.get(30, TimeUnit.SECONDS);
    }

    private <T> AggregateRecordsResponse<T> aggregate(Instant start, Instant end, List<AggregationType<T>> types) throws Exception {
        AggregateRecordsRequest.Builder<T> builder = new AggregateRecordsRequest.Builder<>(range(start, end));
        for (AggregationType<T> type : types) builder.addAggregationType(type);
        AggregateRecordsRequest<T> request = builder.build();
        return await((receiver) -> store.aggregate(request, answers, receiver));
    }

    private static String unit(String metric) {
        switch (metric) {
            case "active_energy": return "kcal";
            case "exercise_minutes": return "min";
            case "walking_running_distance": return "km";
            case "heart_rate":
            case "resting_heart_rate": return "bpm";
            case "body_mass": return "kg";
            default: return "count";
        }
    }

    // A sum for cumulative metrics; the average, minimum and maximum for the
    // others, in the same units as on the iPhone.
    private Map<String, Object> bucket(String metric, Instant from, Instant to) throws Exception {
        Map<String, Object> row = new HashMap<>();
        row.put("start", MuseJson.stamp(from.toEpochMilli()));
        row.put("end", MuseJson.stamp(to.toEpochMilli()));
        switch (metric) {
            case "steps": {
                Long value = aggregate(from, to, List.of(StepsRecord.STEPS_COUNT_TOTAL)).get(StepsRecord.STEPS_COUNT_TOTAL);
                row.put("sum", MuseJson.round(value == null ? 0 : value));
                break;
            }
            case "active_energy": {
                Energy value = aggregate(from, to, List.of(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL))
                    .get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL);
                row.put("sum", MuseJson.round(value == null ? 0 : value.getInCalories() / 1000));
                break;
            }
            case "exercise_minutes": {
                Long value = aggregate(from, to, List.of(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL))
                    .get(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL);
                row.put("sum", MuseJson.round(value == null ? 0 : value / 60_000.0));
                break;
            }
            case "walking_running_distance": {
                Length value = aggregate(from, to, List.of(DistanceRecord.DISTANCE_TOTAL)).get(DistanceRecord.DISTANCE_TOTAL);
                row.put("sum", MuseJson.round(value == null ? 0 : value.getInMeters() / 1000));
                break;
            }
            case "heart_rate":
            case "resting_heart_rate": {
                boolean resting = metric.equals("resting_heart_rate");
                AggregationType<Long> average = resting ? RestingHeartRateRecord.BPM_AVG : HeartRateRecord.BPM_AVG;
                AggregationType<Long> min = resting ? RestingHeartRateRecord.BPM_MIN : HeartRateRecord.BPM_MIN;
                AggregationType<Long> max = resting ? RestingHeartRateRecord.BPM_MAX : HeartRateRecord.BPM_MAX;
                AggregateRecordsResponse<Long> response = aggregate(from, to, List.of(average, min, max));
                if (response.get(average) != null) {
                    row.put("average", MuseJson.round(response.get(average)));
                    row.put("min", MuseJson.round(response.get(min) == null ? 0 : response.get(min)));
                    row.put("max", MuseJson.round(response.get(max) == null ? 0 : response.get(max)));
                }
                break;
            }
            case "body_mass": {
                AggregateRecordsResponse<Mass> response = aggregate(from, to,
                    List.of(WeightRecord.WEIGHT_AVG, WeightRecord.WEIGHT_MIN, WeightRecord.WEIGHT_MAX));
                Mass average = response.get(WeightRecord.WEIGHT_AVG);
                if (average != null) {
                    Mass min = response.get(WeightRecord.WEIGHT_MIN);
                    Mass max = response.get(WeightRecord.WEIGHT_MAX);
                    row.put("average", MuseJson.round(average.getInGrams() / 1000));
                    row.put("min", MuseJson.round(min == null ? 0 : min.getInGrams() / 1000));
                    row.put("max", MuseJson.round(max == null ? 0 : max.getInGrams() / 1000));
                }
                break;
            }
            default:
                throw new IllegalArgumentException(metric);
        }
        return row;
    }

    private Map<String, Object> quantity(String metric, Instant start, Instant end, String granularity) throws Exception {
        List<CompletableFuture<Map<String, Object>>> pending = new ArrayList<>();
        for (Instant[] range : buckets(start, end, granularity)) {
            pending.add(CompletableFuture.supplyAsync(() -> {
                try {
                    return bucket(metric, range[0], range[1]);
                } catch (Exception error) {
                    throw new RuntimeException(error);
                }
            }, worker));
        }
        List<Object> values = new ArrayList<>();
        for (CompletableFuture<Map<String, Object>> row : pending) values.add(row.get(60, TimeUnit.SECONDS));
        Map<String, Object> result = new HashMap<>();
        result.put("unit", unit(metric));
        result.put("granularity", granularity);
        result.put("values", values);
        return result;
    }

    private <T extends Record> List<T> records(Class<T> type, Instant start, Instant end, int limit, boolean newestFirst) throws Exception {
        List<T> result = new ArrayList<>();
        String token = null;
        do {
            ReadRecordsRequestUsingFilters.Builder<T> builder = new ReadRecordsRequestUsingFilters.Builder<>(type)
                .setTimeRangeFilter(range(start, end))
                .setPageSize(Math.min(limit - result.size(), 1000));
            if (token != null) builder.setPageToken(Long.parseLong(token));
            else builder.setAscending(!newestFirst);
            ReadRecordsRequestUsingFilters<T> request = builder.build();
            ReadRecordsResponse<T> page = await((receiver) -> store.readRecords(request, answers, receiver));
            result.addAll(page.getRecords());
            token = page.getNextPageToken() > 0 ? String.valueOf(page.getNextPageToken()) : null;
        } while (token != null && result.size() < limit);
        return result;
    }

    // Overlapping sessions from several sources are merged before summing. A
    // session without stages counts as asleep throughout.
    private Map<String, Object> sleep(Instant start, Instant end, String granularity) throws Exception {
        List<SleepSessionRecord> sessions = records(SleepSessionRecord.class, start, end, 5000, false);
        List<long[]> asleep = new ArrayList<>();
        List<long[]> inBed = new ArrayList<>();
        for (SleepSessionRecord session : sessions) {
            inBed.add(new long[] {session.getStartTime().toEpochMilli(), session.getEndTime().toEpochMilli()});
            if (session.getStages().isEmpty()) {
                asleep.add(new long[] {session.getStartTime().toEpochMilli(), session.getEndTime().toEpochMilli()});
                continue;
            }
            for (SleepSessionRecord.Stage stage : session.getStages()) {
                switch (stage.getType()) {
                    case SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING:
                    case SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_LIGHT:
                    case SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_DEEP:
                    case SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_REM:
                        asleep.add(new long[] {stage.getStartTime().toEpochMilli(), stage.getEndTime().toEpochMilli()});
                        break;
                    default:
                        break;
                }
            }
        }
        List<long[]> asleepMerged = merged(asleep, start.toEpochMilli(), end.toEpochMilli());
        List<long[]> inBedMerged = merged(inBed, start.toEpochMilli(), end.toEpochMilli());
        List<Object> values = new ArrayList<>();
        // A night belongs to the bucket in which it ends.
        for (Instant[] range : buckets(start, end, granularity)) {
            Map<String, Object> row = new HashMap<>();
            row.put("start", MuseJson.stamp(range[0].toEpochMilli()));
            row.put("end", MuseJson.stamp(range[1].toEpochMilli()));
            row.put("asleep_minutes", minutes(asleepMerged, range[0].toEpochMilli(), range[1].toEpochMilli()));
            row.put("in_bed_minutes", minutes(inBedMerged, range[0].toEpochMilli(), range[1].toEpochMilli()));
            values.add(row);
        }
        Map<String, Object> result = new HashMap<>();
        result.put("unit", "min");
        result.put("granularity", granularity);
        result.put("values", values);
        return result;
    }

    private static List<long[]> merged(List<long[]> intervals, long start, long end) {
        List<long[]> clipped = new ArrayList<>();
        for (long[] interval : intervals) {
            long from = Math.max(interval[0], start), to = Math.min(interval[1], end);
            if (from < to) clipped.add(new long[] {from, to});
        }
        clipped.sort((a, b) -> Long.compare(a[0], b[0]));
        List<long[]> result = new ArrayList<>();
        for (long[] interval : clipped) {
            long[] last = result.isEmpty() ? null : result.get(result.size() - 1);
            if (last != null && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
            else result.add(interval);
        }
        return result;
    }

    private static double minutes(List<long[]> intervals, long from, long to) {
        double total = 0;
        for (long[] interval : intervals) {
            if (interval[1] > from && interval[1] <= to) total += interval[1] - interval[0];
        }
        return MuseJson.round(total / 60_000.0);
    }

    private Map<String, Object> workouts(Instant start, Instant end) throws Exception {
        List<ExerciseSessionRecord> sessions = records(ExerciseSessionRecord.class, start, end, 50, true);
        List<Object> rows = new ArrayList<>();
        for (ExerciseSessionRecord session : sessions) {
            Map<String, Object> row = new HashMap<>();
            row.put("type", activityName(session.getExerciseType()));
            row.put("start", MuseJson.stamp(session.getStartTime().toEpochMilli()));
            row.put("end", MuseJson.stamp(session.getEndTime().toEpochMilli()));
            row.put("minutes", MuseJson.round((session.getEndTime().toEpochMilli() - session.getStartTime().toEpochMilli()) / 60_000.0));
            // Energy and distance over the session, when the person shared them.
            try {
                Energy energy = aggregate(session.getStartTime(), session.getEndTime(),
                    List.of(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)).get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL);
                if (energy != null && energy.getInCalories() > 0) row.put("active_kcal", MuseJson.round(energy.getInCalories() / 1000));
            } catch (Exception notShared) {
                // Left out.
            }
            try {
                Length distance = aggregate(session.getStartTime(), session.getEndTime(),
                    List.of(DistanceRecord.DISTANCE_TOTAL)).get(DistanceRecord.DISTANCE_TOTAL);
                if (distance != null && distance.getInMeters() > 0) row.put("km", MuseJson.round(distance.getInMeters() / 1000));
            } catch (Exception notShared) {
                // Left out.
            }
            rows.add(row);
        }
        Map<String, Object> result = new HashMap<>();
        result.put("workouts", rows);
        result.put("truncated", sessions.size() >= 50);
        return result;
    }

    private static String activityName(int type) {
        switch (type) {
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING:
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING_TREADMILL: return "running";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_WALKING: return "walking";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_BIKING:
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_BIKING_STATIONARY: return "cycling";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_SWIMMING_POOL:
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_SWIMMING_OPEN_WATER: return "swimming";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_HIKING: return "hiking";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_YOGA: return "yoga";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_STRENGTH_TRAINING:
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_WEIGHTLIFTING: return "strength training";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING: return "high-intensity interval training";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_ELLIPTICAL: return "elliptical";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_ROWING:
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_ROWING_MACHINE: return "rowing";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_CALISTHENICS: return "core training";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_PILATES: return "pilates";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_DANCING: return "dance";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_TENNIS: return "tennis";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_BASKETBALL: return "basketball";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_SOCCER: return "soccer";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_STAIR_CLIMBING:
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_STAIR_CLIMBING_MACHINE: return "stairs";
            case ExerciseSessionType.EXERCISE_SESSION_TYPE_STRETCHING: return "cooldown";
            default: return "other";
        }
    }
}
