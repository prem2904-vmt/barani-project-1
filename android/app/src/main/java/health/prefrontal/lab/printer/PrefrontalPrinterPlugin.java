package health.prefrontal.lab.printer;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.annotation.NonNull;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * BLE-only label-printer transport. Finds a writable GATT characteristic on the
 * chosen peripheral and streams raw bytes (TSPL, built in TypeScript) to it.
 * Deliberately dumb: no label-language knowledge lives here.
 */
@CapacitorPlugin(
    name = "PrefrontalPrinter",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN }, alias = "scan"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "connect"),
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location")
    }
)
public class PrefrontalPrinterPlugin extends Plugin {

    private BluetoothAdapter adapter;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;

    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private String connectedId;

    private PluginCall connectCall;
    private final Map<String, BluetoothDevice> found = new LinkedHashMap<>();

    // Signals for the write queue (one chunk at a time).
    private volatile CountDownLatch writeLatch;
    private volatile boolean writeOk;

    @Override
    public void load() {
        BluetoothManager mgr = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (mgr != null) adapter = mgr.getAdapter();
    }

    // ── permissions ──────────────────────────────────────────────────────
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        List<String> aliases = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            aliases.add("scan");
            aliases.add("connect");
        } else {
            aliases.add("location");
        }
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "permsCallback");
    }

    @PermissionCallback
    private void permsCallback(PluginCall call) {
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            granted = getPermissionState("scan") == com.getcapacitor.PermissionState.GRANTED
                && getPermissionState("connect") == com.getcapacitor.PermissionState.GRANTED;
        } else {
            granted = getPermissionState("location") == com.getcapacitor.PermissionState.GRANTED;
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    // ── scan ─────────────────────────────────────────────────────────────
    @PluginMethod
    public void scan(final PluginCall call) {
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth is off");
            return;
        }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("No BLE scanner");
            return;
        }
        found.clear();
        int timeout = call.getInt("timeoutMs", 6000);

        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int type, ScanResult result) {
                BluetoothDevice d = result.getDevice();
                if (d == null || d.getAddress() == null) return;
                found.put(d.getAddress(), d);
            }
        };

        try {
            scanner.startScan(scanCallback);
        } catch (SecurityException e) {
            call.reject("Missing BLE scan permission");
            return;
        }

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try { scanner.stopScan(scanCallback); } catch (Exception ignored) {}
            JSArray devices = new JSArray();
            for (BluetoothDevice d : found.values()) {
                JSObject o = new JSObject();
                o.put("deviceId", d.getAddress());
                try { o.put("name", d.getName()); } catch (SecurityException ignored) {}
                devices.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        }, timeout);
    }

    // ── connect ──────────────────────────────────────────────────────────
    @PluginMethod
    public void connect(final PluginCall call) {
        String id = call.getString("deviceId");
        if (id == null) { call.reject("deviceId required"); return; }
        if (adapter == null) { call.reject("No Bluetooth adapter"); return; }

        BluetoothDevice device = found.get(id);
        if (device == null) {
            try { device = adapter.getRemoteDevice(id); }
            catch (IllegalArgumentException e) { call.reject("Bad deviceId"); return; }
        }
        cleanupGatt();
        connectCall = call;
        try {
            gatt = device.connectGatt(getContext(), false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        } catch (SecurityException e) {
            call.reject("Missing BLE connect permission");
        }
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothGatt.STATE_CONNECTED) {
                try { g.requestMtu(247); } catch (SecurityException ignored) { discover(g); }
            } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                connectedId = null;
                writeChar = null;
                if (connectCall != null) { connectCall.reject("Disconnected"); connectCall = null; }
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            discover(g);
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            writeChar = findWritable(g);
            if (writeChar == null) {
                if (connectCall != null) { connectCall.reject("No writable characteristic"); connectCall = null; }
                return;
            }
            connectedId = g.getDevice().getAddress();
            if (connectCall != null) { connectCall.resolve(); connectCall = null; }
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            writeOk = status == BluetoothGatt.GATT_SUCCESS;
            CountDownLatch l = writeLatch;
            if (l != null) l.countDown();
        }
    };

    private void discover(BluetoothGatt g) {
        try { g.discoverServices(); }
        catch (SecurityException e) {
            if (connectCall != null) { connectCall.reject("Missing BLE connect permission"); connectCall = null; }
        }
    }

    // Known print-DATA characteristics / services, so we pick the data channel
    // (e.g. 0xff02 on 0xff00) over a config/OTA one (e.g. 0xff11 on 0xff10).
    private static final java.util.Set<String> PREF_CHAR =
        new java.util.HashSet<>(java.util.Arrays.asList("ff02", "ffe1", "ae01", "2af1"));
    private static final java.util.Set<String> PREF_SVC =
        new java.util.HashSet<>(java.util.Arrays.asList("ff00", "ffe0", "ae30", "18f0"));

    private static String short16(java.util.UUID u) {
        String s = u.toString().toLowerCase();
        return s.startsWith("0000") && s.endsWith("-0000-1000-8000-00805f9b34fb") ? s.substring(4, 8) : s;
    }

    /** Highest-scoring writable characteristic — the print-data channel. */
    private BluetoothGattCharacteristic findWritable(BluetoothGatt g) {
        BluetoothGattCharacteristic best = null;
        int bestScore = -1;
        for (BluetoothGattService s : g.getServices()) {
            for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                int p = c.getProperties();
                boolean w = (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
                boolean wn = (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
                if (!w && !wn) continue;
                int score = (PREF_CHAR.contains(short16(c.getUuid())) ? 100 : 0)
                    + (PREF_SVC.contains(short16(s.getUuid())) ? 20 : 0)
                    + (w ? 10 : 0) + (wn ? 1 : 0);
                if (score > bestScore) { bestScore = score; best = c; }
            }
        }
        return best;
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", connectedId != null && writeChar != null);
        if (connectedId != null) ret.put("deviceId", connectedId);
        call.resolve(ret);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        cleanupGatt();
        call.resolve();
    }

    private void cleanupGatt() {
        if (gatt != null) {
            try { gatt.disconnect(); gatt.close(); } catch (Exception ignored) {}
        }
        gatt = null;
        writeChar = null;
        connectedId = null;
    }

    // ── print ────────────────────────────────────────────────────────────
    @PluginMethod
    public void print(final PluginCall call) {
        final String data = call.getString("data");
        if (data == null) { call.reject("data required"); return; }
        if (gatt == null || writeChar == null) { call.reject("Not connected"); return; }

        final byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        // BLE writes are one-at-a-time; run on a worker so we can block per chunk.
        new Thread(() -> {
            try {
                int chunk = 180; // safe below a 247-byte MTU (ATT overhead)
                for (int off = 0; off < bytes.length; off += chunk) {
                    int end = Math.min(off + chunk, bytes.length);
                    byte[] slice = new byte[end - off];
                    System.arraycopy(bytes, off, slice, 0, slice.length);
                    if (!writeChunk(slice)) { call.reject("Write failed"); return; }
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Print error: " + e.getMessage());
            }
        }).start();
    }

    private boolean writeChunk(byte[] slice) throws InterruptedException {
        writeLatch = new CountDownLatch(1);
        writeOk = false;
        // Prefer acked writes (WRITE_TYPE_DEFAULT) when the char supports them —
        // more reliable than fire-and-forget, which can drop bytes.
        int type = (writeChar.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
            ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(writeChar, slice, type);
            } else {
                writeChar.setWriteType(type);
                writeChar.setValue(slice);
                gatt.writeCharacteristic(writeChar);
            }
        } catch (SecurityException e) {
            return false;
        }
        boolean done = writeLatch.await(3, TimeUnit.SECONDS);
        return done && writeOk;
    }
}
