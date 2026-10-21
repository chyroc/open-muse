using System;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Windows.Devices.Geolocation;

namespace OpenMuse.Computer;

// mac_location on Windows: this PC's approximate position from Windows location
// services, rounded to about a kilometer, as the Mac reports its own.
public static class LocalLocation
{
    public const string Tool = "mac_location";

    // "allowed", "denied", or "not-asked" before Windows has answered.
    public static async Task<string> State()
    {
        try
        {
            return await Geolocator.RequestAccessAsync() switch
            {
                GeolocationAccessStatus.Allowed => "allowed",
                GeolocationAccessStatus.Denied => "denied",
                _ => "not-asked",
            };
        }
        catch (Exception)
        {
            return "denied";
        }
    }

    public static async Task<(bool Ok, string Text)> Run()
    {
        if (await State() != "allowed")
            return (false, JsonSerializer.Serialize(new { ok = false, error = "Windows location access is off for Open Muse." }));
        try
        {
            var locator = new Geolocator { DesiredAccuracyInMeters = 1000 };
            var fix = await locator.GetGeopositionAsync(TimeSpan.FromMinutes(5), TimeSpan.FromSeconds(15));
            var point = fix.Coordinate.Point.Position;
            var result = new JsonObject
            {
                ["latitude"] = Math.Round(point.Latitude, 2),
                ["longitude"] = Math.Round(point.Longitude, 2),
                ["accuracy_meters"] = Math.Max(1000, (int)Math.Round(fix.Coordinate.Accuracy)),
                ["measured_at"] = fix.Coordinate.Timestamp.ToLocalTime().ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture),
                ["time_zone"] = TimeZoneInfo.Local.Id,
            };
            return (true, result.ToJsonString());
        }
        catch (Exception)
        {
            return (false, JsonSerializer.Serialize(new { ok = false, error = "Windows could not find this PC's location right now." }));
        }
    }
}
