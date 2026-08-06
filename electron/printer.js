'use strict';
/**
 * Electron main-process USB label printing for Detonger/Dothantech printers
 * (DP27 family, e.g. the rebadged "Seznik Josh"). Renderer sends a packed 1-bpp
 * bitmap; we encode it with dp27 and stream it to the printer's bulk endpoint.
 *
 * BLE is the iPad path (Capacitor plugin); USB is the desktop path (here).
 */
const dp = require('./dp27');

// The printer identifies as manufacturer "DeTong" / product "…Label Printer".
// Match on those strings so any DP-series unit is found, not just one VID/PID.
function isLabelPrinter(d) {
  const p = (d.productName || '').toLowerCase();
  const m = (d.manufacturerName || '').toLowerCase();
  return p.includes('label printer') || m.includes('detong') || m.includes('dothan');
}

// A WebUSB instance with allowAllDevices so getDevices() actually lists the
// printer without a browser-style authorization prompt (the default WebUSB
// returns nothing). Cached across calls.
let _webusb = null;
function webUsb() {
  if (_webusb) return _webusb;
  const { WebUSB } = require('usb');
  _webusb = new WebUSB({ allowAllDevices: true });
  return _webusb;
}

async function findDevice() {
  const list = await webUsb().getDevices();
  return list.find(isLabelPrinter) || null;
}

async function status() {
  try {
    const dev = await findDevice();
    if (!dev) return { connected: false };
    return { connected: true, name: dev.productName || 'Label printer', manufacturer: dev.manufacturerName || '' };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

// payload: { widthDots, heightDots, packed(base64, ceil(w/8)*h bytes, MSB-first,
//            bit=black), density?, speed? }
async function print(payload) {
  let dev;
  try {
    dev = await findDevice();
    if (!dev) return { ok: false, error: 'No label printer found on USB.' };

    const { widthDots: w, heightDots: h, packed } = payload;
    const bytesPerRow = Math.ceil(w / 8);
    const raw = Buffer.from(packed, 'base64');
    const pix = new Array(w * h).fill(false);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        pix[y * w + x] = (raw[y * bytesPerRow + (x >> 3)] & (1 << (7 - (x & 7)))) !== 0;

    const job = dp.buildUsbJob({ w, h, pix }, {
      density: payload.density ?? 12,   // 13/15 — dark but no bleed
      speed: payload.speed ?? 1,        // slower = crisper
    });

    await dev.open();
    if (!dev.configuration) await dev.selectConfiguration(1);
    let iface = null, outEp = null;
    for (const i of dev.configuration.interfaces) {
      for (const ep of i.alternate.endpoints)
        if (ep.type === 'bulk' && ep.direction === 'out') { iface = i.interfaceNumber; outEp = ep.endpointNumber; }
      if (outEp != null) break;
    }
    if (outEp == null) return { ok: false, error: 'Printer has no bulk OUT endpoint.' };
    await dev.claimInterface(iface);
    await dev.transferOut(outEp, job);
    await new Promise((r) => setTimeout(r, 400));
    await dev.releaseInterface(iface).catch(() => {});
    return { ok: true, bytes: job.length };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { if (dev) await dev.close(); } catch { /* ignore */ }
  }
}

module.exports = { status, print };
