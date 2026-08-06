import Foundation
import Capacitor
import CoreBluetooth

/**
 * BLE-only label-printer transport for iOS (CoreBluetooth — no MFi needed).
 * Mirrors the Android plugin: scan, connect, find a writable characteristic,
 * and stream raw bytes (TSPL, built in TypeScript). No label-language logic here.
 */
@objc(PrefrontalPrinterPlugin)
public class PrefrontalPrinterPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {

    // Capacitor 6+ registers plugins through CAPBridgedPlugin (not the old .m
    // CAP_PLUGIN macro), so declare the identity + JS-callable methods here.
    public let identifier = "PrefrontalPrinterPlugin"
    public let jsName = "PrefrontalPrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isConnected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)
    ]

    private var central: CBCentralManager!
    private var discovered: [String: CBPeripheral] = [:]
    private var peripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?
    private var connectedId: String?
    // Characteristic discovery accumulates across services, then scores.
    private var pendingServices = 0
    private var candidates: [CBCharacteristic] = []

    // Known print-DATA characteristics / services (pick 0xff02 over 0xff11 etc.).
    private let prefChar: Set<String> = ["ff02", "ffe1", "ae01", "2af1"]
    private let prefSvc: Set<String> = ["ff00", "ffe0", "ae30", "18f0"]
    private func short16(_ u: CBUUID) -> String {
        let s = u.uuidString.lowercased()
        if s.count == 4 { return s }
        if s.hasPrefix("0000") && s.hasSuffix("-0000-1000-8000-00805f9b34fb") {
            return String(s.dropFirst(4).prefix(4))
        }
        return s
    }

    private var scanCall: CAPPluginCall?
    private var connectCall: CAPPluginCall?
    private var permCall: CAPPluginCall?

    // Write queue (one chunk at a time when writing with response).
    private var writeQueue: [Data] = []
    private var writeIndex = 0
    private var printCall: CAPPluginCall?

    public override func load() {
        central = CBCentralManager(delegate: self, queue: nil)
    }

    // ── permissions ──────────────────────────────────────────────────────
    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        // Creating the manager (in load) triggers the system prompt. Report the
        // current authorization state.
        let state = CBManager.authorization
        if state == .notDetermined {
            // Hold until the manager settles, then resolve.
            permCall = call
            return
        }
        call.resolve(["granted": state == .allowedAlways])
    }

    // ── scan ─────────────────────────────────────────────────────────────
    @objc func scan(_ call: CAPPluginCall) {
        guard central.state == .poweredOn else {
            call.reject("Bluetooth is off")
            return
        }
        discovered.removeAll()
        scanCall = call
        let timeout = Double(call.getInt("timeoutMs") ?? 6000) / 1000.0
        central.scanForPeripherals(withServices: nil, options: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
            guard let self = self else { return }
            self.central.stopScan()
            var devices: [[String: Any]] = []
            for (id, p) in self.discovered {
                var o: [String: Any] = ["deviceId": id]
                if let n = p.name { o["name"] = n }
                devices.append(o)
            }
            self.scanCall?.resolve(["devices": devices])
            self.scanCall = nil
        }
    }

    // ── connect ──────────────────────────────────────────────────────────
    @objc func connect(_ call: CAPPluginCall) {
        guard let id = call.getString("deviceId") else {
            call.reject("deviceId required"); return
        }
        var target = discovered[id]
        if target == nil, let uuid = UUID(uuidString: id) {
            target = central.retrievePeripherals(withIdentifiers: [uuid]).first
        }
        guard let p = target else { call.reject("Unknown deviceId — scan first"); return }
        connectCall = call
        peripheral = p
        p.delegate = self
        central.connect(p, options: nil)
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        if let p = peripheral { central.cancelPeripheralConnection(p) }
        peripheral = nil; writeChar = nil; connectedId = nil
        call.resolve()
    }

    @objc func isConnected(_ call: CAPPluginCall) {
        var ret: [String: Any] = ["connected": connectedId != nil && writeChar != nil]
        if let id = connectedId { ret["deviceId"] = id }
        call.resolve(ret)
    }

    // ── print ────────────────────────────────────────────────────────────
    @objc func print(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("data required"); return
        }
        guard let p = peripheral, let c = writeChar else { call.reject("Not connected"); return }

        // Chunk under the negotiated ATT MTU.
        let mtu = p.maximumWriteValueLength(for: .withResponse)
        let chunk = max(20, min(mtu, 180))
        writeQueue = stride(from: 0, to: data.count, by: chunk).map {
            data.subdata(in: $0 ..< min($0 + chunk, data.count))
        }
        writeIndex = 0
        printCall = call

        if c.properties.contains(.write) {
            sendNextWithResponse()
        } else {
            // write-without-response: fire them all, then resolve.
            for slice in writeQueue { p.writeValue(slice, for: c, type: .withoutResponse) }
            writeQueue = []
            printCall = nil
            call.resolve()
        }
    }

    private func sendNextWithResponse() {
        guard let p = peripheral, let c = writeChar else { return }
        if writeIndex >= writeQueue.count {
            printCall?.resolve(); printCall = nil; writeQueue = []
            return
        }
        p.writeValue(writeQueue[writeIndex], for: c, type: .withResponse)
    }

    // ── CBCentralManagerDelegate ─────────────────────────────────────────
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if let call = permCall {
            let state = CBManager.authorization
            if state != .notDetermined {
                call.resolve(["granted": state == .allowedAlways])
                permCall = nil
            }
        }
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                               advertisementData: [String: Any], rssi RSSI: NSNumber) {
        discovered[peripheral.identifier.uuidString] = peripheral
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(nil)
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
                               error: Error?) {
        connectCall?.reject("Connect failed: \(error?.localizedDescription ?? "")")
        connectCall = nil
    }

    // ── CBPeripheralDelegate ─────────────────────────────────────────────
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        let services = peripheral.services ?? []
        pendingServices = services.count
        candidates = []
        writeChar = nil
        for s in services { peripheral.discoverCharacteristics(nil, for: s) }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
                           error: Error?) {
        for c in service.characteristics ?? [] {
            if c.properties.contains(.write) || c.properties.contains(.writeWithoutResponse) {
                candidates.append(c)
            }
        }
        pendingServices -= 1
        if pendingServices > 0 { return }  // wait for every service

        // All characteristics in — pick the highest-scoring (the data channel).
        var best: CBCharacteristic?
        var bestScore = -1
        for c in candidates {
            let p = c.properties
            let score = (prefChar.contains(short16(c.uuid)) ? 100 : 0)
                + (prefSvc.contains(short16(c.service?.uuid ?? c.uuid)) ? 20 : 0)
                + (p.contains(.write) ? 10 : 0)
                + (p.contains(.writeWithoutResponse) ? 1 : 0)
            if score > bestScore { bestScore = score; best = c }
        }
        writeChar = best
        if best != nil {
            connectedId = peripheral.identifier.uuidString
            connectCall?.resolve()
        } else {
            connectCall?.reject("No writable characteristic found on this printer.")
        }
        connectCall = nil
    }

    public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic,
                           error: Error?) {
        if let e = error {
            printCall?.reject("Write failed: \(e.localizedDescription)")
            printCall = nil; writeQueue = []
            return
        }
        writeIndex += 1
        sendNextWithResponse()
    }
}
