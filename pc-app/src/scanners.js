// Watches USB for hardware barcode scanners and reports plug / unplug.
// USB scanners normally behave like a keyboard, so they already type into any app -
// this only detects them so Trackpad can show "Scanner connected".
const si = require('systeminformation');

const SCANNER_RE =
  /scan|barcode|bar code|symbol|zebra|honeywell|datalogic|newland|netum|opticon|metrologic|intermec|cino|eyoyo|inateck|socket mobile|code reader|imager|tera |unitech|argox|godex|hand.?held reader/i;

function watch(onChange, intervalMs = 3000) {
  let last = '[]';
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const usb = await si.usb();
      const seen = new Map();
      for (const d of usb) {
        const label = `${d.manufacturer || ''} ${d.name || ''}`.trim();
        if (SCANNER_RE.test(label)) seen.set(label, { name: d.name || 'USB scanner', vendor: d.manufacturer || '' });
      }
      const list = [...seen.values()];
      const key = JSON.stringify(list);
      if (key !== last) {
        const before = JSON.parse(last);
        last = key;
        const added = list.filter((n) => !before.some((b) => b.name === n.name));
        onChange(list, added);
      }
    } catch {
      /* USB listing not supported on this system - ignore */
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

module.exports = { watch };
