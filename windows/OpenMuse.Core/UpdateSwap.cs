namespace OpenMuse.Core;

// The PowerShell that puts a downloaded update in place once the app has
// exited: it waits for the app's process, moves the install aside, moves the
// staged copy in, and puts the old one back if that fails. An install made by
// the installer keeps its uninstaller, which the release zip does not carry,
// and its entry in Installed apps is given the new version. It runs outside
// the install folder so nothing holds the folder open while it moves.
public static class UpdateSwap
{
    public static string Script(
        string target,
        string staged,
        int waitForProcess,
        string version,
        string uninstallKey,
        IEnumerable<string>? relaunchArguments)
    {
        static string Quote(string value) => $"'{value.Replace("'", "''")}'";
        var launch = relaunchArguments is null
            ? ""
            : $"Start-Process -FilePath (Join-Path $target 'OpenMuse.exe') -WorkingDirectory $target{Arguments(relaunchArguments.ToList())}";
        return $$"""
            $ErrorActionPreference = 'Stop'
            Set-Location $env:TEMP
            [Environment]::CurrentDirectory = $env:TEMP
            $target = {{Quote(target)}}
            $staged = {{Quote(staged)}}
            while (Get-Process -Id {{waitForProcess}} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }
            $old = "$target.old"
            if (Test-Path $old) { Remove-Item $old -Recurse -Force }
            Get-ChildItem $target -Filter 'unins*' -File | Copy-Item -Destination $staged
            Move-Item $target $old
            try { Move-Item $staged $target } catch { Move-Item $old $target; exit 1 }
            Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
            $entry = {{Quote(uninstallKey)}}
            if (Test-Path $entry) { Set-ItemProperty $entry DisplayVersion {{Quote(version)}} }
            {{launch}}
            """;

        static string Arguments(List<string> args) =>
            args.Count == 0 ? "" : $" -ArgumentList @({string.Join(",", args.Select(Quote))})";
    }
}
