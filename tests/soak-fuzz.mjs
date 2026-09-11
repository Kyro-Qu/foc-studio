/**
 * JustFloat fuzz + Store soak + 模式切换压力
 */

import { JustFloatDecoder, JUSTFLOAT_FRAME_SIZE } from "../js/protocol/justfloat.js";
import { TelemetryStore } from "../js/data/telemetry-store.js";
import { SimulationSource } from "../js/sim/simulation.js";
import { SessionRecorder } from "../js/data/recorder.js";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

function makeFrame(id) {
  const buf = new Uint8Array(JUSTFLOAT_FRAME_SIZE);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 16; i++) dv.setFloat32(i * 4, id + i * 0.01, true);
  buf[64] = 0;
  buf[65] = 0;
  buf[66] = 0x80;
  buf[67] = 0x7f;
  return buf;
}

console.log("\n[fuzz: mixed frames/text/garbage/fake tail]");
{
  let frames = 0;
  const dec = new JustFloatDecoder({ onFrame: () => frames++ });
  const expected = 200;
  let id = 0;
  const stream = [];
  for (let n = 0; n < expected; n++) {
    stream.push(makeFrame(id++));
    if (n % 10 === 0) stream.push(new TextEncoder().encode("status\r\n"));
    if (n % 17 === 0) {
      const junk = new Uint8Array(20);
      junk.fill(0xaa);
      stream.push(junk);
    }
    if (n % 25 === 0) {
      // 假 tail 单独出现
      stream.push(new Uint8Array([0, 0, 0x80, 0x7f]));
    }
  }
  // 帧内 Inf
  const vInf = new Float32Array(16).fill(1);
  vInf[3] = Infinity;
  const fInf = makeFrame(0);
  new DataView(fInf.buffer).setFloat32(12, Infinity, true);
  stream.push(fInf);
  expected + 1;

  const blob = new Uint8Array(stream.reduce((s, a) => s + a.length, 0));
  let off = 0;
  for (const a of stream) {
    blob.set(a, off);
    off += a.length;
  }
  // 随机 chunk
  let p = 0;
  while (p < blob.length) {
    const n = 1 + Math.floor(Math.random() * 90);
    dec.push(blob.subarray(p, Math.min(blob.length, p + n)));
    p += n;
  }
  assert(frames >= expected * 0.95, `fuzz decoded ${frames} >= ~${expected}`);
  assert(dec.framesOk === frames, "framesOk consistent");
}

console.log("\n[soak: 2e6 samples store wrap]");
{
  const store = new TelemetryStore(16, 10000);
  const v = new Float32Array(16);
  const N = 2_000_000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    v[0] = i % 1000;
    v[1] = i;
    store.push(v, i);
  }
  const ms = Date.now() - t0;
  assert(store.count === 10000, `capacity held ${store.count}`);
  assert(store.framesTotal === N, `framesTotal ${store.framesTotal}`);
  assert(store.latestIndex === N - 1, `latestIndex ${store.latestIndex}`);
  assert(store.data.length === 16 * 10000, "data array not grown");
  // sampleIndex 精确性（Float64）
  const last = store.sampleAt(store.count - 1);
  assert(last.sampleIndex === N - 1, `exact sampleIndex ${last.sampleIndex}`);
  console.log(`  info  ${N} pushes in ${ms}ms`);
  assert(ms < 30000, "soak under 30s");
}

console.log("\n[soak: sim 1kHz synthetic 3s]");
{
  let n = 0;
  const store = new TelemetryStore(16, 40000);
  const sim = new SimulationSource({
    rateHz: 1000,
    onFrame: (vals, idx) => {
      store.push(vals, idx);
      n++;
    },
  });
  // 直接 pump 3000 次 tick 而非 wall-clock（确定性）
  for (let i = 0; i < 3000; i++) sim._tick();
  assert(n === 3000, `sim ticks ${n}`);
  assert(store.count === 3000, "store count");
  assert(sim.sampleIndex === 3000, "sampleIndex continuous");
}

console.log("\n[recorder 60k export]");
{
  const rec = new SessionRecorder(16, 60000);
  rec.start();
  const v = new Float32Array(16);
  for (let i = 0; i < 60000; i++) {
    v[0] = i;
    rec.push(v, i);
  }
  const t0 = Date.now();
  const csv = rec.toCsv(Array.from({ length: 16 }, (_, i) => ({ name: `ch${i}` })));
  const ms = Date.now() - t0;
  const lines = csv.trim().split("\n");
  assert(lines.length === 60001, `csv lines ${lines.length}`);
  assert(ms < 15000, `csv export ${ms}ms`);
  console.log(`  info  csv export ${ms}ms`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
