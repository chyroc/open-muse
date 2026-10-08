package app.openmuse.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

// The system share sheet for the page's navigator.share, which Android's
// WebView lacks: text, a link, and files such as the screenshots of a problem
// report, as the iPhone app's web view shares them. Files are written to a
// private folder the receiving app may read, removed at the next share.
final class MuseShare implements MuseBridgePlugin.Feature {
    private static final int MOST_FILES = 10;
    private static final long MOST_BYTES = 25L * 1024 * 1024;
    private final Activity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    MuseShare(Activity activity) {
        this.activity = activity;
    }

    @Override
    public void handle(Object body, MuseBridgePlugin.Reply reply) {
        if (!(body instanceof JSONObject)) {
            reply.fail("Invalid share");
            return;
        }
        JSONObject request = (JSONObject) body;
        worker.execute(() -> {
            try {
                removeCopies();
                String text = request.optString("text");
                String url = request.optString("url");
                if (!url.isEmpty()) text = text.isEmpty() ? url : text + "\n" + url;
                ArrayList<Uri> uris = new ArrayList<>();
                ArrayList<String> types = new ArrayList<>();
                JSONArray files = request.optJSONArray("files");
                if (files != null && files.length() > 0) {
                    if (files.length() > MOST_FILES) throw new IllegalArgumentException();
                    File folder = new File(activity.getCacheDir(), "muse-share-" + UUID.randomUUID());
                    if (!folder.mkdir()) throw new IllegalStateException();
                    long total = 0;
                    for (int i = 0; i < files.length(); i++) {
                        JSONObject file = files.getJSONObject(i);
                        byte[] data = Base64.decode(file.optString("data"), Base64.DEFAULT);
                        total += data.length;
                        if (total > MOST_BYTES) throw new IllegalArgumentException();
                        File copy = new File(folder, i + "-" + safeName(file.optString("name")));
                        try (FileOutputStream out = new FileOutputStream(copy)) {
                            out.write(data);
                        }
                        uris.add(FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", copy));
                        String type = file.optString("type");
                        types.add(type.matches("^[\\w.+-]+/[\\w.+-]+$") ? type : "application/octet-stream");
                    }
                }
                if (text.isEmpty() && uris.isEmpty()) throw new IllegalArgumentException();
                Intent send;
                if (uris.size() > 1) {
                    send = new Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                } else {
                    send = new Intent(Intent.ACTION_SEND);
                    if (uris.size() == 1) send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
                }
                send.setType(uris.isEmpty() ? "text/plain" : commonType(types));
                if (!text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                if (!request.optString("title").isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, request.optString("title"));
                if (!uris.isEmpty()) {
                    ClipData clip = ClipData.newRawUri("", uris.get(0));
                    for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
                    send.setClipData(clip);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
                Intent chooser = Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.runOnUiThread(() -> {
                    activity.startActivity(chooser);
                    reply.ok("shared");
                });
            } catch (Exception error) {
                reply.fail("Sharing failed");
            }
        });
    }

    // image/png and image/jpeg share as image/*; mixed kinds as */*.
    private static String commonType(ArrayList<String> types) {
        String first = types.get(0);
        boolean same = true, sameKind = true;
        String kind = first.substring(0, first.indexOf('/'));
        for (String type : types) {
            same &= type.equals(first);
            sameKind &= type.startsWith(kind + "/");
        }
        return same ? first : sameKind ? kind + "/*" : "*/*";
    }

    private static String safeName(String name) {
        String base = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}:\\\\]", "-");
        if (base.length() > 100) base = base.substring(base.length() - 100);
        return base.isEmpty() || base.equals(".") || base.equals("..") ? "file" : base;
    }

    private void removeCopies() {
        File[] stale = activity.getCacheDir().listFiles((dir, name) -> name.startsWith("muse-share-"));
        if (stale == null) return;
        for (File folder : stale) {
            File[] files = folder.listFiles();
            if (files != null) for (File file : files) file.delete();
            folder.delete();
        }
    }
}
