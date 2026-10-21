using System.Text.Json;

namespace OpenMuse.Core;

// One request from the page, as the bridge script posts it:
// {"__muse": true, "id": n, "name": "museCredentials", "body": {...}}.
// Bodies follow the Mac contract: a flat object whose values are strings.
// Numbers and booleans are accepted and turned into their string form, as
// WebKit does; nested values are refused.
public sealed record Message(long Id, string Name, IReadOnlyDictionary<string, string> Body)
{
    // The handlers the Mac shell offers; the page feature-detects each one.
    public static readonly string[] Handlers =
    [
        "museCredentials", "musePresence", "museComputer", "museDictation",
        "museShortcut", "museSpeech", "museUpdate", "museReport", "museExport",
        "museWindow",
    ];

    // Handlers whose postMessage resolves to nothing; the others reply.
    public static readonly string[] FireAndForget = ["museExport", "museWindow"];

    public static Message? Parse(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("__muse", out var marker) || marker.ValueKind != JsonValueKind.True) return null;
            if (!root.TryGetProperty("id", out var id) || !id.TryGetInt64(out var number)) return null;
            if (!root.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String) return null;
            var handler = name.GetString()!;
            if (!Handlers.Contains(handler)) return null;
            var body = new Dictionary<string, string>();
            if (root.TryGetProperty("body", out var value) && value.ValueKind == JsonValueKind.Object)
            {
                foreach (var field in value.EnumerateObject())
                {
                    switch (field.Value.ValueKind)
                    {
                        case JsonValueKind.String: body[field.Name] = field.Value.GetString()!; break;
                        case JsonValueKind.Number: body[field.Name] = field.Value.GetRawText(); break;
                        case JsonValueKind.True: body[field.Name] = "true"; break;
                        case JsonValueKind.False: body[field.Name] = "false"; break;
                        case JsonValueKind.Null: break;
                        default: return null;
                    }
                }
            }
            else if (root.TryGetProperty("body", out var other) && other.ValueKind != JsonValueKind.Null && other.ValueKind != JsonValueKind.Undefined)
                return null;
            return new Message(number, handler, body);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public string? Get(string key) => Body.TryGetValue(key, out var value) ? value : null;

    // The answer the bridge script resolves or rejects the promise with.
    public static string Reply(long id, object? value) =>
        JsonSerializer.Serialize(new Dictionary<string, object?> { ["__museReply"] = true, ["id"] = id, ["ok"] = true, ["value"] = value });

    public static string Failure(long id, string error) =>
        JsonSerializer.Serialize(new Dictionary<string, object?> { ["__museReply"] = true, ["id"] = id, ["ok"] = false, ["error"] = error });
}
