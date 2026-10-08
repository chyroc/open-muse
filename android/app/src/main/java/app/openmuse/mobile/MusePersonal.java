package app.openmuse.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

// Reads Calendar and Contacts on this phone when the bundled app asks, after
// the person approved that request in the chat. It only reads: nothing is
// created, changed or deleted. Each source has its own Android permission; a
// refusal is reported back as a result, never retried here. Android has no
// system reminders list, so reminders are reported as unavailable.
final class MusePersonal implements MuseBridgePlugin.Feature {
    private static final long DAY = 86_400_000L;
    private static final long MAX_DAYS = 92;
    private final MainActivity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    MusePersonal(Activity activity) {
        this.activity = (MainActivity) activity;
    }

    private static String permission(String source) {
        return source.equals("contacts") ? Manifest.permission.READ_CONTACTS : Manifest.permission.READ_CALENDAR;
    }

    @Override
    public void handle(Object body, MuseBridgePlugin.Reply reply) {
        JSONObject request = body instanceof JSONObject ? (JSONObject) body : null;
        String source = request == null ? "" : request.optString("source");
        if (!source.equals("calendar") && !source.equals("reminders") && !source.equals("contacts")) {
            reply.fail("Invalid request");
            return;
        }
        switch (request.optString("operation")) {
            case "access":
                reply.ok(state(source));
                return;
            case "authorize":
                if (source.equals("reminders")) {
                    reply.ok(state(source));
                    return;
                }
                activity.requestPermissions(new String[] {permission(source)}, (granted) -> reply.ok(state(source)));
                return;
            case "read":
                if (source.equals("reminders")) {
                    reply.ok(MuseJson.failure("Android has no Reminders app to read open reminders from. Use another source the person names, such as Lark tasks."));
                    return;
                }
                if (!state(source).equals("allowed")) {
                    reply.ok(MuseJson.failure(source.equals("contacts")
                        ? "Open Muse is not allowed to read Contacts on this phone."
                        : "Open Muse is not allowed to read Calendar on this phone."));
                    return;
                }
                JSONObject input = request.optJSONObject("input");
                JSONObject query = input == null ? new JSONObject() : input;
                worker.execute(() -> {
                    try {
                        reply.ok(source.equals("contacts") ? contacts(query) : calendar(query));
                    } catch (Exception error) {
                        reply.ok(MuseJson.failure(source.equals("contacts")
                            ? "Contacts could not be read." : "Calendar could not be read."));
                    }
                });
                return;
            default:
                reply.fail("Invalid request");
        }
    }

    private String state(String source) {
        if (source.equals("reminders")) return "denied";
        String permission = permission(source);
        if (MainActivity.granted(activity, permission)) return "allowed";
        return MainActivity.asked(activity, permission) ? "denied" : "not-asked";
    }

    private static boolean matches(String query, String... fields) {
        if (query.isEmpty()) return true;
        String needle = query.toLowerCase(Locale.ROOT);
        for (String field : fields) {
            if (field != null && field.toLowerCase(Locale.ROOT).contains(needle)) return true;
        }
        return false;
    }

    private static int limit(JSONObject input, int fallback, int most) {
        return Math.min(most, Math.max(1, input.optInt("limit", fallback)));
    }

    private String calendar(JSONObject input) {
        Long from = input.has("from") ? MuseJson.parse(input.optString("from")) : Long.valueOf(System.currentTimeMillis());
        Long given = input.has("to") ? MuseJson.parse(input.optString("to")) : null;
        if (from == null || (input.has("to") && given == null)) return MuseJson.failure("from and to must be ISO 8601 dates.");
        long start = from;
        long end = given != null ? given : start + 7 * DAY;
        if (end <= start || end - start > MAX_DAYS * DAY) {
            return MuseJson.failure("The range must end after it starts and span at most 92 days.");
        }
        String query = input.optString("query", "").trim();
        int limit = limit(input, 50, 200);
        Uri.Builder uri = CalendarContract.Instances.CONTENT_URI.buildUpon();
        android.content.ContentUris.appendId(uri, start);
        android.content.ContentUris.appendId(uri, end);
        String[] projection = {
            CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.DESCRIPTION, CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
        };
        List<Object> items = new ArrayList<>();
        int total = 0;
        try (Cursor cursor = activity.getContentResolver().query(uri.build(), projection,
                CalendarContract.Instances.VISIBLE + "=1", null, CalendarContract.Instances.BEGIN + " ASC")) {
            while (cursor != null && cursor.moveToNext()) {
                String title = cursor.getString(0);
                String location = cursor.getString(4);
                String notes = cursor.getString(5);
                if (!matches(query, title, location, notes)) continue;
                total++;
                if (items.size() >= limit) continue;
                boolean allDay = cursor.getInt(3) == 1;
                Map<String, Object> row = new HashMap<>();
                row.put("title", title == null ? "" : title);
                row.put("start", MuseJson.stamp(allDay ? localDay(cursor.getLong(1)) : cursor.getLong(1)));
                row.put("end", MuseJson.stamp(allDay ? localDay(cursor.getLong(2)) : cursor.getLong(2)));
                row.put("all_day", allDay);
                row.put("calendar", cursor.getString(6) == null ? "" : cursor.getString(6));
                if (location != null && !location.isEmpty()) row.put("location", location);
                if (notes != null && !notes.isEmpty()) row.put("notes", notes.length() > 500 ? notes.substring(0, 500) : notes);
                items.add(row);
            }
        }
        Map<String, Object> result = new HashMap<>();
        result.put("kind", "events");
        result.put("from", MuseJson.stamp(start));
        result.put("to", MuseJson.stamp(end));
        result.put("time_zone", MuseJson.zone());
        result.put("total", total);
        result.put("items", items);
        return MuseJson.write(result);
    }

    // All-day events are stored at UTC midnight; they start at local midnight.
    private static long localDay(long utc) {
        LocalDate day = Instant.ofEpochMilli(utc).atZone(ZoneOffset.UTC).toLocalDate();
        return day.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    // By name first; a phone number or email is matched against every contact.
    private String contacts(JSONObject input) {
        String query = input.optString("query", "").trim();
        if (query.isEmpty() || query.length() > 100) return MuseJson.failure("query must not be empty.");
        int limit = limit(input, 10, 20);
        ContentResolver resolver = activity.getContentResolver();
        Set<Long> found = new LinkedHashSet<>();
        collect(resolver, Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_FILTER_URI, Uri.encode(query)),
            ContactsContract.Contacts._ID, found);
        if (found.isEmpty()) {
            String digits = query.replaceAll("[^0-9]", "");
            if (digits.length() >= 4) {
                collect(resolver, Uri.withAppendedPath(ContactsContract.CommonDataKinds.Phone.CONTENT_FILTER_URI, Uri.encode(digits)),
                    ContactsContract.CommonDataKinds.Phone.CONTACT_ID, found);
            }
            collect(resolver, Uri.withAppendedPath(ContactsContract.CommonDataKinds.Email.CONTENT_FILTER_URI, Uri.encode(query)),
                ContactsContract.CommonDataKinds.Email.CONTACT_ID, found);
        }
        List<Object> items = new ArrayList<>();
        for (Long id : found) {
            if (items.size() >= limit) break;
            items.add(contact(resolver, id));
        }
        Map<String, Object> result = new HashMap<>();
        result.put("query", query);
        result.put("total", found.size());
        result.put("items", items);
        return MuseJson.write(result);
    }

    private static void collect(ContentResolver resolver, Uri uri, String column, Set<Long> into) {
        try (Cursor cursor = resolver.query(uri, new String[] {column}, null, null, null)) {
            while (cursor != null && cursor.moveToNext() && into.size() < 200) into.add(cursor.getLong(0));
        }
    }

    private Map<String, Object> contact(ContentResolver resolver, long id) {
        Map<String, Object> row = new HashMap<>();
        row.put("name", "");
        List<Object> phones = new ArrayList<>();
        List<Object> emails = new ArrayList<>();
        String[] projection = {
            ContactsContract.Data.MIMETYPE, ContactsContract.Data.DATA1, ContactsContract.Data.DATA2,
            ContactsContract.Data.DATA3, ContactsContract.Data.DATA4,
            ContactsContract.Data.DISPLAY_NAME,
        };
        try (Cursor cursor = resolver.query(ContactsContract.Data.CONTENT_URI, projection,
                ContactsContract.Data.CONTACT_ID + "=?", new String[] {String.valueOf(id)}, null)) {
            while (cursor != null && cursor.moveToNext()) {
                String type = cursor.getString(0);
                String value = cursor.getString(1);
                if (cursor.getString(5) != null) row.put("name", cursor.getString(5));
                if (value == null || value.isEmpty()) continue;
                switch (type) {
                    case ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE: {
                        Map<String, Object> phone = new HashMap<>();
                        phone.put("label", ContactsContract.CommonDataKinds.Phone.getTypeLabel(
                            activity.getResources(), cursor.getInt(2), cursor.getString(3)).toString());
                        phone.put("number", value);
                        phones.add(phone);
                        break;
                    }
                    case ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE:
                        emails.add(value);
                        break;
                    case ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE:
                        row.put("organization", value);
                        if (cursor.getString(4) != null && !cursor.getString(4).isEmpty()) row.put("job_title", cursor.getString(4));
                        break;
                    case ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE:
                        if (cursor.getInt(2) == ContactsContract.CommonDataKinds.Event.TYPE_BIRTHDAY) row.put("birthday", value);
                        break;
                    default:
                        break;
                }
            }
        }
        if (!phones.isEmpty()) row.put("phones", phones);
        if (!emails.isEmpty()) row.put("emails", emails);
        return row;
    }
}
