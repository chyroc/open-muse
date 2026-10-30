using System;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OpenMuse.Computer;

// How the device tools write their results for the model: plain JSON with
// text and offsets unescaped (the default encoder writes "+" and every
// Chinese character as \uXXXX), and time zones by their IANA names, as the
// Mac reports them.
public static class ToolJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string Write(object value) => JsonSerializer.Serialize(value, Options);
    public static string Write(JsonNode value) => value.ToJsonString(Options);

    public static string TimeZone =>
        TimeZoneInfo.TryConvertWindowsIdToIanaId(TimeZoneInfo.Local.Id, out var iana) ? iana : TimeZoneInfo.Local.Id;
}
