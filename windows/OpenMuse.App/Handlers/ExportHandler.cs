using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32;
using OpenMuse.Core;

namespace OpenMuse.Handlers;

// museExport: a document or conversation saved where the person chooses. The
// answer goes back to the window that asked as muse-export-result.
public sealed class ExportHandler(ShellApp app) : IHandler
{
    public Task<object?> Handle(ShellWindow from, Message message)
    {
        var id = message.Get("id");
        var name = message.Get("name");
        var content = message.Get("content");
        if (id is null || name is null || content is null || Encoding.UTF8.GetByteCount(content) > 20_000_000)
            return Task.FromResult<object?>(null);
        var dialog = new SaveFileDialog
        {
            FileName = SafeName(name),
            AddExtension = true,
            OverwritePrompt = true,
        };
        var extension = Path.GetExtension(name);
        if (extension.Length > 1) dialog.Filter = $"{extension.TrimStart('.').ToUpperInvariant()}|*{extension}|*.*|*.*";
        var chosen = dialog.ShowDialog(from) == true;
        var success = false;
        if (chosen)
        {
            try
            {
                File.WriteAllText(dialog.FileName, content, new UTF8Encoding(false));
                success = true;
            }
            catch (Exception)
            {
                success = false;
            }
        }
        app.Dispatch(from, "muse-export-result", new { id, success, cancelled = !chosen });
        return Task.FromResult<object?>(null);
    }

    private static string SafeName(string name)
    {
        var file = Path.GetFileName(name.Replace('/', '_'));
        foreach (var invalid in Path.GetInvalidFileNameChars()) file = file.Replace(invalid, '_');
        return file.Length == 0 ? "Open Muse" : file;
    }
}
