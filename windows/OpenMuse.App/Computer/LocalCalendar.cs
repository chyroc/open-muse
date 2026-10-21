using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace OpenMuse.Computer;

// mac_calendar on Windows: the person's calendar events and open tasks, read-only,
// from classic Outlook on this PC through its automation interface, the way
// the Mac reads Calendar and Reminders. Without classic Outlook there is no
// calendar to read, and the tool says so.
public static class LocalCalendar
{
    public const string Tool = "mac_calendar";
    private const int MaxDays = 92;

    // Classic Outlook registers this; the new Outlook and Mail do not.
    public static bool Available
    {
        get
        {
            using var key = Registry.ClassesRoot.OpenSubKey(@"Outlook.Application\CLSID");
            return key is not null;
        }
    }

    // "allowed" when classic Outlook is installed, otherwise "denied".
    public static string State => Available ? "allowed" : "denied";

    private static string Json(object value) => JsonSerializer.Serialize(value);
    private static (bool, string) Failure(string message) => (false, Json(new { ok = false, error = message }));

    public static Task<(bool Ok, string Text)> Run(JsonElement input) => Task.Run(() => Read(input));

    private static (bool Ok, string Text) Read(JsonElement input)
    {
        var kind = input.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString() : null;
        if (kind is not ("events" or "reminders")) return Failure("kind must be events or reminders.");
        if (!Available) return Failure("Classic Outlook is not installed on this PC, so there is no calendar to read.");
        DateTime? from = null, to = null;
        if (input.TryGetProperty("from", out var f) && (from = Parse(f)) is null) return Failure("from and to must be ISO 8601 dates.");
        if (input.TryGetProperty("to", out var t) && (to = Parse(t)) is null) return Failure("from and to must be ISO 8601 dates.");
        var limit = Math.Clamp(input.TryGetProperty("limit", out var l) && l.TryGetInt32(out var n) ? n : 50, 1, 200);
        var query = input.TryGetProperty("query", out var q) && q.ValueKind == JsonValueKind.String ? q.GetString()!.Trim() : "";
        bool Matches(params string?[] fields) =>
            query.Length == 0 || fields.Any(field => field?.Contains(query, StringComparison.CurrentCultureIgnoreCase) == true);
        dynamic? outlook = null;
        try
        {
            var type = Type.GetTypeFromProgID("Outlook.Application");
            if (type is null) return Failure("Classic Outlook is not installed on this PC, so there is no calendar to read.");
            outlook = Activator.CreateInstance(type);
            dynamic session = outlook!.GetNamespace("MAPI");
            if (kind == "events")
            {
                var start = from ?? DateTime.Now;
                var end = to ?? start.AddDays(7);
                if (end <= start || (end - start).TotalDays > MaxDays)
                    return Failure("The range must end after it starts and span at most 92 days.");
                dynamic items = session.GetDefaultFolder(9).Items;
                items.IncludeRecurrences = true;
                items.Sort("[Start]");
                var filter = $"[Start] < '{end.ToString("g", CultureInfo.CurrentCulture)}' AND [End] > '{start.ToString("g", CultureInfo.CurrentCulture)}'";
                dynamic found = items.Restrict(filter);
                var rows = new List<JsonObject>();
                var total = 0;
                foreach (dynamic item in found)
                {
                    string title = item.Subject ?? "", location = item.Location ?? "", notes = item.Body ?? "";
                    if (!Matches(title, location, notes)) continue;
                    total++;
                    if (rows.Count >= limit) continue;
                    var row = new JsonObject
                    {
                        ["title"] = title,
                        ["start"] = Stamp((DateTime)item.Start),
                        ["end"] = Stamp((DateTime)item.End),
                        ["all_day"] = (bool)item.AllDayEvent,
                        ["calendar"] = "Outlook",
                    };
                    if (location.Length > 0) row["location"] = location;
                    if (notes.Trim().Length > 0) row["notes"] = notes.Trim()[..Math.Min(500, notes.Trim().Length)];
                    rows.Add(row);
                }
                var result = new JsonObject
                {
                    ["kind"] = "events", ["from"] = Stamp(start), ["to"] = Stamp(end),
                    ["time_zone"] = TimeZoneInfo.Local.Id, ["total"] = total,
                    ["items"] = new JsonArray(rows.ToArray()),
                };
                return (true, result.ToJsonString());
            }
            dynamic tasks = session.GetDefaultFolder(13).Items.Restrict("[Complete] = False");
            var open = new List<(DateTime? Due, JsonObject Row)>();
            foreach (dynamic item in tasks)
            {
                string title = item.Subject ?? "", notes = item.Body ?? "";
                if (!Matches(title, notes)) continue;
                DateTime due = item.DueDate;
                DateTime? dueDate = due.Year >= 4000 ? null : due;
                if (to is { } limitDate && dueDate is { } d && d > limitDate) continue;
                var row = new JsonObject { ["title"] = title, ["list"] = "Outlook" };
                if (dueDate is { } at) row["due"] = Stamp(at);
                int importance = item.Importance;
                if (importance == 2) row["priority"] = 1;
                if (notes.Trim().Length > 0) row["notes"] = notes.Trim()[..Math.Min(500, notes.Trim().Length)];
                open.Add((dueDate, row));
            }
            var sorted = open.OrderBy(x => x.Due ?? DateTime.MaxValue).ThenBy(x => x.Row["title"]!.GetValue<string>()).ToList();
            var reminders = new JsonObject
            {
                ["kind"] = "reminders", ["time_zone"] = TimeZoneInfo.Local.Id, ["total"] = sorted.Count,
                ["items"] = new JsonArray(sorted.Take(limit).Select(x => (JsonNode)x.Row).ToArray()),
            };
            if (to is { } dueBy) reminders["due_by"] = Stamp(dueBy);
            return (true, reminders.ToJsonString());
        }
        catch (Exception)
        {
            return Failure("Outlook could not be read. Open Outlook once and make sure it is set up, then try again.");
        }
    }

    private static DateTime? Parse(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String) return null;
        var text = value.GetString()!;
        if (DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed))
            return parsed.LocalDateTime;
        return null;
    }

    private static string Stamp(DateTime local) =>
        new DateTimeOffset(DateTime.SpecifyKind(local, DateTimeKind.Local)).ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);
}
