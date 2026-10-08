package app.openmuse.mobile;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

// Compact JSON for the agent, with sorted keys as the iPhone app writes it,
// and the date formats the device tools share with it.
final class MuseJson {
    private MuseJson() {}

    static String write(Object value) {
        StringBuilder out = new StringBuilder();
        append(out, value);
        return out.toString();
    }

    @SuppressWarnings("unchecked")
    private static void append(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof Map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> entry : new TreeMap<>((Map<String, Object>) value).entrySet()) {
                if (!first) out.append(',');
                first = false;
                out.append(quote(entry.getKey())).append(':');
                append(out, entry.getValue());
            }
            out.append('}');
        } else if (value instanceof List) {
            out.append('[');
            boolean first = true;
            for (Object item : (List<Object>) value) {
                if (!first) out.append(',');
                first = false;
                append(out, item);
            }
            out.append(']');
        } else if (value instanceof Boolean) {
            out.append(value);
        } else if (value instanceof Double || value instanceof Float) {
            double number = ((Number) value).doubleValue();
            if (number == Math.rint(number) && Math.abs(number) < 1e15) out.append((long) number);
            else out.append(number);
        } else if (value instanceof Number) {
            out.append(value);
        } else {
            out.append(quote(value.toString()));
        }
    }

    // JSON string escaping that leaves "/" alone, unlike JSONObject.quote.
    static String quote(String text) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        return out.append('"').toString();
    }

    static String failure(String message) {
        Map<String, Object> result = new TreeMap<>();
        result.put("ok", false);
        result.put("error", message);
        return write(result);
    }

    // A time in this phone's time zone, to the second: 2026-10-08T09:30:00+08:00.
    static String stamp(long millis) {
        return ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(millis), ZoneId.systemDefault())
            .truncatedTo(ChronoUnit.SECONDS)
            .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    // Accepts full ISO 8601 times, and local times or dates without a zone.
    static Long parse(String text) {
        try {
            return OffsetDateTime.parse(text).toInstant().toEpochMilli();
        } catch (DateTimeParseException ignored) {
            // Try a local time next.
        }
        try {
            return LocalDateTime.parse(text).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (DateTimeParseException ignored) {
            // Try a date next.
        }
        try {
            return LocalDate.parse(text).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (DateTimeParseException ignored) {
            return null;
        }
    }

    static double round(double value) {
        return Math.round(value * 10) / 10.0;
    }

    static String zone() {
        return ZoneId.systemDefault().getId();
    }
}
