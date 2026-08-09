package health.prefrontal.lab;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import health.prefrontal.lab.printer.PrefrontalPrinterPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local Capacitor plugins must be registered before the bridge
        // starts so the WebView can see them.
        registerPlugin(PrefrontalPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
