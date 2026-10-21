using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace OpenMuse.Computer;

// Runs the agent's mac_* custom tools on this PC: the Windows app answers the
// same tools as the Mac app, since an agent may have only eight custom tools.
// Coordinates are pixels of the latest screenshot, origin at the top left of
// the primary display. Blocked apps are blacked out of screenshots and are
// never listed, opened or acted on; nothing inside a blocked folder opens.
public sealed class Computer
{
    public sealed record Output(bool Ok, string Text, string Image = "");

    public static readonly string[] Tools = ["mac_screenshot", "mac_action", "mac_open", "mac_apps"];
    // Screenshots are scaled down to this width before they leave the PC.
    private const int MaxImageWidth = 1366;
    private const int SettleMilliseconds = 600;

    public HashSet<string> Blocked { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public List<string> BlockedFolders { get; set; } = new();
    public bool KeepAwake { get; set; }

    private double pixelsPerShotPixel = 1;
    private Size shot = Size.Empty;
    private Rectangle screen;
    private DateTime awakeUntil = DateTime.MinValue;
    private bool holding;

    public async Task<Output> Run(string tool, JsonElement input)
    {
        if (KeepAwake) HoldAwake();
        return tool switch
        {
            "mac_screenshot" => Screenshot(null),
            "mac_apps" => Apps(),
            "mac_open" => Open(input.TryGetProperty("target", out var target) && target.ValueKind == JsonValueKind.String ? target.GetString()! : ""),
            "mac_action" => await Act(input),
            _ => Failure($"This PC does not provide {tool}."),
        };
    }

    private static string Json(object value) => JsonSerializer.Serialize(value);
    private static Output Failure(string message) => new(false, Json(new { ok = false, error = message }));

    // Keeps the display on while the assistant works, and a minute after.
    private async void HoldAwake()
    {
        awakeUntil = DateTime.Now.AddMinutes(1);
        if (holding) return;
        holding = true;
        while (DateTime.Now < awakeUntil)
        {
            Win32.SetThreadExecutionState(Win32.EsContinuous | Win32.EsDisplayRequired | Win32.EsSystemRequired);
            await Task.Delay(5000);
        }
        Win32.SetThreadExecutionState(Win32.EsContinuous);
        holding = false;
    }

    private bool IsBlocked(IntPtr window)
    {
        var name = ProcessName(window);
        return name.Length > 0 && Blocked.Contains(name);
    }

    public static string ProcessName(IntPtr window)
    {
        if (window == IntPtr.Zero) return "";
        Win32.GetWindowThreadProcessId(window, out var pid);
        try { using var process = Process.GetProcessById((int)pid); return process.ProcessName; }
        catch (Exception) { return ""; }
    }

    private static string AppName(IntPtr window)
    {
        Win32.GetWindowThreadProcessId(window, out var pid);
        try
        {
            using var process = Process.GetProcessById((int)pid);
            var description = process.MainModule?.FileVersionInfo.FileDescription;
            return string.IsNullOrWhiteSpace(description) ? process.ProcessName : description!;
        }
        catch (Exception)
        {
            return ProcessName(window);
        }
    }

    private Output Screenshot(string? action)
    {
        screen = Win32.PrimaryScreen();
        if (screen.Width <= 0 || screen.Height <= 0) return Failure("No display is available.");
        var scale = Math.Min(1.0, (double)MaxImageWidth / screen.Width);
        var width = Math.Max(1, (int)Math.Round(screen.Width * scale));
        var height = Math.Max(1, (int)Math.Round(screen.Height * scale));
        using var full = new Bitmap(screen.Width, screen.Height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(full))
        {
            try { graphics.CopyFromScreen(screen.Left, screen.Top, 0, 0, screen.Size, CopyPixelOperation.SourceCopy); }
            catch (Exception) { return Failure("The screen could not be captured. The PC may be locked."); }
            // Blocked apps are covered, as the Mac leaves them out.
            var hidden = false;
            foreach (var (window, rect) in Win32.VisibleWindows())
            {
                if (!IsBlocked(window)) continue;
                hidden = true;
                graphics.FillRectangle(Brushes.Black, rect.Left - screen.Left, rect.Top - screen.Top, rect.Width, rect.Height);
            }
            DrawCursor(graphics);
            using var small = new Bitmap(full, width, height);
            pixelsPerShotPixel = (double)screen.Width / width;
            shot = new Size(width, height);
            using var stream = new MemoryStream();
            var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            using var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 70L);
            small.Save(stream, codec, parameters);
            var front = Win32.GetForegroundWindow();
            var info = new Dictionary<string, object>
            {
                ["ok"] = true,
                ["width"] = width,
                ["height"] = height,
                ["frontmost_app"] = IsBlocked(front) ? "" : AppName(front),
            };
            if (action is not null) info["action"] = action;
            if (hidden) info["note"] = "Apps the person blocked are hidden from this screenshot.";
            return new Output(true, Json(info), Convert.ToBase64String(stream.ToArray()));
        }
    }

    private void DrawCursor(Graphics graphics)
    {
        var cursor = Native.Cursor();
        var x = cursor.X - screen.Left;
        var y = cursor.Y - screen.Top;
        try { System.Windows.Forms.Cursors.Default.Draw(graphics, new Rectangle(x, y, 32, 32)); }
        catch (Exception) { /* The screenshot is still useful without the pointer. */ }
    }

    private Output Apps()
    {
        var front = Win32.GetForegroundWindow();
        var apps = new SortedSet<string>(StringComparer.CurrentCultureIgnoreCase);
        var windows = new JsonArray();
        foreach (var (window, _) in Win32.VisibleWindows())
        {
            if (IsBlocked(window)) continue;
            var app = AppName(window);
            apps.Add(app);
            if (windows.Count >= 40) continue;
            var row = new JsonObject { ["app"] = app };
            var title = Win32.Title(window);
            if (title.Length > 0) row["title"] = title;
            windows.Add(row);
        }
        var result = new JsonObject
        {
            ["ok"] = true,
            ["frontmost_app"] = IsBlocked(front) ? "" : AppName(front),
            ["apps"] = new JsonArray(apps.Select(name => (JsonNode)JsonValue.Create(name)!).ToArray()),
            ["windows"] = windows,
        };
        return new Output(true, result.ToJsonString());
    }

    private bool InBlockedFolder(string path) =>
        BlockedFolders.Any(folder =>
            path.Equals(folder, StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith(folder.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase));

    private Output Open(string target)
    {
        var value = target.Trim();
        if (value.Length is 0 or > 2048) return Failure("Name an app, a web address or a file path.");
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
            return Launch(value) ? new Output(true, Json(new { ok = true, opened = value })) : Failure("The address could not be opened.");
        if (Path.IsPathFullyQualified(value))
        {
            string full;
            try { full = Path.GetFullPath(value); } catch (Exception) { return Failure("Name an app, a web address or a file path."); }
            if (InBlockedFolder(full)) return Failure("The person blocked this folder for their assistant.");
            if (!File.Exists(full) && !Directory.Exists(full)) return Failure("No file exists at that path.");
            if (Blocked.Contains(Path.GetFileNameWithoutExtension(full))) return Failure("The person blocked this app for their assistant.");
            return Launch(full) ? new Output(true, Json(new { ok = true, opened = full })) : Failure("The file could not be opened.");
        }
        if (value.Contains('\\') || value.Contains('/')) return Failure("Name an app, a web address or a file path.");
        var shortcut = FindApp(value);
        var name = shortcut is null ? value : Path.GetFileNameWithoutExtension(shortcut);
        if (Blocked.Contains(value) || Blocked.Contains(Path.GetFileNameWithoutExtension(value)) || Blocked.Contains(name))
            return Failure("The person blocked this app for their assistant.");
        if (shortcut is not null)
            return Launch(shortcut) ? new Output(true, Json(new { ok = true, opened = name })) : Failure("The app could not be opened.");
        return Launch(value) ? new Output(true, Json(new { ok = true, opened = value })) : Failure($"No app named {value} was found on this PC.");
    }

    // An app by the name the Start menu shows it under.
    private static string? FindApp(string name)
    {
        var folders = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
        };
        foreach (var folder in folders)
        {
            if (!Directory.Exists(folder)) continue;
            try
            {
                var match = Directory.EnumerateFiles(folder, "*.lnk", SearchOption.AllDirectories)
                    .FirstOrDefault(file => Path.GetFileNameWithoutExtension(file).Equals(name, StringComparison.OrdinalIgnoreCase));
                if (match is not null) return match;
            }
            catch (Exception)
            {
                // A folder the user cannot read is skipped.
            }
        }
        return null;
    }

    private static bool Launch(string target)
    {
        try
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true })?.Dispose();
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private Point? PointFrom(JsonElement input, string x, string y)
    {
        if (shot.IsEmpty) return null;
        if (!input.TryGetProperty(x, out var px) || !px.TryGetDouble(out var vx)) return null;
        if (!input.TryGetProperty(y, out var py) || !py.TryGetDouble(out var vy)) return null;
        if (vx < 0 || vy < 0 || vx > shot.Width || vy > shot.Height) return null;
        return new Point(screen.Left + (int)Math.Round(vx * pixelsPerShotPixel), screen.Top + (int)Math.Round(vy * pixelsPerShotPixel));
    }

    // Answering a request in Open Muse brings it to the front; input goes back
    // to the window the person was using before.
    private static async Task ReturnFocus()
    {
        var front = Win32.GetForegroundWindow();
        Win32.GetWindowThreadProcessId(front, out var pid);
        if (pid != Environment.ProcessId) return;
        foreach (var (window, _) in Win32.VisibleWindows())
        {
            Win32.GetWindowThreadProcessId(window, out var owner);
            if (owner == Environment.ProcessId) continue;
            Win32.SetForegroundWindow(window);
            await Task.Delay(300);
            return;
        }
    }

    private async Task<Output> Act(JsonElement input)
    {
        await ReturnFocus();
        if (IsBlocked(Win32.GetForegroundWindow()))
            return Failure("The app in front is blocked for the assistant. Ask the person to switch apps.");
        if (!input.TryGetProperty("action", out var actionValue) || actionValue.ValueKind != JsonValueKind.String)
            return Failure("Choose an action.");
        var action = actionValue.GetString()!;
        const string needsPoint = "Take a screenshot first, then give x and y inside it.";
        switch (action)
        {
            case "click":
            case "double_click":
            case "right_click":
            case "move":
            {
                if (PointFrom(input, "x", "y") is not { } at) return Failure(needsPoint);
                Win32.MoveTo(at);
                if (action == "move") break;
                var right = action == "right_click";
                for (var count = 0; count < (action == "double_click" ? 2 : 1); count++)
                {
                    Win32.Mouse(right ? Win32.MouseRightDown : Win32.MouseLeftDown);
                    Win32.Mouse(right ? Win32.MouseRightUp : Win32.MouseLeftUp);
                }
                break;
            }
            case "drag":
            {
                if (PointFrom(input, "x", "y") is not { } from || PointFrom(input, "to_x", "to_y") is not { } to) return Failure(needsPoint);
                Win32.MoveTo(from);
                Win32.Mouse(Win32.MouseLeftDown);
                for (var step = 1; step <= 12; step++)
                {
                    var t = step / 12.0;
                    Win32.MoveTo(new Point(from.X + (int)((to.X - from.X) * t), from.Y + (int)((to.Y - from.Y) * t)));
                    await Task.Delay(16);
                }
                Win32.Mouse(Win32.MouseLeftUp);
                break;
            }
            case "scroll":
            {
                var amount = input.TryGetProperty("amount", out var a) && a.TryGetInt32(out var n) ? n : 0;
                if (amount == 0 || Math.Abs(amount) > 50) return Failure("Scroll by 1 to 50 lines; positive scrolls down.");
                if (PointFrom(input, "x", "y") is { } at) Win32.MoveTo(at);
                // One wheel notch scrolls three lines.
                Win32.Wheel(-amount * 120 / 3);
                break;
            }
            case "type":
            {
                var text = input.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString()! : "";
                if (text.Length is 0 or > 2000) return Failure("Give 1 to 2000 characters to type.");
                // Unicode input goes in as characters, not keys, so an input
                // method such as Pinyin does not compose it.
                foreach (var chunk in text.Chunk(16))
                {
                    Win32.TypeUnicode(new string(chunk));
                    await Task.Delay(8);
                }
                break;
            }
            case "key":
            {
                var keys = input.TryGetProperty("keys", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString()! : "";
                if (Win32.Combo(keys) is not { } combo) return Failure("Give a key such as enter, or a combination such as ctrl+c.");
                Win32.Press(combo.Key, combo.Modifiers);
                break;
            }
            default:
                return Failure($"Unknown action {action}.");
        }
        await Task.Delay(SettleMilliseconds);
        return Screenshot(action);
    }
}
