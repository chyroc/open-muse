package app.openmuse.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MuseCredentialsPlugin.class);
        registerPlugin(MuseBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
