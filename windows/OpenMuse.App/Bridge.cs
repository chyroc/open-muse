using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Microsoft.Win32;
using OpenMuse.Core;

namespace OpenMuse;

// The script every page gets before it runs: the Mac shell's message handlers
// (window.webkit.messageHandlers.<name>.postMessage) over WebView2's channel,
// so the same bundle feature-detects and calls them unchanged, and the values
// the Mac shell injects, plus which desktop system this is.
public static class Bridge
{
    public static string Script(ShellApp app)
    {
        var globals = new Dictionary<string, object>
        {
            ["__OPEN_MUSE_DESKTOP__"] = true,
            ["__OPEN_MUSE_PLATFORM__"] = "windows",
            ["__OPEN_MUSE_VERSION__"] = app.Version.Version,
            ["__OPEN_MUSE_DEVICE__"] = new Dictionary<string, string> { ["name"] = Environment.MachineName },
            ["__OPEN_MUSE_SYSTEM__"] = SystemVersion(),
            ["__OPEN_MUSE_LANGUAGES__"] = Strings.SystemLanguages(),
        };
        var assignments = string.Concat(globals.Select(pair => $"window.{pair.Key}={JsonSerializer.Serialize(pair.Value)};"));
        var names = JsonSerializer.Serialize(Message.Handlers);
        var oneWay = JsonSerializer.Serialize(Message.FireAndForget);
        return $$"""
            (() => {
              if (window.webkit && window.webkit.messageHandlers) return;
              const channel = window.chrome && window.chrome.webview;
              if (!channel) return;
              {{assignments}}
              const pending = new Map();
              let next = 0;
              channel.addEventListener("message", (event) => {
                const reply = event.data;
                if (!reply || reply.__museReply !== true) return;
                const waiting = pending.get(reply.id);
                if (!waiting) return;
                pending.delete(reply.id);
                if (reply.ok) waiting.resolve(reply.value === undefined ? null : reply.value);
                else waiting.reject(new Error(reply.error || "Invalid request"));
              });
              const oneWay = new Set({{oneWay}});
              const handlers = {};
              for (const name of {{names}}) {
                handlers[name] = Object.freeze({
                  postMessage(body) {
                    const id = ++next;
                    const message = { __muse: true, id, name, body: body === undefined ? null : body };
                    if (oneWay.has(name)) {
                      channel.postMessage(message);
                      return undefined;
                    }
                    return new Promise((resolve, reject) => {
                      pending.set(id, { resolve, reject });
                      try { channel.postMessage(message); }
                      catch (error) { pending.delete(id); reject(error); }
                    });
                  },
                });
              }
              Object.defineProperty(window, "webkit", {
                value: Object.freeze({ messageHandlers: Object.freeze(handlers) }),
                configurable: false,
                writable: false,
              });
            })();
            """;
    }

    // "Windows 11 23H2 22631", short and plain for diagnostics and the
    // device list, as the Mac reports "macOS 14.5.0".
    public static string SystemVersion()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var product = key?.GetValue("ProductName") as string ?? "Windows";
            var display = key?.GetValue("DisplayVersion") as string ?? "";
            var build = key?.GetValue("CurrentBuild") as string ?? "";
            var server = product.Contains("Server", StringComparison.OrdinalIgnoreCase);
            var name = server
                ? string.Join(' ', product.Split(' ').Take(3))
                : int.TryParse(build, out var number) && number >= 22000 ? "Windows 11" : "Windows 10";
            return string.Join(' ', new[] { name, display, build }.Where(part => part.Length > 0));
        }
        catch (Exception)
        {
            return "Windows";
        }
    }
}
