using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using OpenMuse.Core;

namespace OpenMuse;

// Starts the app: one instance per profile. A second launch asks the running
// one to show its window (or Quick Chat, from the jump list) and exits.
public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        var profile = Profile.FromArguments(args);
        var request = Array.IndexOf(args, "--quick-chat") >= 0 ? "quick"
            : Array.IndexOf(args, "--new-chat") >= 0 ? "new-chat"
            : Array.IndexOf(args, "--search") >= 0 ? "search"
            : "show";
        using var single = new Mutex(true, $"OpenMuse.{profile.Key}", out var first);
        if (!first)
        {
            Signal(profile, request);
            return 0;
        }
        var app = new ShellApp(profile);
        Listen(profile, app);
        return app.Run();
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
    public string File(string name) => Path.Combine(DataFolder, name);
}
