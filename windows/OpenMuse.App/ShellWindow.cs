using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using OpenMuse.Core;

namespace OpenMuse;

public enum WindowKind { Workspace, Settings, Quick }

// A window showing the web app: the workspace, Settings, or the Quick Chat
// card. Each loads the same bundle on its own route, as the Mac windows do.
public sealed class ShellWindow : Window
{
    public WindowKind Kind { get; }
    private readonly ShellApp app;
    // Quick Chat floats as a card with its own shadow, as on the Mac, so it
    // draws on a transparent window, which only the composition view can do.
    private readonly IWebView2 view;
    private bool ready;
    private Action? onReady;

    public ShellWindow(ShellApp app, WindowKind kind)
    {
        this.app = app;
        Kind = kind;
        view = kind == WindowKind.Quick ? new WebView2CompositionControl() : new WebView2();
        Content = (UIElement)view;
        Title = app.Profile.Name is null ? "Open Muse" : $"Open Muse ({app.Profile.Name})";
        var icon = Path.Combine(AppContext.BaseDirectory, "OpenMuse.ico");
        if (File.Exists(icon)) Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri(icon));
        switch (kind)
        {
            case WindowKind.Workspace:
                var area = SystemParameters.WorkArea;
                Width = Math.Min(1152, area.Width); Height = Math.Min(768, area.Height);
                MinWidth = Math.Min(900, Width); MinHeight = Math.Min(600, Height);
                Bounds.Restore(this, app.Settings, "workspaceBounds");
                break;
            case WindowKind.Settings:
                Width = 800; Height = 600; ResizeMode = ResizeMode.CanMinimize;
                Title = Strings.T("Settings");
                break;
            case WindowKind.Quick:
                Width = 520; Height = 204;
                WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize; AllowsTransparency = true;
                Topmost = true; ShowInTaskbar = false; ShowActivated = true;
                Deactivated += (_, _) => { if (IsVisible) Hide(); };
                break;
        }
        var color = BackgroundColor;
        Background = new SolidColorBrush(Color.FromArgb(color.A, color.R, color.G, color.B));
        SourceInitialized += (_, _) => ApplyAppearance();
    }

    public async Task Load(string route)
    {
        if (IsVisible) await view.EnsureCoreWebView2Async(app.Environment);
        else await InitializeHidden();
        var core = view.CoreWebView2;
        var settings = core.Settings;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.AreDevToolsEnabled = System.Environment.GetEnvironmentVariable("OPEN_MUSE_DEVTOOLS") == "1";
        settings.AreHostObjectsAllowed = false;
        core.Profile.PreferredColorScheme = app.Appearance switch
        {
            "dark" => CoreWebView2PreferredColorScheme.Dark,
            "light" => CoreWebView2PreferredColorScheme.Light,
            _ => CoreWebView2PreferredColorScheme.Auto,
        };
        view.DefaultBackgroundColor = BackgroundColor;

        core.AddWebResourceRequestedFilter("muse://*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += Serve;
        core.NavigationStarting += (_, e) =>
        {
            if (Policy.IsAppUrl(e.Uri)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        };
        core.WebMessageReceived += async (_, e) =>
        {
            if (!Policy.IsAppUrl(e.Source)) return;
            var message = Message.Parse(e.WebMessageAsJson);
            if (message is not null) await app.Receive(this, message);
        };
        core.NavigationCompleted += (_, _) =>
        {
            ready = true;
            var action = onReady;
            onReady = null;
            action?.Invoke();
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(Bridge.Script(app));
        core.Navigate($"{Assets.Origin}/{route}");
    }

    private void Serve(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var file = Assets.Resolve(app.WebRoot, e.Request.Uri);
        if (file is null)
        {
            e.Response = app.Environment!.CreateWebResourceResponse(null, 404, "Not Found", "");
            return;
        }
        var stream = new MemoryStream(File.ReadAllBytes(file));
        e.Response = app.Environment!.CreateWebResourceResponse(
            stream, 200, "OK", $"Content-Type: {Assets.MimeType(file)}\r\nCache-Control: no-cache");
    }

    public static void OpenExternal(string url)
    {
        if (!Policy.IsExternal(url)) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception) { /* No handler for the link; nothing opens. */ }
    }

    public void WhenReady(Action action)
    {
        if (ready) action();
        else onReady += action;
    }

    public void Post(string json)
    {
        if (view.CoreWebView2 is not null) view.CoreWebView2.PostWebMessageAsJson(json);
    }

    public async Task<string> Script(string script) =>
        view.CoreWebView2 is null ? "null" : await view.CoreWebView2.ExecuteScriptAsync(script);

    public void Reload() => view.CoreWebView2?.Reload();

    public CoreWebView2? Core => view.CoreWebView2;

    // The view initializes only once its window has been shown, and windows
    // load before they are first shown (or never, for a background start). So
    // the window is shown for that moment off screen, unactivated and out of
    // the taskbar, then hidden where it was.
    private async Task InitializeHidden()
    {
        var (left, top, activated, inTaskbar, state) = (Left, Top, ShowActivated, ShowInTaskbar, WindowState);
        WindowStartupLocation = WindowStartupLocation.Manual;
        WindowState = WindowState.Normal;
        ShowActivated = false;
        ShowInTaskbar = false;
        Left = Top = -32000;
        Show();
        try
        {
            await view.EnsureCoreWebView2Async(app.Environment);
        }
        finally
        {
            Hide();
            (ShowActivated, ShowInTaskbar) = (activated, inTaskbar);
            var area = SystemParameters.WorkArea;
            Left = double.IsNaN(left) ? area.Left + Math.Max(0, (area.Width - Width) / 2) : left;
            Top = double.IsNaN(top) ? area.Top + Math.Max(0, (area.Height - Height) / 2) : top;
            WindowState = state;
        }
    }

    public void Reveal()
    {
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        Native.ForceForeground(this);
        view.Focus();
    }

    public void CenterOver(Window? owner)
    {
        if (owner is null || !owner.IsVisible)
        {
            var area = SystemParameters.WorkArea;
            Left = area.Left + (area.Width - Width) / 2;
            Top = area.Top + (area.Height - Height) / 2;
            return;
        }
        Left = owner.Left + (owner.ActualWidth - Width) / 2;
        Top = owner.Top + (owner.ActualHeight - Height) / 2;
    }

    // Bottom center of the screen under the pointer, as the Mac card opens.
    public void PlaceForQuickChat()
    {
        var area = Native.WorkAreaUnderCursor(this);
        Height = Math.Min(Height, area.Height);
        Left = area.Left + (area.Width - Width) / 2;
        Top = Math.Max(area.Top, area.Bottom - Height - area.Height * 0.12);
    }

    // Keeps the card's bottom edge where it is while its content grows.
    public void ResizeQuick(double height)
    {
        var area = Native.WorkAreaUnderCursor(this);
        var bottom = Top + Height;
        Height = Math.Min(Math.Clamp(height, 204, 720), area.Height);
        Top = Math.Max(area.Top, bottom - Height);
    }

    // The page's background before it paints; none behind the Quick Chat card.
    private System.Drawing.Color BackgroundColor =>
        Kind == WindowKind.Quick ? System.Drawing.Color.Transparent
        : app.Dark ? System.Drawing.Color.FromArgb(0x1C, 0x1C, 0x1E)
        : System.Drawing.Color.FromArgb(0xFA, 0xFA, 0xFA);

    public void ApplyAppearance()
    {
        Native.DarkTitleBar(this, app.Dark);
        var color = BackgroundColor;
        Background = new SolidColorBrush(Color.FromArgb(color.A, color.R, color.G, color.B));
        if (view.CoreWebView2 is null) return;
        view.CoreWebView2.Profile.PreferredColorScheme = app.Appearance switch
        {
            "dark" => CoreWebView2PreferredColorScheme.Dark,
            "light" => CoreWebView2PreferredColorScheme.Light,
            _ => CoreWebView2PreferredColorScheme.Auto,
        };
        view.DefaultBackgroundColor = color;
    }

    // A document with unsaved changes asks before the workspace closes; a
    // check that cannot answer keeps the window open, as on the Mac.
    public async Task<bool> ConfirmUnsaved()
    {
        if (Kind != WindowKind.Workspace || view.CoreWebView2 is null) return true;
        for (var i = 0; i < 20; i++)
        {
            var saving = await Script("Boolean(window.__OPEN_MUSE_DOCUMENT_SAVING__)");
            if (saving != "true") break;
            await Task.Delay(250);
        }
        string dirty;
        try { dirty = await Script("Boolean(window.__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__)"); }
        catch (Exception) { return false; }
        if (dirty != "true") return true;
        Reveal();
        var answer = MessageBox.Show(this,
            Strings.T("This document has unsaved changes. If you close now, they will be lost."),
            Strings.T("Discard unsaved changes?"),
            MessageBoxButton.OKCancel, MessageBoxImage.Warning, MessageBoxResult.Cancel);
        if (answer != MessageBoxResult.OK) return false;
        app.Dispatch(this, "muse-discard-document");
        return true;
    }

    private bool closingChecked;

    protected override async void OnClosing(CancelEventArgs e)
    {
        if (app.Quitting) { base.OnClosing(e); return; }
        // Closing a window hides it; the app keeps running in the tray, as the
        // Mac app keeps running without windows.
        e.Cancel = true;
        if (Kind == WindowKind.Workspace)
        {
            if (!closingChecked && !await ConfirmUnsaved()) return;
            closingChecked = false;
            Bounds.Save(this, app.Settings, "workspaceBounds");
        }
        Hide();
        if (Kind == WindowKind.Workspace) app.Presence.Refresh();
    }

    protected override void OnStateChanged(EventArgs e)
    {
        base.OnStateChanged(e);
        if (Kind == WindowKind.Workspace) app.Presence.Refresh();
    }
}

// The workspace window's size and place, kept across launches and only
// restored when it still lands on a screen.
public static class Bounds
{
    public static void Save(Window window, Settings settings, string key)
    {
        var rect = window.WindowState == WindowState.Normal
            ? new Rect(window.Left, window.Top, window.Width, window.Height)
            : window.RestoreBounds;
        if (rect.IsEmpty) return;
        settings.Set(key, new JsonObject
        {
            ["x"] = rect.X, ["y"] = rect.Y, ["width"] = rect.Width, ["height"] = rect.Height,
            ["maximized"] = window.WindowState == WindowState.Maximized,
        });
    }

    public static void Restore(Window window, Settings settings, string key)
    {
        var node = settings.Node(key);
        if (node is null) { window.WindowStartupLocation = WindowStartupLocation.CenterScreen; return; }
        try
        {
            var rect = new Rect(node["x"]!.GetValue<double>(), node["y"]!.GetValue<double>(),
                node["width"]!.GetValue<double>(), node["height"]!.GetValue<double>());
            var screen = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
                SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
            if (!screen.IntersectsWith(rect) || rect.Width < window.MinWidth || rect.Height < window.MinHeight)
            {
                window.WindowStartupLocation = WindowStartupLocation.CenterScreen;
                return;
            }
            window.Left = rect.X; window.Top = rect.Y; window.Width = rect.Width; window.Height = rect.Height;
            if (node["maximized"]?.GetValue<bool>() == true) window.WindowState = WindowState.Maximized;
        }
        catch (Exception)
        {
            window.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }
    }
}
