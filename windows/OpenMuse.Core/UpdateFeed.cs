using System.Security.Cryptography;
using System.Text.Json;

namespace OpenMuse.Core;

// The current Windows release, as /download/windows.json names it: version,
// build number, the zip's URL on a download mirror, its size and SHA-256, and
// an ECDSA P-256 signature over the zip by the release key. The shell keeps a
// download only when all of them match; the signature is what ties a release
// to Open Muse, since the zip is not Authenticode-signed.
public sealed record Release(string Version, int Build, Uri Url, long Size, string Sha256, byte[] Signature)
{
    // The release key's public half (SubjectPublicKeyInfo, DER, base64).
    public const string PublicKey =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEcpILQ2pKf8j8Mg3znu/2vfMVtU9ZCPYmqxoXFueqgyjgVg8BH01x1LWr80kIS9fF/ALhu3QJpkKUJUv49hWaxg==";

    public static Release? Parse(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var version = root.GetProperty("version").GetString() ?? "";
            var build = root.GetProperty("build").GetInt32();
            var link = root.GetProperty("url").GetString() ?? "";
            var size = root.GetProperty("size").GetInt64();
            var sha256 = root.GetProperty("sha256").GetString() ?? "";
            var signature = Convert.FromBase64String(root.GetProperty("signature").GetString() ?? "");
            if (version.Length is 0 or > 40 || build <= 0 || size <= 0 || size > 1L << 30) return null;
            if (sha256.Length != 64 || !sha256.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f')) return null;
            if (!Uri.TryCreate(link, UriKind.Absolute, out var url) || url.Scheme != "https") return null;
            if (url.Host != "getopenmuse.com" && !url.Host.EndsWith(".getopenmuse.com", StringComparison.Ordinal)) return null;
            if (signature.Length != 64) return null;
            return new Release(version, build, url, size, sha256, signature);
        }
        catch (Exception)
        {
            return null;
        }
    }

    // The file is this release: its size, its SHA-256, and the release key's
    // signature over its bytes.
    public bool Verify(string file, string publicKey = PublicKey)
    {
        var info = new FileInfo(file);
        if (!info.Exists || info.Length != Size) return false;
        byte[] data = File.ReadAllBytes(file);
        if (Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant() != Sha256) return false;
        using var key = ECDsa.Create();
        key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKey), out _);
        return key.VerifyData(data, Signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    }
}
