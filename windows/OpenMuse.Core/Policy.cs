using System.Text.RegularExpressions;

namespace OpenMuse.Core;

// What the page may ask the shell to open or set, mirroring the Mac shell's
// checks: links leave for the system browser only over https or mailto,
// Lark setup only to Lark's own hosts, a problem report only to the
// project's new-issue page.
public static partial class Policy
{
    public const string ReportPage = "https://github.com/chyroc/open-muse/issues/new?";

    public static bool IsAppUrl(string url) =>
        url == Assets.Origin || url.StartsWith(Assets.Origin + "/", StringComparison.Ordinal);

    // A link the page navigates to or opens in a new window: handed to the
    // system when it is https or mailto, otherwise dropped.
    public static bool IsExternal(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || uri.Scheme == "mailto");

    public static bool IsLarkUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "https" &&
        (uri.Host == "feishu.cn" || uri.Host.EndsWith(".feishu.cn", StringComparison.Ordinal) ||
         uri.Host == "larkoffice.com" || uri.Host.EndsWith(".larkoffice.com", StringComparison.Ordinal));

    public static bool IsReportUrl(string url) =>
        url.StartsWith(ReportPage, StringComparison.Ordinal) && url.Length <= 8000 && Uri.TryCreate(url, UriKind.Absolute, out _);

    public static bool IsSettingsSection(string value) => SettingsSection().IsMatch(value);

    public static bool IsBadge(string value) => value.Length == 0 || Badge().IsMatch(value);

    public static bool IsSpeechId(string value) => SpeechId().IsMatch(value);

    public static bool IsProfile(string value) => Profile().IsMatch(value);

    [GeneratedRegex("^[a-z-]{1,40}$")]
    private static partial Regex SettingsSection();

    [GeneratedRegex(@"^[1-9][0-9]?\+?$")]
    private static partial Regex Badge();

    [GeneratedRegex("^[A-Za-z0-9_-]{1,200}$")]
    private static partial Regex SpeechId();

    [GeneratedRegex("^[a-z0-9-]{1,32}$")]
    private static partial Regex Profile();
}
