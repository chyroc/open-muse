using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shell;
using Microsoft.Win32;
using OpenMuse.Core;
using Forms = System.Windows.Forms;

namespace OpenMuse.Handlers;

// musePresence: how the app stays at hand when its window is closed. The
// tray icon stands in for the Mac's menu-bar item (Show, Quick chat, Quit),
// the floating button for the Mac's, and startup is the per-user Run key.
// Also the taskbar badge for unread replies, and resetting this PC.
public sealed class Presence(ShellApp app) : IHandler
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    private Forms.NotifyIcon? tray;
    private FloatingButton? floating;
    private string companionName = "", companionState = "";

    private string RunName => app.Profile.Name is null ? "Open Muse" : $"Open Muse ({app.Profile.Name})";
    private string RunCommand
    {
        get
        {
            var exe = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "OpenMuse.exe");
            return app.Profile.Name is null ? $"\"{exe}\" --background" : $"\"{exe}\" --background --open-muse-profile {app.Profile.Name}";
        }
    }

    public bool MenuBar => app.Settings.Get("presence.menuBar", true);
    public bool FloatingButtonOn => app.Settings.Get("presence.floatingButton", true);

    public Task<object?> Handle(ShellWindow from, Message message)
    {
        switch (message.Get("operation"))
        {
            case "read":
                return Task.FromResult<object?>(State());
            case "login-items":
                try { Process.Start(new ProcessStartInfo("ms-settings:startupapps") { UseShellExecute = true }); }
                catch (Exception) { /* Settings could not open. */ }
                return Task.FromResult<object?>(State());
            case "write":
                var value = message.Get("value");
                if (value is not ("true" or "false")) throw new ShellError("Invalid presence value");
                var on = value == "true";
                switch (message.Get("key"))
                {
                    case "startup": SetStartup(on); break;
                    case "menuBar": app.Settings.Set("presence.menuBar", on); UpdateTray(); break;
                    case "floatingButton": app.Settings.Set("presence.floatingButton", on); Refresh(); break;
                    default: throw new ShellError("Invalid presence key");
                }
                app.Broadcast("muse-presence-changed", except: from);
                return Task.FromResult<object?>(State());
            case "reset":
                if (from.Kind != WindowKind.Settings) throw new ShellError("Only Settings resets this PC");
                app.Dispatcher.BeginInvoke(Reset);
                return Task.FromResult<object?>(true);
            default:
                throw new ShellError("Invalid presence operation");
        }
    }

    private JsonObject State() => new()
    {
        ["startup"] = StartupState(),
        ["menuBar"] = MenuBar,
        ["floatingButton"] = FloatingButtonOn,
    };

    // "enabled", "requires-approval" when turned off in Task Manager or
    // Settings > Startup apps, or "not-registered".
    private string StartupState()
    {
        try
        {
            using var run = Registry.CurrentUser.OpenSubKey(RunKey);
            if (run?.GetValue(RunName) is not string command || command != RunCommand) return "not-registered";
            using var approved = Registry.CurrentUser.OpenSubKey(ApprovedKey);
            if (approved?.GetValue(RunName) is byte[] flags && flags.Length > 0 && flags[0] % 2 == 1) return "requires-approval";
            return "enabled";
        }
        catch (Exception)
        {
            return "unavailable";
        }
    }

    private void SetStartup(bool on)
    {
        try
        {
            using var run = Registry.CurrentUser.CreateSubKey(RunKey);
            if (on) run.SetValue(RunName, RunCommand);
            else run.DeleteValue(RunName, false);
        }
        catch (Exception)
        {
            throw new ShellError(Strings.T("Windows did not change the startup setting."));
        }
    }

    public void Start()
    {
        UpdateTray();
        Refresh();
    }

    public void Stop()
    {
        if (tray is not null) { tray.Visible = false; tray.Dispose(); tray = null; }
        floating?.Close();
        floating = null;
    }

    public void Rebuild()
    {
        if (tray is not null) { tray.Visible = false; tray.Dispose(); tray = null; }
        UpdateTray();
    }

    private void UpdateTray()
    {
        if (!MenuBar)
        {
            if (tray is not null) { tray.Visible = false; tray.Dispose(); tray = null; }
            return;
        }
        if (tray is not null) return;
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add(Strings.T("Show Open Muse"), null, (_, _) => app.ShowWorkspace());
        menu.Items.Add(Strings.T("Quick chat"), null, (_, _) => app.ToggleQuickChat());
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(Strings.T("Settings…"), null, (_, _) => app.ShowSettings(null));
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(Strings.T("Quit Open Muse"), null, (_, _) => app.Quit());
        tray = new Forms.NotifyIcon
        {
            Icon = AppIcon(),
            Text = "Open Muse",
            ContextMenuStrip = menu,
            Visible = true,
        };
        tray.MouseClick += (_, e) => { if (e.Button == Forms.MouseButtons.Left) app.ShowWorkspace(); };
    }

    public static System.Drawing.Icon AppIcon()
    {
        var file = Path.Combine(AppContext.BaseDirectory, "OpenMuse.ico");
        try { return File.Exists(file) ? new System.Drawing.Icon(file) : System.Drawing.SystemIcons.Application; }
        catch (Exception) { return System.Drawing.SystemIcons.Application; }
    }

    // The floating button stands in for the workspace window: it shows while
    // that window is closed or minimized and goes away when it is back.
    public void Refresh()
    {
        var workspace = app.Workspace;
        var wanted = FloatingButtonOn && !app.Quitting && workspace is not null &&
            (!workspace.IsVisible || workspace.WindowState == WindowState.Minimized);
        if (wanted)
        {
            floating ??= new FloatingButton(app);
            floating.Update(companionName, companionState, app.Dark);
            if (!floating.IsVisible) floating.Show();
        }
        else if (floating is not null && floating.IsVisible)
        {
            floating.Hide();
        }
    }

    public void UpdateCompanion(string name, string state)
    {
        companionName = name.Length > 40 ? name[..40] : name;
        companionState = state;
        floating?.Update(companionName, companionState, app.Dark);
    }

    public void ApplyAppearance() => floating?.Update(companionName, companionState, app.Dark);

    // The unread count as an overlay on the taskbar button, as the Mac shows
    // it on the Dock icon.
    public void SetBadge(string label)
    {
        var workspace = app.Workspace;
        if (workspace is null) return;
        workspace.TaskbarItemInfo ??= new TaskbarItemInfo();
        workspace.TaskbarItemInfo.Overlay = label.Length == 0 ? null : Badge(label);
        workspace.TaskbarItemInfo.Description = label.Length == 0 ? "" : label;
    }

    private static ImageSource Badge(string label)
    {
        var visual = new DrawingVisual();
        using (var context = visual.RenderOpen())
        {
            context.DrawEllipse(new SolidColorBrush(Color.FromRgb(0xFF, 0x3B, 0x30)), null, new Point(16, 16), 16, 16);
            var text = new FormattedText(label, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal),
                label.Length > 2 ? 12 : 17, Brushes.White, 1.0);
            context.DrawText(text, new Point(16 - text.Width / 2, 16 - text.Height / 2));
        }
        var bitmap = new RenderTargetBitmap(32, 32, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        return bitmap;
    }

    // Back to first launch on this PC: the shell's preferences, startup,
    // shortcuts and all web data go, and the windows start over. Nothing in
    // the cloud changes.
    private async void Reset()
    {
        app.Dictation.Stop(cancel: true);
        app.QuickWindow?.Hide();
        SetStartupQuietly(false);
        app.Settings.Clear();
        Strings.Load("system");
        app.Shortcuts.Apply();
        SetBadge("");
        UpdateTray();
        Refresh();
        app.SettingsWindow?.Hide();
        app.ApplyAppearance();
        foreach (var file in new[] { "direct-ma.credentials", "background.credentials" })
        {
            try { File.Delete(app.Profile.File(file)); } catch (Exception) { /* Already gone. */ }
        }
        if (app.Workspace?.Core is { } core) await core.Profile.ClearBrowsingDataAsync();
        app.QuickWindow?.Reload();
        app.SettingsWindow?.Reload();
        app.Workspace?.Core?.Navigate($"{Assets.Origin}/");
        app.ShowWorkspace();
    }

    private void SetStartupQuietly(bool on)
    {
        try { SetStartup(on); } catch (ShellError) { /* Left as it was. */ }
    }
}

// A small pill that floats above other windows while the workspace is
// closed: the companion's name and what it is doing. A click opens the
// workspace; files dropped on it go to the main chat.
public sealed class FloatingButton : Window
{
    private readonly ShellApp app;
    private readonly TextBlock name = new() { FontSize = 13, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock state = new() { FontSize = 12, Margin = new Thickness(6, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
    private readonly Border pill = new() { CornerRadius = new CornerRadius(20), Padding = new Thickness(8, 6, 14, 6) };
    private Point? pressed;

    public FloatingButton(ShellApp app)
    {
        this.app = app;
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        Topmost = true;
        ShowInTaskbar = false;
        ShowActivated = false;
        SizeToContent = SizeToContent.WidthAndHeight;
        ResizeMode = ResizeMode.NoResize;
        AllowDrop = true;
        var icon = new Image { Width = 26, Height = 26, Margin = new Thickness(0, 0, 8, 0) };
        var file = Path.Combine(AppContext.BaseDirectory, "OpenMuse.ico");
        if (File.Exists(file)) icon.Source = BitmapFrame.Create(new Uri(file));
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        row.Children.Add(icon);
        row.Children.Add(name);
        row.Children.Add(state);
        pill.Child = row;
        pill.Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 14, ShadowDepth = 2, Opacity = 0.18 };
        Content = new Border { Padding = new Thickness(12), Child = pill };
        var area = SystemParameters.WorkArea;
        Left = area.Right - 260;
        Top = area.Bottom - 110;
        var saved = app.Settings.Node("floatingButtonPosition");
        if (saved is not null)
        {
            try { Left = saved["x"]!.GetValue<double>(); Top = saved["y"]!.GetValue<double>(); }
            catch (Exception) { /* Keep the default corner. */ }
        }
        MouseLeftButtonDown += (_, e) => { pressed = e.GetPosition(this); DragMove(); };
        MouseLeftButtonUp += (_, e) =>
        {
            var at = e.GetPosition(this);
            if (pressed is { } start && Math.Abs(at.X - start.X) < 4 && Math.Abs(at.Y - start.Y) < 4) app.ShowWorkspace();
            pressed = null;
        };
        LocationChanged += (_, _) => app.Settings.Set("floatingButtonPosition", new JsonObject { ["x"] = Left, ["y"] = Top });
        Drop += async (_, e) => await Dropped(e);
    }

    public void Update(string companion, string activity, bool dark)
    {
        name.Text = companion.Length > 0 ? companion : "Open Muse";
        state.Text = activity;
        state.Visibility = activity.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        pill.Background = new SolidColorBrush(dark ? Color.FromRgb(0x2C, 0x2C, 0x2E) : Colors.White);
        name.Foreground = new SolidColorBrush(dark ? Colors.White : Color.FromRgb(0x1C, 0x1C, 0x1E));
        state.Foreground = new SolidColorBrush(dark ? Color.FromRgb(0xAE, 0xAE, 0xB2) : Color.FromRgb(0x6E, 0x6E, 0x73));
    }

    // At most four files of up to 10 MB each, as the Mac button takes them.
    private async Task Dropped(DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is not string[] paths) return;
        var files = new JsonArray();
        foreach (var path in paths.Where(File.Exists).Take(4))
        {
            var info = new FileInfo(path);
            if (info.Length > 10 * 1024 * 1024) continue;
            var bytes = await File.ReadAllBytesAsync(path);
            files.Add(new JsonObject
            {
                ["name"] = info.Name,
                ["type"] = MimeTypes.For(info.Name),
                ["data"] = Convert.ToBase64String(bytes),
            });
        }
        if (files.Count == 0) return;
        app.ShowWorkspace();
        app.Workspace?.WhenReady(() => app.Dispatch(app.Workspace, "muse-dropped-files", files));
    }
}

public static class MimeTypes
{
    public static string For(string name) => Path.GetExtension(name).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".heic" => "image/heic",
        ".pdf" => "application/pdf",
        ".txt" => "text/plain",
        ".md" => "text/markdown",
        ".csv" => "text/csv",
        ".json" => "application/json",
        ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    };
}
