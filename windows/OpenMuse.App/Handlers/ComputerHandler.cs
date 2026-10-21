using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.Win32;
using OpenMuse.Computer;
using OpenMuse.Core;

namespace OpenMuse.Handlers;

// museComputer: computer use and the local connectors (Calendar, Reminders
// and Location), as the Mac shell offers them. Computer use is off until the
// person turns it on for this PC, and only the workspace window, where each
// call is approved, runs a tool. Windows asks no separate permission for
// screen capture or input, so those always read as allowed.
public sealed class ComputerHandler(ShellApp app) : IHandler
{
    private readonly Computer.Computer computer = new();

    private bool Enabled => app.Settings.Get("computerUse.enabled", false);
    private bool KeepAwake => app.Settings.Get("computerUse.keepAwake", false);
    private string Policy
    {
        get
        {
            var value = app.Settings.Get<string>("computerUse.policy") ?? "ask";
            return value is "ask" or "allow" or "deny" ? value : "ask";
        }
    }
    private bool CalendarOn => app.Settings.Get("connectors.calendar", false);
    private bool RemindersOn => app.Settings.Get("connectors.reminders", false);
    private bool LocationOn => app.Settings.Get("connectors.location", false);

    private List<JsonObject> BlockedApps =>
        (app.Settings.Node("computerUse.blockedApps") as JsonArray)?.OfType<JsonObject>()
            .Where(item => item["id"] is not null && item["name"] is not null).ToList() ?? new();

    private List<string> BlockedFolders =>
        (app.Settings.Node("computerUse.blockedFolders") as JsonArray)?.Select(item => item?.GetValue<string>() ?? "")
            .Where(Path.IsPathFullyQualified).ToList() ?? new();

    private async Task<JsonObject> State() => new()
    {
        ["enabled"] = Enabled,
        ["accessibility"] = true,
        ["screen"] = true,
        ["keepAwake"] = KeepAwake,
        ["blocked"] = new JsonArray(BlockedApps.Select(item => (JsonNode)item.DeepClone()).ToArray()),
        ["fullDiskAccess"] = true,
        ["blockedFolders"] = new JsonArray(BlockedFolders.Select(path => (JsonNode)JsonValue.Create(path)!).ToArray()),
        ["policy"] = Policy,
        ["calendar"] = new JsonObject
        {
            ["enabled"] = CalendarOn,
            ["events"] = LocalCalendar.State,
            ["remindersEnabled"] = RemindersOn,
            ["reminders"] = LocalCalendar.State,
        },
        ["location"] = new JsonObject
        {
            ["enabled"] = LocationOn,
            ["permission"] = await LocalLocation.State(),
        },
    };

    private static bool? Flag(Message message) => message.Get("value") switch
    {
        "true" => true,
        "false" => false,
        _ => null,
    };

    public async Task<object?> Handle(ShellWindow from, Message message)
    {
        switch (message.Get("operation"))
        {
            case "status":
                return await State();
            case "app-icons":
                return AppIcons();
            case "enable":
                app.Settings.Set("computerUse.enabled", Flag(message) ?? throw new ShellError("Invalid computer use value"));
                break;
            case "calendar-enable":
                app.Settings.Set("connectors.calendar", Flag(message) ?? throw new ShellError("Invalid calendar value"));
                break;
            case "reminders-enable":
                app.Settings.Set("connectors.reminders", Flag(message) ?? throw new ShellError("Invalid calendar value"));
                break;
            case "calendar-request":
                if (message.Get("kind") is not ("events" or "reminders")) throw new ShellError("Invalid permission");
                if (!LocalCalendar.Available) Open("https://support.microsoft.com/office/outlook");
                return await State();
            case "location-enable":
                var on = Flag(message) ?? throw new ShellError("Invalid location value");
                app.Settings.Set("connectors.location", on);
                if (on && await LocalLocation.State() == "denied") Open("ms-settings:privacy-location");
                break;
            case "location-request":
                if (await LocalLocation.State() != "allowed") Open("ms-settings:privacy-location");
                return await State();
            case "policy":
                var policy = message.Get("value");
                if (policy is not ("ask" or "allow" or "deny")) throw new ShellError("Invalid computer use policy");
                app.Settings.Set("computerUse.policy", policy);
                break;
            case "keep-awake":
                app.Settings.Set("computerUse.keepAwake", Flag(message) ?? throw new ShellError("Invalid computer use value"));
                return await State();
            case "block-app":
                ChooseBlockedApp(from);
                break;
            case "unblock-app":
                var id = message.Get("id") ?? throw new ShellError("Invalid app");
                app.Settings.Set("computerUse.blockedApps", new JsonArray(BlockedApps.Where(item => item["id"]!.GetValue<string>() != id).Select(item => (JsonNode)item.DeepClone()).ToArray()));
                break;
            case "block-folder":
                ChooseBlockedFolder();
                return await State();
            case "unblock-folder":
                var path = message.Get("path") ?? throw new ShellError("Invalid folder");
                app.Settings.Set("computerUse.blockedFolders", new JsonArray(BlockedFolders.Where(folder => folder != path).Select(folder => (JsonNode)JsonValue.Create(folder)!).ToArray()));
                return await State();
            case "full-disk-access":
            case "request":
                return await State();
            case "run":
                return await Run(from, message);
            default:
                throw new ShellError("Invalid computer use operation");
        }
        app.Broadcast("muse-computer-changed", except: from);
        return await State();
    }

    private async Task<object?> Run(ShellWindow from, Message message)
    {
        if (from.Kind != WindowKind.Workspace) throw new ShellError("Only the workspace window runs computer use");
        var tool = message.Get("tool") ?? "";
        var raw = message.Get("input") ?? "{}";
        if (raw.Length > 16384) throw new ShellError("Invalid computer use request");
        JsonElement input;
        try { input = JsonDocument.Parse(raw).RootElement; }
        catch (JsonException) { throw new ShellError("Invalid computer use request"); }
        if (input.ValueKind != JsonValueKind.Object) throw new ShellError("Invalid computer use request");
        if (tool == LocalLocation.Tool)
        {
            if (!LocationOn) throw new ShellError(Strings.T("Location is off on this PC."));
            var (ok, text) = await LocalLocation.Run();
            return new JsonObject { ["ok"] = ok, ["text"] = text, ["image"] = "" };
        }
        if (tool == LocalCalendar.Tool)
        {
            var reminders = input.TryGetProperty("kind", out var kind) && kind.GetString() == "reminders";
            if (!(reminders ? RemindersOn : CalendarOn))
                throw new ShellError(Strings.T(reminders ? "Reminders are off on this PC." : "Calendar is off on this PC."));
            var (ok, text) = await LocalCalendar.Run(input);
            return new JsonObject { ["ok"] = ok, ["text"] = text, ["image"] = "" };
        }
        if (!Enabled) throw new ShellError(Strings.T("Computer use is off on this PC."));
        if (!Computer.Computer.Tools.Contains(tool)) throw new ShellError("Invalid computer use request");
        computer.Blocked = new HashSet<string>(BlockedApps.Select(item => item["id"]!.GetValue<string>()), StringComparer.OrdinalIgnoreCase);
        computer.BlockedFolders = BlockedFolders;
        computer.KeepAwake = KeepAwake;
        var output = await computer.Run(tool, input);
        return new JsonObject { ["ok"] = output.Ok, ["text"] = output.Text, ["image"] = output.Image };
    }

    private static void Open(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
        catch (Exception) { /* Nothing to open. */ }
    }

    // An app is blocked by its program name (chrome, WINWORD), the way
    // computer use recognizes its windows.
    private void ChooseBlockedApp(ShellWindow from)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Filter = $"{Strings.T("Apps")}|*.exe;*.lnk",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
            DereferenceLinks = true,
            Title = Strings.T("Block"),
        };
        if (dialog.ShowDialog(from) != true) return;
        var exe = dialog.FileName;
        if (!exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return;
        var id = Path.GetFileNameWithoutExtension(exe);
        if (id.Equals("OpenMuse", StringComparison.OrdinalIgnoreCase)) return;
        string name;
        try { name = FileVersionInfo.GetVersionInfo(exe).FileDescription ?? id; }
        catch (Exception) { name = id; }
        if (string.IsNullOrWhiteSpace(name)) name = id;
        var apps = BlockedApps.Where(item => !item["id"]!.GetValue<string>().Equals(id, StringComparison.OrdinalIgnoreCase)).ToList();
        apps.Add(new JsonObject { ["id"] = id, ["name"] = name });
        app.Settings.Set("computerUse.blockedApps", new JsonArray(apps.Select(item => (JsonNode)item.DeepClone()).ToArray()));
    }

    private void ChooseBlockedFolder()
    {
        using var dialog = new System.Windows.Forms.FolderBrowserDialog { Description = Strings.T("Block"), UseDescriptionForTitle = true };
        if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
        var folder = Path.GetFullPath(dialog.SelectedPath).TrimEnd('\\');
        var folders = BlockedFolders.Append(folder).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x).ToList();
        app.Settings.Set("computerUse.blockedFolders", new JsonArray(folders.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray()));
    }

    // The icons of the apps behind the connectors in Settings, from this PC.
    // Apps that are not installed are left out, so the page keeps its glyph.
    private JsonObject? icons;

    private JsonObject AppIcons()
    {
        if (icons is not null) return icons;
        var found = new JsonObject();
        void Add(string key, params string?[] files)
        {
            foreach (var file in files)
            {
                if (file is null || !File.Exists(file)) continue;
                var data = IconData(file);
                if (data is null) continue;
                found[key] = data;
                return;
            }
        }
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var programs = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programsX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        Add("lark", Path.Combine(local, "Feishu", "Feishu.exe"), Path.Combine(local, "Lark", "Lark.exe"));
        Add("browser", Path.Combine(programs, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(programsX86, "Microsoft", "Edge", "Application", "msedge.exe"));
        Add("files", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"));
        var outlook = OutlookPath();
        Add("calendar", outlook);
        Add("reminders", outlook);
        icons = found;
        return found;
    }

    private static string? OutlookPath()
    {
        using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE");
        return key?.GetValue(null) as string;
    }

    private static string? IconData(string file)
    {
        try
        {
            using var icon = Icon.ExtractAssociatedIcon(file);
            if (icon is null) return null;
            using var bitmap = new Bitmap(64, 64);
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                using var large = new Icon(icon, 64, 64);
                graphics.DrawIcon(large, new Rectangle(0, 0, 64, 64));
            }
            using var stream = new MemoryStream();
            bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
        }
        catch (Exception)
        {
            return null;
        }
    }
}
