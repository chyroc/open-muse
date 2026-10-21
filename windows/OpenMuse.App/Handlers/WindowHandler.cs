using System;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using OpenMuse.Core;

namespace OpenMuse.Handlers;

// museWindow: window chrome and the messages windows pass each other, as the
// Mac shell handles them. Each name is only accepted from the window it
// belongs to.
public sealed class WindowHandler(ShellApp app) : IHandler
{
    public Task<object?> Handle(ShellWindow from, Message message)
    {
        var value = message.Get("value") ?? "";
        switch (message.Get("name"))
        {
            // Windows draws its own title bars, so dragging and zooming come
            // from them; the page's requests have nothing to do.
            case "window-drag":
                break;
            case "window-zoom":
                if (from.Kind == WindowKind.Workspace)
                    from.WindowState = from.WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
                break;
            case "quick-size" when from.Kind == WindowKind.Quick:
                if (double.TryParse(value, out var height)) from.ResizeQuick(height);
                break;
            case "quick-close" when from.Kind == WindowKind.Quick:
                from.Hide();
                break;
            case "quick-ready" when from.Kind == WindowKind.Quick:
                app.Dictation.QuickReady();
                break;
            case "quick-sent" when from.Kind == WindowKind.Quick:
                app.Dispatch(app.Workspace, "muse-conversations-changed");
                break;
            case "workspace" when from.Kind == WindowKind.Quick:
                from.Hide();
                app.ShowWorkspace();
                break;
            case "settings":
                if (from.Kind == WindowKind.Quick) from.Hide();
                app.ShowSettings(value.Length > 0 ? value : null);
                break;
            case "report" when from.Kind == WindowKind.Settings:
                app.ShowWorkspace();
                app.Dispatch(app.Workspace, "muse-report-problem");
                break;
            case "draft" when from.Kind == WindowKind.Settings:
                if (value.Length > 0 && value.Length <= 16000)
                {
                    app.ShowWorkspace();
                    app.Dispatch(app.Workspace, "muse-draft", value);
                }
                break;
            case "open-lark":
                if (Policy.IsLarkUrl(value)) ShellWindow.OpenExternal(value);
                break;
            case "appearance":
                if (value is "light" or "dark" or "system")
                {
                    app.Settings.Set("appearance", value);
                    app.ApplyAppearance();
                    app.Broadcast("muse-appearance-changed", except: from);
                }
                break;
            case "language" when from.Kind == WindowKind.Settings:
                if (value is "en" or "zh-CN" or "system")
                {
                    app.Settings.Set("language", value);
                    Strings.Load(value);
                    app.ReloadAll();
                }
                break;
            case "companion" when from.Kind == WindowKind.Workspace:
                var state = message.Get("state") switch
                {
                    "thinking" => Strings.T("Thinking"),
                    "speaking" => Strings.T("Speaking"),
                    _ => "",
                };
                app.Presence.UpdateCompanion(value, state);
                break;
            case "badge" when from.Kind == WindowKind.Workspace:
                if (Policy.IsBadge(value)) app.Presence.SetBadge(value);
                break;
        }
        return Task.FromResult<object?>(null);
    }
}
