// Quick protocol test: phone connects, sends a scan, gets an ack. Run: npm test
const assert = require("assert");
const WebSocket = require("ws");
const bridge = require("../src/bridge");

(async () => {
  const got = [];
  let devices = [];
  const srv = await bridge.start({
    token: "secret",
    preferredPort: 5555,
    onScan: async (m, d) => { got.push([m.code, d.name]); },
    onDevices: (l) => { devices = l; },
  });

  // wrong token is rejected
  await new Promise((res) => {
    const bad = new WebSocket(`ws://127.0.0.1:${srv.port}/?token=nope`);
    bad.on("close", (code) => { assert.strictEqual(code, 4001); res(); });
    bad.on("error", () => {});
  });

  // good token: scan + ack
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/?token=secret&name=TestPhone`);
  const ack = await new Promise((res) => {
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "welcome") ws.send(JSON.stringify({ type: "scan", id: "1", code: "8901234567890", format: "ean13" }));
      if (m.type === "ack") res(m);
    });
  });
  assert.strictEqual(ack.ok, true);
  assert.deepStrictEqual(got[0], ["8901234567890", "TestPhone"]);
  assert.strictEqual(devices.length, 1);
  ws.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(devices.length, 0);

  srv.close();
  console.log("bridge test passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
