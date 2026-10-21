using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using OpenMuse.Core;

namespace OpenMuse.Handlers;

// museCredentials: the sign-in the page keeps (the direct Ark login, and the
// Open Muse account under namespace "background"), encrypted with DPAPI for
// this Windows user only, one file each per profile. The Mac keeps the same
// values in its Keychain. A read of nothing returns ""; writing "" deletes.
public sealed class CredentialsHandler(ShellApp app) : IHandler
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("open-muse.credentials.v1");

    public async Task<object?> Handle(ShellWindow from, Message message)
    {
        var space = message.Get("namespace");
        if (space is not null && space != "background") throw new ShellError("Invalid credential namespace");
        var file = app.Profile.File(space == "background" ? "background.credentials" : "direct-ma.credentials");
        switch (message.Get("operation"))
        {
            case "read":
                return await Task.Run(() => Read(file));
            case "write":
                var value = message.Get("value");
                if (value is null || Encoding.UTF8.GetByteCount(value) > 65536) throw new ShellError("Invalid credential operation");
                await Task.Run(() => Write(file, value));
                // Every window shares one sign-in, so the others refresh.
                app.Broadcast("muse-credentials-changed", except: from);
                return true;
            default:
                throw new ShellError("Invalid credential operation");
        }
    }

    private static string Read(string file)
    {
        if (!File.Exists(file)) return "";
        try
        {
            var data = ProtectedData.Unprotect(File.ReadAllBytes(file), Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(data);
        }
        catch (Exception)
        {
            throw new ShellError(Strings.T("Cannot restore secure credentials"));
        }
    }

    private static void Write(string file, string value)
    {
        try
        {
            if (value.Length == 0)
            {
                if (File.Exists(file)) File.Delete(file);
                return;
            }
            var data = ProtectedData.Protect(Encoding.UTF8.GetBytes(value), Entropy, DataProtectionScope.CurrentUser);
            var temp = file + ".tmp";
            File.WriteAllBytes(temp, data);
            File.Move(temp, file, true);
        }
        catch (Exception)
        {
            throw new ShellError(Strings.T("Cannot save secure credentials"));
        }
    }
}
