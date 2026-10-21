using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using OpenMuse.Core;

namespace OpenMuse.Handlers;

// museReport: a picture of the workspace for a problem report, and the
// project's new-issue page opened with that picture on the clipboard to
// paste. Only that page opens, and only the picture the person kept is copied.
public sealed class ReportHandler : IHandler
{
    private byte[]? snapshot;

    public async Task<object?> Handle(ShellWindow from, Message message)
    {
        switch (message.Get("operation"))
        {
            case "snapshot":
                if (from.Kind != WindowKind.Workspace || from.Core is null) throw new ShellError("Invalid report request");
                using (var stream = new MemoryStream())
                {
                    await from.Core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                    snapshot = Shrink(stream.ToArray(), 1600);
                }
                return snapshot is null ? null : "data:image/png;base64," + Convert.ToBase64String(snapshot);
            case "submit":
                var url = message.Get("url") ?? "";
                if (!Policy.IsReportUrl(url)) throw new ShellError("Invalid report request");
                if (message.Get("image") == "true" && snapshot is not null)
                {
                    var image = new BitmapImage();
                    image.BeginInit();
                    image.StreamSource = new MemoryStream(snapshot);
                    image.CacheOption = BitmapCacheOption.OnLoad;
                    image.EndInit();
                    Clipboard.SetImage(image);
                }
                snapshot = null;
                ShellWindow.OpenExternal(url);
                return true;
            case "discard":
                snapshot = null;
                return true;
            default:
                throw new ShellError("Invalid report request");
        }
    }

    // At most `width` pixels wide, as the Mac snapshot is taken.
    private static byte[]? Shrink(byte[] png, int width)
    {
        try
        {
            var decoder = new PngBitmapDecoder(new MemoryStream(png), BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
            BitmapSource frame = decoder.Frames[0];
            if (frame.PixelWidth > width)
            {
                var scale = (double)width / frame.PixelWidth;
                frame = new TransformedBitmap(frame, new System.Windows.Media.ScaleTransform(scale, scale));
            }
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(frame));
            using var output = new MemoryStream();
            encoder.Save(output);
            return output.ToArray();
        }
        catch (Exception)
        {
            return null;
        }
    }
}
