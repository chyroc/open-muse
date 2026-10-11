package app.openmuse.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

// Updates the app, which is installed from the website rather than a store.
// The page names the current release from the site's update feed; this
// downloads it from one of the two download mirrors only, and keeps it only
// when its size and SHA-256 match the feed, it is this app's package with a
// higher version code, and it is signed with this app's own certificate.
// Installing hands it to the system installer, which always asks the person;
// the first time, Android asks them to allow installs from this app.
final class MuseUpdate implements MuseBridgePlugin.Feature {
    private static final String[] SOURCES = {
        "https://download.getopenmuse.com/android/",
        "https://cn.getopenmuse.com/android/",
    };
    private static final long MOST_BYTES = 200L * 1024 * 1024;
    private final Activity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    // The verified release waiting to be installed, and its version code.
    private volatile File staged;
    private volatile long stagedBuild;

    MuseUpdate(Activity activity) {
        this.activity = activity;
    }

    @Override
    public void handle(Object body, MuseBridgePlugin.Reply reply) {
        JSONObject request = body instanceof JSONObject ? (JSONObject) body : new JSONObject();
        switch (request.optString("operation")) {
            case "download":
                worker.execute(() -> download(request, reply));
                break;
            case "install":
                install(reply);
                break;
            default:
                reply.fail("Invalid update request");
        }
    }

    private void download(JSONObject request, MuseBridgePlugin.Reply reply) {
        try {
            String url = request.getString("url");
            long size = request.getLong("size");
            String sha256 = request.getString("sha256").toLowerCase(Locale.ROOT);
            long build = request.getLong("build");
            boolean known = false;
            for (String source : SOURCES) known |= url.startsWith(source) && url.endsWith(".apk");
            if (!known || size <= 0 || size > MOST_BYTES || !sha256.matches("^[0-9a-f]{64}$") || build <= current()) {
                reply.fail("Invalid update");
                return;
            }
            File folder = new File(activity.getCacheDir(), "updates");
            if (!folder.isDirectory() && !folder.mkdirs()) throw new IllegalStateException();
            File file = new File(folder, "open-muse-" + build + ".apk");
            // A release downloaded earlier is used again once it still checks out.
            if (!(file.length() == size && sha256.equals(digest(file)) && verified(file, build))) {
                File[] old = folder.listFiles();
                if (old != null) for (File each : old) each.delete();
                File partial = new File(folder, "download.part");
                fetch(url, partial, size);
                if (!sha256.equals(digest(partial)) || !partial.renameTo(file) || !verified(file, build)) {
                    partial.delete();
                    file.delete();
                    reply.fail("The update did not verify");
                    return;
                }
            }
            staged = file;
            stagedBuild = build;
            reply.ok(new JSONObject().put("ready", true).put("build", build));
        } catch (Exception error) {
            reply.fail("The update could not be downloaded");
        }
    }

    private void install(MuseBridgePlugin.Reply reply) {
        File file = staged;
        if (file == null || !file.isFile() || stagedBuild <= current()) {
            reply.fail("No update is ready");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                if (!activity.getPackageManager().canRequestPackageInstalls()) {
                    // The person allows this app to install updates, then
                    // installs again; nothing is installed meanwhile.
                    activity.startActivity(new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())));
                    reply.ok(new JSONObject().put("permission", true));
                    return;
                }
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                reply.ok(new JSONObject().put("started", true));
            } catch (Exception error) {
                reply.fail("The installer could not open");
            }
        });
    }

    private long current() {
        try {
            return activity.getPackageManager()
                .getPackageInfo(activity.getPackageName(), 0)
                .getLongVersionCode();
        } catch (Exception error) {
            return Long.MAX_VALUE;
        }
    }

    private static void fetch(String address, File into, long size) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(60_000);
        try {
            if (connection.getResponseCode() != 200) throw new IllegalStateException();
            long total = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(into)) {
                for (int read; (read = in.read(buffer)) != -1; ) {
                    total += read;
                    if (total > size) throw new IllegalStateException();
                    out.write(buffer, 0, read);
                }
            }
            if (total != size) throw new IllegalStateException();
        } finally {
            connection.disconnect();
        }
    }

    private static String digest(File file) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];
        try (InputStream in = new FileInputStream(file)) {
            for (int read; (read = in.read(buffer)) != -1; ) sha.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte value : sha.digest()) hex.append(String.format(Locale.ROOT, "%02x", value));
        return hex.toString();
    }

    // This app's package, the version the feed named, and the same signing
    // certificates as the installed app.
    private boolean verified(File file, long build) {
        try {
            PackageManager manager = activity.getPackageManager();
            PackageInfo archive = manager.getPackageArchiveInfo(
                file.getPath(), PackageManager.GET_SIGNING_CERTIFICATES);
            PackageInfo installed = manager.getPackageInfo(
                activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
            if (archive == null || !activity.getPackageName().equals(archive.packageName)) return false;
            if (archive.getLongVersionCode() != build) return false;
            Set<String> mine = signers(installed.signingInfo);
            return !mine.isEmpty() && mine.equals(signers(archive.signingInfo));
        } catch (Exception error) {
            return false;
        }
    }

    private static Set<String> signers(SigningInfo info) throws Exception {
        Set<String> out = new HashSet<>();
        if (info == null) return out;
        Signature[] signatures = info.hasMultipleSigners()
            ? info.getApkContentsSigners()
            : info.getSigningCertificateHistory();
        if (signatures == null) return out;
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        for (Signature signature : signatures) {
            StringBuilder hex = new StringBuilder();
            for (byte value : sha.digest(signature.toByteArray()))
                hex.append(String.format(Locale.ROOT, "%02x", value));
            out.add(hex.toString());
        }
        return out;
    }
}
