using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OpenMuse;

// The shell's own preferences for one profile, in settings.json beside its
// data: window bounds, appearance and language for native UI, the tray and
// floating button, shortcuts, and updates. The page keeps its own choices.
public sealed class Settings
{
    private readonly string path;
    private JsonObject values;

    public Settings(Profile profile)
    {
        path = profile.File("settings.json");
        try { values = JsonNode.Parse(File.ReadAllText(path)) as JsonObject ?? new JsonObject(); }
        catch (Exception) { values = new JsonObject(); }
    }

    public T? Get<T>(string key, T? fallback = default)
    {
        try { return values.TryGetPropertyValue(key, out var node) && node is not null ? node.GetValue<T>() : fallback; }
        catch (Exception) { return fallback; }
    }

    public JsonNode? Node(string key) => values.TryGetPropertyValue(key, out var node) ? node : null;

    public void Set(string key, JsonNode? value)
    {
        values[key] = value;
        Save();
    }

    public void Remove(string key)
    {
        values.Remove(key);
        Save();
    }

    public void Clear()
    {
        values = new JsonObject();
        Save();
    }

    private void Save()
    {
        var temp = path + ".tmp";
        File.WriteAllText(temp, values.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temp, path, true);
    }
}

// Native text (tray menu, dialogs, jump list) in the app's language, from the
// Mac app's Localizable.strings, converted to strings/<language>.json by the
// build so both shells share one catalog.
public static class Strings
{
    private static Dictionary<string, string> table = new();
    public static string Language { get; private set; } = "en";

    // "en", "zh-CN" or "system", as the page's language choice.
    public static void Load(string choice)
    {
        var chinese = choice == "zh-CN" ||
            (choice != "en" && SystemLanguages()[0].StartsWith("zh", StringComparison.OrdinalIgnoreCase));
        Language = chinese ? "zh-CN" : "en";
        var file = Path.Combine(AppContext.BaseDirectory, "strings", chinese ? "zh-Hans.json" : "en.json");
        try { table = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(file)) ?? new(); }
        catch (Exception) { table = new(); }
    }

    public static string T(string key) => table.TryGetValue(key, out var value) ? value : key;

    // The system's preferred languages, which the page follows when no
    // language is chosen (window.__OPEN_MUSE_LANGUAGES__).
    public static string[] SystemLanguages()
    {
        try
        {
            var list = new List<string>(global::Windows.System.UserProfile.GlobalizationPreferences.Languages);
            if (list.Count > 0) return list.ToArray();
        }
        catch (Exception)
        {
            // Fall back to the UI culture.
        }
        return [CultureInfo.CurrentUICulture.Name];
    }
}
