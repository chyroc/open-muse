using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using OpenMuse.Core;

namespace OpenMuse;

// Starts the app: one instance per profile. A second launch asks the running
// one to show its window (or Quick Chat, from the jump list) and exits;
// --quit asks it to quit, which the installer does before replacing it.
public static class Program
{
    // Held by every running copy, so the installer can tell one is open.
    public const string RunningMutex = "OpenMuse.Running";

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string id);

    [STAThread]
    public static int Main(string[] args)
    {
        var profile = Profile.FromArguments(args);
        var request = Array.IndexOf(args, "--quit") >= 0 ? "quit"
            : Array.IndexOf(args, "--quick-chat") >= 0 ? "quick"
            : Array.IndexOf(args, "--new-chat") >= 0 ? "new-chat"
            : Array.IndexOf(args, "--search") >= 0 ? "search"
            : "show";
        using var single = new Mutex(true, $"OpenMuse.{profile.Key}", out var first);
        if (!first)
        {
            Signal(profile, request);
            return 0;
        }
        if (request == "quit") return 0;
        // Never released by the app: Windows closes it as the process ends, so
        // the installer waits until no file here is still in use.
        var running = new Mutex(false, RunningMutex);
        // The Start menu shortcut carries the same ID, so the taskbar groups
        // the window, a pinned button and the jump list as one app.
        SetCurrentProcessExplicitAppUserModelID(profile.AppUserModelId);
        var app = new ShellApp(profile);
        Listen(profile, app);
        var code = app.Run();
        GC.KeepAlive(running);
        return code;
    }

    private static void Signal(Profile profile, string request)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", $"OpenMuse.{profile.Key}", PipeDirection.Out);
            pipe.Connect(3000);
            var bytes = Encoding.UTF8.GetBytes(request);
            pipe.Write(bytes, 0, bytes.Length);
        }
        catch (Exception)
        {
            // The running instance is starting or closing; nothing to show.
        }
    }

    private static void Listen(Profile profile, ShellApp app)
    {
        Task.Run(async () =>
        {
            while (true)
            {
                try
                {
                    await using var pipe = new NamedPipeServerStream($"OpenMuse.{profile.Key}", PipeDirection.In, 1);
                    await pipe.WaitForConnectionAsync();
                    using var reader = new StreamReader(pipe, Encoding.UTF8);
                    var request = (await reader.ReadToEndAsync()).Trim();
                    _ = app.Dispatcher.BeginInvoke(() => app.HandleRequest(request));
                }
                catch (Exception)
                {
                    await Task.Delay(500);
                }
            }
        });
    }
}

// A separate copy of the app's data, as --open-muse-profile <name> gives on
// the Mac: its own web storage, saved sign-in and window title.
public sealed class Profile
{
    public string? Name { get; }
    public string Key => Name is null ? "default" : $"profile-{Name}";
    public string DataFolder { get; }

    private Profile(string? name)
    {
        Name = name;
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Open Muse");
        DataFolder = name is null ? root : Path.Combine(root, "Profiles", name);
        Directory.CreateDirectory(DataFolder);
    }

    public static Profile FromArguments(string[] args)
    {
        var at = Array.IndexOf(args, "--open-muse-profile");
        var name = at >= 0 && at + 1 < args.Length ? args[at + 1] : null;
        return new Profile(name is not null && Policy.IsProfile(name) ? name : null);
    }

    public string WebFolder => Path.Combine(DataFolder, "WebView2");
    public string AppUserModelId => Name is null ? "OpenMuse.App" : $"OpenMuse.App.{Name}";
    public string File(string name) => Path.Combine(DataFolder, name);
}
