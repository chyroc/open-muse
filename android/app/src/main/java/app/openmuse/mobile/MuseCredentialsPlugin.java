package app.openmuse.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Keystore-backed secure storage for the app's MA credentials, mirroring the
// two namespaces the iPhone app keeps: the direct-MA credential and the Open
// Muse background-service credential. Each namespace has its own AES-GCM key
// in the AndroidKeyStore and its own encrypted SharedPreferences, and only the
// bundled main frame at https://localhost may read or write.
@CapacitorPlugin(name = "MuseCredentials")
public class MuseCredentialsPlugin extends Plugin {
    private static final String DIRECT_ALIAS = "app.openmuse.direct-ma.v1";
    private static final String BACKGROUND_ALIAS = "app.openmuse.background.v1";

    private String alias(PluginCall call) {
        return "background".equals(call.getString("namespace")) ? BACKGROUND_ALIAS : DIRECT_ALIAS;
    }

    private SharedPreferences preferences(String alias) {
        return getContext().getSharedPreferences(alias, Context.MODE_PRIVATE);
    }

    private SecretKey key(String alias) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(alias, null);
    }

    private boolean trusted(PluginCall call) {
        String url = getBridge().getWebView().getUrl();
        if (url == null || !(url.equals("https://localhost") || url.startsWith("https://localhost/") || url.startsWith("https://localhost#"))) {
            call.reject("Untrusted credential request");
            return false;
        }
        return true;
    }

    @PluginMethod
    public void read(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            if (trusted(call)) execute(() -> readCredentials(call));
        });
    }

    private synchronized void readCredentials(PluginCall call) {
        String alias = alias(call);
        try {
            SharedPreferences preferences = preferences(alias);
            String encrypted = preferences.getString("value", "");
            String value = "";
            if (!encrypted.isEmpty()) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                byte[] iv = Base64.decode(preferences.getString("iv", ""), Base64.NO_WRAP);
                cipher.init(Cipher.DECRYPT_MODE, key(alias), new GCMParameterSpec(128, iv));
                value = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            }
            JSObject result = new JSObject();
            result.put("value", value);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Cannot restore secure credentials");
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            if (trusted(call)) execute(() -> writeCredentials(call));
        });
    }

    private synchronized void writeCredentials(PluginCall call) {
        String alias = alias(call);
        String value = call.getString("value");
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 65536) {
            call.reject("Invalid credential value");
            return;
        }
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
            call.resolve();
        } catch (Exception error) {
            call.reject("Cannot save secure credentials");
        }
    }
}
