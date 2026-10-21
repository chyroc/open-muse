using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows.Interop;
using System.Windows.Threading;
using OpenMuse.Core;

namespace OpenMuse.Handlers;

// museShortcut: the global shortcuts. Quick Chat opens a small chat card over
// whatever app is in front and closes it on the next press; push to talk
// listens while held, hands-free starts and stops on each press. RegisterHotKey
// sees only these combinations, never other keystrokes. Values are stored in
// the page's encoding (see OpenMuse.Core.Shortcuts).
public sealed class ShortcutHandler(ShellApp app) : IHandler
{
    private static readonly string[] Names = ["quickChat", "dictationHold", "dictationToggle"];
    private readonly Dictionary<string, bool> registered = new();
    private HwndSource? sink;
    private DispatcherTimer? releaseWatch;

    [DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hwnd, int id);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);

    public void Start()
    {
        sink = new HwndSource(new HwndSourceParameters("OpenMuseHotKeys") { Width = 0, Height = 0, WindowStyle = 0 });
        sink.AddHook(Hook);
        Apply();
    }

    public void Stop()
    {
        if (sink is null) return;
        for (var i = 0; i < Names.Length; i++) UnregisterHotKey(sink.Handle, i + 1);
        sink.Dispose();
        sink = null;
    }

    private (int Code, int Modifiers) Stored(string name)
    {
        var node = app.Settings.Node($"shortcut.{name}");
        if (node is null) { var fallback = Shortcuts.Defaults[name]; return (fallback.Code, fallback.Modifiers); }
        try { return (node["code"]!.GetValue<int>(), node["modifiers"]!.GetValue<int>()); }
        catch (Exception) { return (-1, 0); }
    }

    public void Apply()
    {
        if (sink is null) return;
        for (var i = 0; i < Names.Length; i++)
        {
            var name = Names[i];
            UnregisterHotKey(sink.Handle, i + 1);
            var (code, modifiers) = Stored(name);
            var keys = Shortcuts.ToWin32(code, modifiers);
            registered[name] = keys is { } k && RegisterHotKey(sink.Handle, i + 1, k.Modifiers, k.Key);
        }
    }

    // How the Quick Chat shortcut reads in menus.
    public string QuickChatLabel()
    {
        var (code, modifiers) = Stored("quickChat");
        if (code < 0) return "";
        var parts = new List<string>();
        if ((modifiers & Shortcuts.Control) != 0) parts.Add("Ctrl");
        if ((modifiers & Shortcuts.Option) != 0) parts.Add("Alt");
        if ((modifiers & Shortcuts.Shift) != 0) parts.Add("Shift");
        if ((modifiers & Shortcuts.Command) != 0) parts.Add("Win");
        parts.Add(code == 49 ? "Space" : ((char)(Shortcuts.ToWin32(code, modifiers)?.Key ?? '?')).ToString());
        return string.Join("+", parts);
    }

    private JsonObject State(string name)
    {
        var (code, modifiers) = Stored(name);
        return new JsonObject
        {
            ["code"] = code,
            ["modifiers"] = code < 0 ? 0 : modifiers,
            ["registered"] = registered.TryGetValue(name, out var on) && on,
        };
    }

    public Task<object?> Handle(ShellWindow from, Message message)
    {
        var name = message.Get("id") ?? "quickChat";
        if (Array.IndexOf(Names, name) < 0) throw new ShellError("Invalid shortcut");
        switch (message.Get("operation"))
        {
            case "read":
                return Task.FromResult<object?>(State(name));
            case "write":
                if (!int.TryParse(message.Get("code"), out var code) || !int.TryParse(message.Get("modifiers"), out var modifiers) ||
                    !Shortcuts.IsValid(code, modifiers))
                    throw new ShellError("Invalid shortcut");
                foreach (var other in Names)
                {
                    if (other == name) continue;
                    var (c, m) = Stored(other);
                    if (c == code && m == modifiers) throw new ShellError(Strings.T("Another Open Muse shortcut already uses these keys."));
                }
                app.Settings.Set($"shortcut.{name}", new JsonObject { ["code"] = code, ["modifiers"] = modifiers });
                Apply();
                return Task.FromResult<object?>(State(name));
            case "reset":
                app.Settings.Remove($"shortcut.{name}");
                Apply();
                return Task.FromResult<object?>(State(name));
            default:
                throw new ShellError("Invalid shortcut operation");
        }
    }

    private IntPtr Hook(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int HotKey = 0x0312;
        if (message != HotKey) return IntPtr.Zero;
        handled = true;
        switch ((int)wParam)
        {
            case 1: app.ToggleQuickChat(); break;
            case 2: HoldPressed(); break;
            case 3: app.Dictation.QuickDictate("toggle"); break;
        }
        return IntPtr.Zero;
    }

    // RegisterHotKey reports only the press, so push to talk watches the key
    // until it is let go.
    private void HoldPressed()
    {
        var (code, modifiers) = Stored("dictationHold");
        var keys = Shortcuts.ToWin32(code, modifiers);
        if (keys is null) return;
        app.Dictation.QuickDictate("start");
        releaseWatch?.Stop();
        releaseWatch = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(40) };
        releaseWatch.Tick += (_, _) =>
        {
            if ((GetAsyncKeyState((int)keys.Value.Key) & 0x8000) != 0) return;
            releaseWatch?.Stop();
            app.Dictation.QuickDictate("stop");
        };
        releaseWatch.Start();
    }
}
