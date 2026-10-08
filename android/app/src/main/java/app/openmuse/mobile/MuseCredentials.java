package app.openmuse.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

// The app's MA credentials, in the two namespaces the iPhone app keeps in the
// Keychain: the direct-MA credential and the Open Muse background-service
// credential. Each has its own AES-GCM key in the AndroidKeyStore and its own
// private preferences holding only the encrypted value.
final class MuseCredentials implements MuseBridgePlugin.Feature {
    private static final String DIRECT_ALIAS = "app.openmuse.direct-ma.v1";
    private static final String BACKGROUND_ALIAS = "app.openmuse.background.v1";
    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    MuseCredentials(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public void handle(Object body, MuseBridgePlugin.Reply reply) {
        if (!(body instanceof JSONObject)) {
            reply.fail("Invalid credential request");
            return;
        }
        JSONObject request = (JSONObject) body;
        String namespace = request.optString("namespace", "");
        if (!namespace.isEmpty() && !namespace.equals("background")) {
            reply.fail("Invalid credential namespace");
            return;
        }
        String alias = namespace.equals("background") ? BACKGROUND_ALIAS : DIRECT_ALIAS;
        String operation = request.optString("operation");
        if (operation.equals("read")) {
            worker.execute(() -> read(alias, reply));
        } else if (operation.equals("write") && request.opt("value") instanceof String
                && request.optString("value").getBytes(StandardCharsets.UTF_8).length <= 65536) {
            String value = request.optString("value");
            worker.execute(() -> write(alias, value, reply));
        } else {
            reply.fail("Invalid credential operation");
        }
    }

    private SharedPreferences preferences(String alias) {
        return context.getSharedPreferences(alias, Context.MODE_PRIVATE);
    }

    private static SecretKey key(String alias) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(alias, null);
    }

    private void read(String alias, MuseBridgePlugin.Reply reply) {
        try {
            SharedPreferences preferences = preferences(alias);
            String encrypted = preferences.getString("value", "");
            if (encrypted.isEmpty()) {
                reply.ok("");
                return;
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            byte[] iv = Base64.decode(preferences.getString("iv", ""), Base64.NO_WRAP);
            cipher.init(Cipher.DECRYPT_MODE, key(alias), new GCMParameterSpec(128, iv));
            reply.ok(new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8));
        } catch (Exception error) {
            reply.fail("Cannot restore credentials");
        }
    }

    private void write(String alias, String value, MuseBridgePlugin.Reply reply) {
        try {
            SharedPreferences.Editor edit = preferences(alias).edit();
            if (value.isEmpty()) {
                edit.remove("iv").remove("value");
            } else {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key(alias));
                edit.putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
                edit.putString("value", Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
            }
            if (!edit.commit()) throw new IllegalStateException();
            reply.ok(true);
        } catch (Exception error) {
            reply.fail("Cannot save credentials");
        }
    }
}
