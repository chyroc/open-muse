namespace OpenMuse.Core;

// The bundled web app, served from muse://app/ out of the folder beside the
// executable, as the Mac shell serves it from its bundle. Only files inside
// that folder are ever returned.
public static class Assets
{
    public const string Origin = "muse://app";

    // The file a muse://app URL names, or null when it is not a plain file
    // inside the root (another host, a folder, or a path leaving the root).
    public static string? Resolve(string root, string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != "muse" || uri.Host != "app") return null;
        var relative = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
        if (relative.Length == 0) relative = "index.html";
        if (relative.Contains('\\') || relative.Contains(':')) return null;
        var full = Path.GetFullPath(Path.Combine(root, relative));
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return null;
        return File.Exists(full) ? full : null;
    }

    public static string MimeType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".txt" or ".md" => "text/plain; charset=utf-8",
        ".wasm" => "application/wasm",
        ".mp3" => "audio/mpeg",
        ".mp4" => "video/mp4",
        _ => "application/octet-stream",
    };
}
