package app.openmuse.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import androidx.core.content.FileProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import org.json.JSONObject;

// Library files: a preview in the phone's own viewer, the share sheet, and
// thumbnails for the media grid. Only a fresh MA-issued TOS capability is
// downloaded, without cookies, redirects or an HTTP cache. Thumbnails are
// decoded in memory and returned as re-encoded pixels, so no signed URL or
// original bytes reach the page.
final class MuseFiles implements MuseBridgePlugin.Feature {
    private static final int LIMIT = 10 * 1024 * 1024;
    private static final Pattern HOST = Pattern.compile("^[a-z0-9][a-z0-9-]*\\.tos-cn-beijing\\.volces\\.com$");
    private final Activity activity;
    private final ExecutorService worker = Executors.newFixedThreadPool(3);
    private final AtomicInteger thumbnails = new AtomicInteger();
    private volatile boolean busy;

    private static final class TooLarge extends Exception {}

    MuseFiles(Activity activity) {
        this.activity = activity;
        // Copies handed to another app last time are no longer needed.
        worker.execute(this::removeCopies);
    }

    @Override
    public void handle(Object body, MuseBridgePlugin.Reply reply) {
        JSONObject request = body instanceof JSONObject ? (JSONObject) body : null;
        URL url = request == null ? null : capability(request.optString("url"));
        String action = request == null ? "" : request.optString("action");
        if (url == null) {
            reply.ok("unavailable");
            return;
        }
        if (action.equals("thumbnail")) {
            // A picture shown on its own in the chat is drawn larger.
            thumbnail(url, "large".equals(request.optString("size")) ? 960 : 480, reply);
            return;
        }
        String name = request.optString("name");
        if (name.isEmpty() || name.length() > 4096 || !(action.equals("preview") || action.equals("share")) || busy) {
            reply.ok("unavailable");
            return;
        }
        busy = true;
        worker.execute(() -> {
            try {
                removeCopies();
                byte[] data = download(url);
                File folder = new File(activity.getCacheDir(), "muse-file-" + UUID.randomUUID());
                if (!folder.mkdir()) throw new IllegalStateException();
                File file = new File(folder, filename(name));
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(data);
                }
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", file);
                String type = mimeType(file.getName());
                Intent intent;
                if (action.equals("preview")) {
                    intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, type);
                } else {
                    Intent send = new Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri);
                    send.setClipData(ClipData.newRawUri(file.getName(), uri));
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent = Intent.createChooser(send, null);
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.runOnUiThread(() -> {
                    busy = false;
                    try {
                        activity.startActivity(intent);
                        reply.ok("opened");
                    } catch (ActivityNotFoundException noViewer) {
                        reply.ok("unavailable");
                    }
                });
            } catch (TooLarge error) {
                busy = false;
                reply.ok("too-large");
            } catch (Exception error) {
                busy = false;
                reply.ok("unavailable");
            }
        });
    }

    private static URL capability(String address) {
        try {
            if (address.isEmpty() || address.length() > 16000) return null;
            Uri uri = Uri.parse(address);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || !HOST.matcher(uri.getHost()).matches()
                    || uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null) return null;
            return new URL(address);
        } catch (Exception error) {
            return null;
        }
    }

    private static byte[] download(URL url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("Cookie", "");
        try {
            if (connection.getResponseCode() != 200) throw new IllegalStateException();
            if (connection.getContentLengthLong() > LIMIT) throw new TooLarge();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = connection.getInputStream()) {
                for (int read; (read = in.read(buffer)) != -1; ) {
                    if (bytes.size() + read > LIMIT) throw new TooLarge();
                    bytes.write(buffer, 0, read);
                }
            }
            return bytes.toByteArray();
        } finally {
            connection.disconnect();
        }
    }

    private static String filename(String name) {
        String base = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}:\\\\]", "-");
        if (base.length() > 120) base = base.substring(0, 120);
        return base.isEmpty() || base.equals(".") || base.equals("..") ? "file" : base;
    }

    private static String mimeType(String name) {
        int dot = name.lastIndexOf('.');
        String type = dot < 0 ? null
            : MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT));
        return type == null ? "application/octet-stream" : type;
    }

    private void removeCopies() {
        File[] stale = activity.getCacheDir().listFiles((dir, name) -> name.startsWith("muse-file-"));
        if (stale == null) return;
        for (File folder : stale) {
            File[] files = folder.listFiles();
            if (files != null) for (File file : files) file.delete();
            folder.delete();
        }
    }

    private void thumbnail(URL url, int largest, MuseBridgePlugin.Reply reply) {
        if (thumbnails.incrementAndGet() > 2) {
            thumbnails.decrementAndGet();
            reply.ok("busy");
            return;
        }
        worker.execute(() -> {
            try {
                byte[] data = download(url);
                String encoded = encoded(data, largest);
                reply.ok(encoded == null ? "unavailable" : encoded);
            } catch (TooLarge error) {
                reply.ok("too-large");
            } catch (Exception error) {
                reply.ok("unavailable");
            } finally {
                thumbnails.decrementAndGet();
            }
        });
    }

    // Images are downsampled while decoding, which bounds memory for very
    // large dimensions, and turned upright. A PDF shows its first page, wide
    // enough for a document card. SVG and other non-bitmap types are rejected.
    private String encoded(byte[] data, int largest) throws Exception {
        if (data.length > 5 && new String(data, 0, 5, "US-ASCII").equals("%PDF-")) return pdf(data);
        Bitmap image;
        try {
            image = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(data)), (decoder, info, source) -> {
                int width = info.getSize().getWidth(), height = info.getSize().getHeight();
                double scale = Math.min(1, largest / (double) Math.max(width, height));
                decoder.setTargetSize(Math.max(1, (int) Math.round(width * scale)), Math.max(1, (int) Math.round(height * scale)));
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
            });
        } catch (Exception notAnImage) {
            return null;
        }
        boolean opaque = !image.hasAlpha();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        image.compress(opaque ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.PNG, 80, out);
        image.recycle();
        return (opaque ? "data:image/jpeg;base64," : "data:image/png;base64,") + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    // The PDF reader needs a file; it exists only while the page is drawn.
    private String pdf(byte[] data) throws Exception {
        File file = File.createTempFile("muse-pdf-", ".pdf", activity.getCacheDir());
        try {
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(descriptor)) {
                if (renderer.getPageCount() == 0) return null;
                try (PdfRenderer.Page page = renderer.openPage(0)) {
                    if (page.getWidth() <= 0 || page.getHeight() <= 0) return null;
                    double scale = Math.min(720.0 / page.getWidth(), 4);
                    Bitmap image = Bitmap.createBitmap((int) Math.round(page.getWidth() * scale),
                        (int) Math.round(page.getHeight() * scale), Bitmap.Config.ARGB_8888);
                    image.eraseColor(Color.WHITE);
                    page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    image.compress(Bitmap.CompressFormat.JPEG, 80, out);
                    image.recycle();
                    return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                }
            }
        } finally {
            file.delete();
        }
    }
}
