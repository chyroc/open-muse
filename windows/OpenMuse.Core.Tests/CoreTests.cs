using System.Security.Cryptography;
using System.Text;
using OpenMuse.Core;
using Xunit;

public class AssetsTests
{
    [Fact]
    public void ServesOnlyFilesInsideTheRoot()
    {
        var root = Directory.CreateTempSubdirectory().FullName;
        File.WriteAllText(Path.Combine(root, "index.html"), "<p>");
        Directory.CreateDirectory(Path.Combine(root, "assets"));
        File.WriteAllText(Path.Combine(root, "assets", "app.js"), "");
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(root)!, "secret.txt"), "no");
        Assert.Equal(Path.Combine(root, "index.html"), Assets.Resolve(root, "muse://app/"));
        Assert.Equal(Path.Combine(root, "assets", "app.js"), Assets.Resolve(root, "muse://app/assets/app.js?v=1"));
        Assert.Null(Assets.Resolve(root, "muse://app/../secret.txt"));
        Assert.Null(Assets.Resolve(root, "muse://app/%2e%2e/secret.txt"));
        Assert.Null(Assets.Resolve(root, "muse://other/index.html"));
        Assert.Null(Assets.Resolve(root, "https://app/index.html"));
        Assert.Null(Assets.Resolve(root, "muse://app/assets"));
        Assert.Equal("text/javascript; charset=utf-8", Assets.MimeType("a.js"));
    }
}

public class MessageTests
{
    [Fact]
    public void ReadsTheMacContract()
    {
        var message = Message.Parse("""{"__muse":true,"id":7,"name":"museCredentials","body":{"operation":"read","n":2,"on":true}}""");
        Assert.NotNull(message);
        Assert.Equal(7, message!.Id);
        Assert.Equal("read", message.Get("operation"));
        Assert.Equal("2", message.Get("n"));
        Assert.Equal("true", message.Get("on"));
    }

    [Theory]
    [InlineData("""{"id":1,"name":"museCredentials","body":{}}""")]
    [InlineData("""{"__muse":true,"id":1,"name":"museEval","body":{}}""")]
    [InlineData("""{"__muse":true,"id":1,"name":"museWindow","body":{"x":{"y":1}}}""")]
    [InlineData("""{"__muse":true,"id":1,"name":"museWindow","body":"text"}""")]
    [InlineData("not json")]
    public void RefusesAnythingElse(string json) => Assert.Null(Message.Parse(json));
}

public class PolicyTests
{
    [Fact]
    public void OpensOnlyWhatTheMacOpens()
    {
        Assert.True(Policy.IsAppUrl("muse://app/#/settings"));
        Assert.False(Policy.IsAppUrl("muse://apple/"));
        Assert.True(Policy.IsExternal("https://example.com"));
        Assert.True(Policy.IsExternal("mailto:a@b.c"));
        Assert.False(Policy.IsExternal("file:///C:/Windows"));
        Assert.False(Policy.IsExternal("javascript:alert(1)"));
        Assert.True(Policy.IsLarkUrl("https://open.feishu.cn/app"));
        Assert.False(Policy.IsLarkUrl("https://feishu.cn.evil.com/"));
        Assert.True(Policy.IsReportUrl(Policy.ReportPage + "title=x"));
        Assert.False(Policy.IsReportUrl("https://github.com/someone/else/issues/new?"));
        Assert.True(Policy.IsBadge("9+"));
        Assert.False(Policy.IsBadge("0"));
        Assert.True(Policy.IsProfile("test-1"));
        Assert.False(Policy.IsProfile("../x"));
    }
}

public class ShortcutTests
{
    [Fact]
    public void TranslatesThePageEncoding()
    {
        // Ctrl+Alt+Space, the Windows default for Quick Chat.
        var quick = Shortcuts.Defaults["quickChat"];
        var keys = Shortcuts.ToWin32(quick.Code, quick.Modifiers);
        Assert.Equal((uint)0x20, keys!.Value.Key);
        Assert.Equal(Shortcuts.ModControl | Shortcuts.ModAlt | Shortcuts.ModNoRepeat, keys.Value.Modifiers);
        // Command is the Windows key; K is mac code 40.
        Assert.Equal((uint)'K', Shortcuts.ToWin32(40, Shortcuts.Command)!.Value.Key);
        Assert.True((Shortcuts.ToWin32(40, Shortcuts.Command)!.Value.Modifiers & Shortcuts.ModWin) != 0);
        Assert.Null(Shortcuts.ToWin32(40, Shortcuts.Shift));
        Assert.Null(Shortcuts.ToWin32(10, Shortcuts.Control));
        Assert.Null(Shortcuts.ToWin32(-1, 0));
    }
}

public class ReleaseTests
{
    [Fact]
    public void KeepsOnlyASignedReleaseThatMatches()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var publicKey = Convert.ToBase64String(key.ExportSubjectPublicKeyInfo());
        var data = Encoding.UTF8.GetBytes("open muse release");
        var file = Path.GetTempFileName();
        File.WriteAllBytes(file, data);
        var sha = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
        var signature = Convert.ToBase64String(key.SignData(data, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
        string Feed(string url = "https://download.getopenmuse.com/windows/a.zip", string? sum = null, string? sig = null) =>
            $$"""{"version":"20261014-abc1234","build":600,"url":"{{url}}","size":{{data.Length}},"sha256":"{{sum ?? sha}}","signature":"{{sig ?? signature}}"}""";
        var release = Release.Parse(Feed());
        Assert.NotNull(release);
        Assert.True(release!.Verify(file, publicKey));
        // Another key's signature, or the wrong bytes, are refused.
        Assert.False(release.Verify(file));
        File.WriteAllBytes(file, Encoding.UTF8.GetBytes("open muse releasf"));
        Assert.False(release.Verify(file, publicKey));
        Assert.Null(Release.Parse(Feed(url: "https://evil.example/a.zip")));
        Assert.Null(Release.Parse(Feed(url: "http://download.getopenmuse.com/a.zip")));
        Assert.Null(Release.Parse(Feed(sum: "XYZ")));
        Assert.Null(Release.Parse(Feed(sig: Convert.ToBase64String(new byte[10]))));
    }
}
