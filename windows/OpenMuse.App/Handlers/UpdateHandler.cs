using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows.Threading;
using OpenMuse.Core;

namespace OpenMuse.Handlers;

// museUpdate: keeps a released build up to date. A little after launch and
// every six hours it reads the current release from the website (the
// mainland China mirror answers when the main site cannot), downloads the
// zip in the background with Update automatically on, and stages it once its
// size, SHA-256 and release signature match. The staged copy replaces this
// install when the app quits, or at once with Restart to update. Builds
// without a release number and installs in folders this user cannot write
// never change themselves; the page offers the download instead.
public sealed class UpdateHandler(ShellApp app) : IHandler
{
    private static readonly string[] Feeds =
    [
        "https://getopenmuse.com/download/windows.json",
        "https://cn.getopenmuse.com/download/windows.json",
    ];
    public const string DownloadPage = "https://getopenmuse.com/download/windows";
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(10) };

    private string phase = "idle";
    private Release? release;
    private double progress;
    private DateTime? checkedAt;
    private string? failure;
    private string? staged;
    private DispatcherTimer? timer;

    public bool Supported => app.Version.Build > 0;
    public bool Automatic => app.Settings.Get("updates.automatic", true);
    public bool HasStagedUpdate => staged is not null;

    private static string InstallFolder => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

    // Replacing the app needs a folder this user can write.
    public bool Installable
    {
        get
        {
            try
            {
                var probe = Path.Combine(Path.GetDirectoryName(InstallFolder)!, $".open-muse-{Guid.NewGuid():N}");
                File.WriteAllText(probe, "");
                File.Delete(probe);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }

    public void Start()
    {
        if (!Supported) return;
        var first = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        first.Tick += (_, _) => { first.Stop(); _ = Check(false); };
        first.Start();
        timer = new DispatcherTimer { Interval = TimeSpan.FromHours(6) };
        timer.Tick += (_, _) => _ = Check(false);
        timer.Start();
    }

    public Task<object?> Handle(ShellWindow from, Message message)
    {
        switch (message.Get("operation"))
        {
            case "read": break;
            case "check": _ = Check(true); break;
            case "download":
                if (Installable) _ = Download(true);
                else ShellWindow.OpenExternal(DownloadPage);
                break;
            case "automatic":
                var on = message.Get("value") == "true";
                app.Settings.Set("updates.automatic", on);
                if (on && phase == "available") _ = Download(false);
                Changed();
                break;
            case "restart":
                if (HasStagedUpdate) app.RestartToUpdate();
                break;
            default:
                throw new ShellError("Invalid update request");
        }
        return Task.FromResult<object?>(State());
    }

    public JsonObject State()
    {
        var state = new JsonObject
        {
            ["supported"] = Supported,
            ["phase"] = phase,
            ["automatic"] = Automatic,
            ["installable"] = Installable,
            ["progress"] = progress,
        };
        if (release is not null) { state["version"] = release.Version; state["build"] = release.Build; }
        if (checkedAt is { } at) state["checkedAt"] = new DateTimeOffset(at).ToUnixTimeMilliseconds();
        if (failure is not null) state["failure"] = failure;
        return state;
    }

    private void Changed() => app.Broadcast("muse-update-changed");

    private async Task Check(bool userInitiated)
    {
        if (!Supported || phase is "checking" or "downloading" or "ready") return;
        var previous = phase;
        phase = "checking";
        failure = null;
        Changed();
        Release? found = null;
        foreach (var feed in Feeds)
        {
            try
            {
                found = Release.Parse(await Http.GetStringAsync(feed));
                if (found is not null) break;
            }
            catch (Exception)
            {
                // The next mirror may answer.
            }
        }
        if (found is null)
        {
            // A background check that could not reach the site stays quiet.
            phase = userInitiated ? "failed" : previous == "checking" ? "idle" : previous;
            if (userInitiated) failure = "check";
            Changed();
            return;
        }
        checkedAt = DateTime.Now;
        if (found.Build <= app.Version.Build)
        {
            release = null;
            phase = "current";
            Changed();
            return;
        }
        release = found;
        phase = "available";
        Changed();
        if (Installable && (Automatic || userInitiated)) await Download(userInitiated);
    }

    private async Task Download(bool userInitiated)
    {
        if (release is null || phase is not ("available" or "failed")) return;
        phase = "downloading";
        progress = 0;
        failure = null;
        Changed();
        var root = Path.Combine(app.Profile.DataFolder, "Update");
        var zip = Path.Combine(root, "update.zip");
        try
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
            Directory.CreateDirectory(root);
            using (var response = await Http.GetAsync(release.Url, HttpCompletionOption.ResponseHeadersRead))
            {
                response.EnsureSuccessStatusCode();
                await using var input = await response.Content.ReadAsStreamAsync();
                await using var output = File.Create(zip);
                var buffer = new byte[81920];
                long total = 0;
                int read;
                var last = 0.0;
                while ((read = await input.ReadAsync(buffer)) > 0)
                {
                    total += read;
                    if (total > release.Size) throw new InvalidDataException();
                    await output.WriteAsync(buffer.AsMemory(0, read));
                    var now = Math.Round((double)total / release.Size, 2);
                    if (now != last) { last = now; progress = now; Changed(); }
                }
            }
            if (!release.Verify(zip))
            {
                Fail(userInitiated, "verify");
                return;
            }
            var folder = Path.Combine(root, $"build-{release.Build}");
            ZipFile.ExtractToDirectory(zip, folder);
            File.Delete(zip);
            var version = Path.Combine(folder, "version.json");
            var exe = Path.Combine(folder, "OpenMuse.exe");
            if (!File.Exists(exe) || !File.Exists(version) || VersionInfoBuild(version) != release.Build)
            {
                Fail(userInitiated, "verify");
                return;
            }
            staged = folder;
            phase = "ready";
            Changed();
        }
        catch (Exception)
        {
            Fail(userInitiated, "download");
        }
    }

    private static int VersionInfoBuild(string file)
    {
        try { return JsonNode.Parse(File.ReadAllText(file))?["build"]?.GetValue<int>() ?? 0; }
        catch (Exception) { return 0; }
    }

    private void Fail(bool userInitiated, string reason)
    {
        // Tried again on the next check; said only when asked.
        phase = userInitiated ? "failed" : "available";
        if (userInitiated) failure = reason;
        Changed();
    }

    // Swaps the staged copy in once this process exits, and opens it again
    // when asked. Another running copy of the app would keep using files that
    // changed under it, so the update then waits for a later quit.
    public void InstallOnExit(bool relaunch)
    {
        if (staged is null || !Directory.Exists(staged)) return;
        if (Process.GetProcessesByName("OpenMuse").Length > 1) return;
        var target = InstallFolder;
        var args = Environment.GetCommandLineArgs().Skip(1).Where(arg => arg != "--background");
        var launch = relaunch ? $"Start-Process -FilePath (Join-Path $target 'OpenMuse.exe') -ArgumentList @({string.Join(",", args.Select(arg => $"'{arg.Replace("'", "''")}'"))})" : "";
        var script = $$"""
            $ErrorActionPreference = 'Stop'
            $target = '{{target.Replace("'", "''")}}'
            $staged = '{{staged.Replace("'", "''")}}'
            while (Get-Process -Id {{Environment.ProcessId}} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }
            $old = "$target.old"
            if (Test-Path $old) { Remove-Item $old -Recurse -Force }
            Move-Item $target $old
            try { Move-Item $staged $target; Remove-Item $old -Recurse -Force } catch { Move-Item $old $target; exit 1 }
            {{launch}}
            """;
        var encoded = Convert.ToBase64String(System.Text.Encoding.Unicode.GetBytes(script));
        Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -WindowStyle Hidden -EncodedCommand {encoded}")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        });
        staged = null;
    }
}
