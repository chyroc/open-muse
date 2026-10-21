using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using OpenMuse.Core;
using OpenMuse.Handlers;

namespace OpenMuse;

// What the page's handlers raise for an answer the person can read; anything
// else is reported as an invalid request.
public sealed class ShellError(string message) : Exception(message);

// One native feature behind a message handler name.
public interface IHandler
{
    Task<object?> Handle(ShellWindow from, Message message);
}

// The app: one WebView2 environment shared by every window, so all windows
// see the same storage under muse://app, as the Mac shell's windows share one
// data store. It owns the windows, routes the page's messages to handlers,
// and sends events back.
public sealed class ShellApp : Application
{
    public Profile Profile { get; }
    public Settings Settings { get; }
    public VersionInfo Version { get; } = VersionInfo.Load();
    public string WebRoot { get; } = Path.Combine(AppContext.BaseDirectory, "web");
    public CoreWebView2Environment? Environment { get; private set; }
    public ShellWindow? Workspace { get; private set; }
    public ShellWindow? SettingsWindow { get; private set; }
    public ShellWindow? QuickWindow { get; private set; }
    public bool Quitting { get; private set; }

    private readonly Dictionary<string, IHandler> handlers = new();
    private string? pendingRequest;
    private Task? quickLoad;

    public Presence Presence { get; }
    public ShortcutHandler Shortcuts { get; }
    public UpdateHandler Updates { get; }
    public DictationHandler Dictation { get; }
    public ComputerHandler Computer { get; }
    public SpeechHandler Speech { get; }

    public ShellApp(Profile profile)
    {
        Profile = profile;
        Settings = new Settings(profile);
        Strings.Load(Settings.Get<string>("language") ?? "system");
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        Presence = new Presence(this);
        Shortcuts = new ShortcutHandler(this);
        Updates = new UpdateHandler(this);
        Dictation = new DictationHandler(this);
        Computer = new ComputerHandler(this);
        handlers["museCredentials"] = new CredentialsHandler(this);
        handlers["musePresence"] = Presence;
        handlers["museComputer"] = Computer;
        handlers["museDictation"] = Dictation;
        handlers["museShortcut"] = Shortcuts;
        Speech = new SpeechHandler(this);
        handlers["museSpeech"] = Speech;
        handlers["museUpdate"] = Updates;
        handlers["museReport"] = new ReportHandler();
        handlers["museExport"] = new ExportHandler(this);
        handlers["museWindow"] = new WindowHandler(this);
        SystemEvents.UserPreferenceChanged += (_, e) =>
        {
            if (e.Category == UserPreferenceCategory.General) Dispatcher.BeginInvoke(ApplyAppearance);
        };
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            // OPEN_MUSE_DEVTOOLS=1 (development only) also opens the DevTools
            // protocol on this computer's port 9222.
            var options = new CoreWebView2EnvironmentOptions(
                additionalBrowserArguments: System.Environment.GetEnvironmentVariable("OPEN_MUSE_DEVTOOLS") == "1"
                    ? "--remote-debugging-port=9222"
                    : null,
                language: Strings.Language == "zh-CN" ? "zh-CN" : "en-US",
                customSchemeRegistrations: new List<CoreWebView2CustomSchemeRegistration>
                {
                    new("muse") { TreatAsSecure = true, HasAuthorityComponent = true },
                });
            Environment = await CoreWebView2Environment.CreateAsync(null, Profile.WebFolder, options);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(Strings.T("Open Muse needs the Microsoft Edge WebView2 Runtime. Install it from Microsoft, then open Open Muse again."), "Open Muse", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
            return;
        }
        Workspace = new ShellWindow(this, WindowKind.Workspace);
        await Workspace.Load("");
        if (!System.Environment.GetCommandLineArgs().Contains("--background")) Workspace.Reveal();
        Presence.Start();
        Shortcuts.Start();
        // Loaded ahead, so the shortcut shows a card that is already connected.
        _ = LoadQuickChat();
        Updates.Start();
        JumpList.Install(this);
        if (pendingRequest is not null) HandleRequest(pendingRequest);
    }

    // What a second launch asked for (see Program).
    public void HandleRequest(string request)
    {
        if (Workspace is null) { pendingRequest = request; return; }
        pendingRequest = null;
        switch (request)
        {
            case "quick": ToggleQuickChat(); break;
            case "new-chat": ShowWorkspace(); Dispatch(Workspace, "muse-command", "new-chat"); break;
            case "search": ShowWorkspace(); Dispatch(Workspace, "muse-command", "search"); break;
            default: ShowWorkspace(); break;
        }
    }

    public void ShowWorkspace()
    {
        Workspace?.Reveal();
        Presence.Refresh();
    }

    public async void ShowSettings(string? section)
    {
        if (Environment is null) return;
        var route = section is not null && Policy.IsSettingsSection(section) ? $"#/settings/{section}" : "#/settings";
        if (SettingsWindow is null)
        {
            SettingsWindow = new ShellWindow(this, WindowKind.Settings);
            SettingsWindow.CenterOver(Workspace);
            await SettingsWindow.Load(route);
        }
        else if (section is not null)
        {
            await SettingsWindow.Script($"location.hash = {JsonSerializer.Serialize(route)};");
        }
        if (!SettingsWindow.IsVisible) SettingsWindow.CenterOver(Workspace);
        SettingsWindow.Reveal();
    }

    public async void ToggleQuickChat(string? dictation = null)
    {
        if (Environment is null) return;
        await LoadQuickChat();
        if (QuickWindow is null) return;
        if (QuickWindow.IsVisible && QuickWindow.IsActive && dictation is null)
        {
            QuickWindow.Hide();
            return;
        }
        QuickWindow.PlaceForQuickChat();
        QuickWindow.Reveal();
        Dispatch(QuickWindow, "muse-quick-shown");
        if (dictation is not null) QuickWindow.WhenReady(() => Dispatch(QuickWindow, "muse-quick-dictate", dictation));
    }

    private Task LoadQuickChat()
    {
        if (quickLoad is not null) return quickLoad;
        QuickWindow = new ShellWindow(this, WindowKind.Quick);
        return quickLoad = QuickWindow.Load("#/quick");
    }

    public IEnumerable<ShellWindow> ShellWindows() =>
        new[] { Workspace, SettingsWindow, QuickWindow }.Where(window => window is not null)!;

    // Routes one message; the reply settles the page's promise.
    public async Task Receive(ShellWindow from, Message message)
    {
        if (!handlers.TryGetValue(message.Name, out var handler)) return;
        var replies = !Message.FireAndForget.Contains(message.Name);
        try
        {
            var value = await handler.Handle(from, message);
            if (replies) from.Post(Message.Reply(message.Id, value));
        }
        catch (ShellError error)
        {
            if (replies) from.Post(Message.Failure(message.Id, error.Message));
        }
        catch (Exception)
        {
            if (replies) from.Post(Message.Failure(message.Id, "Invalid request"));
        }
    }

    // window.dispatchEvent(new CustomEvent(name, {detail})) in one window.
    public void Dispatch(ShellWindow? window, string name, object? detail = null)
    {
        if (window is null) return;
        var json = detail is null ? "null" : detail is JsonNode node ? node.ToJsonString() : JsonSerializer.Serialize(detail);
        _ = window.Script($"window.dispatchEvent(new CustomEvent({JsonSerializer.Serialize(name)}, {{ detail: {json} }}));");
    }

    // Every window except the one that caused the change.
    public void Broadcast(string name, ShellWindow? except = null)
    {
        foreach (var window in ShellWindows())
            if (window != except) Dispatch(window, name);
    }

    // The appearance chosen in the page: "light", "dark" or "system".
    public string Appearance => Settings.Get<string>("appearance") ?? "system";

    public bool Dark => Appearance switch
    {
        "dark" => true,
        "light" => false,
        _ => SystemDark(),
    };

    public static bool SystemDark()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
        }
        catch (Exception)
        {
            return false;
        }
    }

    public void ApplyAppearance()
    {
        foreach (var window in ShellWindows()) window.ApplyAppearance();
        Presence.ApplyAppearance();
    }

    // Quits after the workspace confirms no unsaved document is lost.
    public async void Quit()
    {
        if (Workspace is not null && !await Workspace.ConfirmUnsaved()) return;
        Quitting = true;
        Shortcuts.Stop();
        Presence.Stop();
        foreach (var window in ShellWindows().ToList()) window.Close();
        Updates.InstallOnExit(relaunch: false);
        Shutdown();
    }

    public async void RestartToUpdate()
    {
        if (Workspace is not null && !await Workspace.ConfirmUnsaved()) return;
        Quitting = true;
        Shortcuts.Stop();
        Presence.Stop();
        foreach (var window in ShellWindows().ToList()) window.Close();
        Updates.InstallOnExit(relaunch: true);
        Shutdown();
    }

    // Reloads every window, for a language change.
    public void ReloadAll()
    {
        foreach (var window in ShellWindows()) window.Reload();
        if (SettingsWindow is not null) SettingsWindow.Title = Strings.T("Settings");
        Presence.Rebuild();
        JumpList.Install(this);
    }
}

// The build this app is: version.json beside the executable, written by the
// build script.
public sealed record VersionInfo(string Version, int Build, string Commit)
{
    public static VersionInfo Load()
    {
        try
        {
            var json = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "version.json")));
            return new VersionInfo(
                json?["version"]?.GetValue<string>() ?? "",
                json?["build"]?.GetValue<int>() ?? 0,
                json?["commit"]?.GetValue<string>() ?? "");
        }
        catch (Exception)
        {
            return new VersionInfo("", 0, "");
        }
    }
}
