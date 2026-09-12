/**
 * FOC Studio 协议/存储单元测试（Node ESM）
 * 运行: node tests/run-tests.mjs
 */

import { JustFloatDecoder, JUSTFLOAT_FRAME_SIZE } from "../js/protocol/justfloat.js";
import { TelemetryStore } from "../js/data/telemetry-store.js";
import { DEFAULT_CHANNELS, CHANNEL_COUNT } from "../js/channels.js";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

function almost(a, b, eps = 1e-5) {
  return Math.abs(a - b) < eps;
}

function makeFrame(values) {
  const buf = new Uint8Array(JUSTFLOAT_FRAME_SIZE);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 16; i++) dv.setFloat32(i * 4, values[i], true);
  buf[64] = 0x00;
  buf[65] = 0x00;
  buf[66] = 0x80;
  buf[67] = 0x7f;
  return buf;
}

function valuesOf(start) {
  const v = new Float32Array(16);
  for (let i = 0; i < 16; i++) v[i] = start + i * 0.1;
  return v;
}

/* ---------- decoder ---------- */
console.log("\n[JustFloatDecoder]");

{
  const frames = [];
  const dec = new JustFloatDecoder({ onFrame: (v, i) => frames.push({ v: Array.from(v), i }) });
  const f = makeFrame(valuesOf(1));
  dec.push(f.subarray(0, 17));
  dec.push(f.subarray(17, 50));
  dec.push(f.subarray(50));
  assert(frames.length === 1, "split across 3 chunks → 1 frame");
  assert(almost(frames[0].v[0], 1), "ch0 value");
  assert(almost(frames[0].v[15], 1 + 1.5), "ch15 value");
  assert(frames[0].i === 0, "sampleIndex 0");
}

{
  const frames = [];
  const texts = [];
  const dec = new JustFloatDecoder({
    onFrame: (v) => frames.push(v),
    onText: (t) => texts.push(t),
  });
  const text = new TextEncoder().encode("M0 RUN mode=vel\r\n");
  const f1 = makeFrame(valuesOf(0));
  const f2 = makeFrame(valuesOf(10));
  const mixed = new Uint8Array(text.length + f1.length + f2.length);
  mixed.set(text, 0);
  mixed.set(f1, text.length);
  mixed.set(f2, text.length + f1.length);
  dec.push(mixed);
  assert(frames.length === 2, "text+2frames → 2 frames");
  assert(texts.join("").includes("M0 RUN"), "text extracted");
  assert(dec.locked === true, "locked after 2 consecutive frames");
}

{
  // +Inf 伪 tail：通道里出现 00 00 80 7F，锁定后不应误切
  const frames = [];
  const dec = new JustFloatDecoder({ onFrame: (v) => frames.push(v) });
  // 先发 3 个正常帧建立锁定
  for (let k = 0; k < 3; k++) dec.push(makeFrame(valuesOf(k)));
  const base = frames.length;
  const vInf = valuesOf(5);
  vInf[7] = Infinity; // vd = +Inf，字节即 tail
  dec.push(makeFrame(vInf));
  assert(frames.length === base + 1, "Inf channel does not desync locked stream");
  assert(almost(frames[frames.length - 1][7], Infinity) || frames[frames.length - 1][7] === Infinity, "Inf value preserved");
  assert(dec.desync === 0, "desync stays 0 when locked");
}

{
  const dec = new JustFloatDecoder({});
  // 200 帧连续
  let ok = 0;
  dec.onFrame = () => {
    ok += 1;
  };
  const batch = new Uint8Array(200 * JUSTFLOAT_FRAME_SIZE);
  for (let i = 0; i < 200; i++) {
    batch.set(makeFrame(valuesOf(i)), i * JUSTFLOAT_FRAME_SIZE);
  }
  // 随机拆包
  let off = 0;
  while (off < batch.length) {
    const n = Math.min(batch.length - off, 1 + Math.floor(Math.random() * 90));
    dec.push(batch.subarray(off, off + n));
    off += n;
  }
  assert(ok === 200, `random chunking 200 frames → ${ok}`);
}

{
  // 垃圾字节后仍能重新同步
  const frames = [];
  const dec = new JustFloatDecoder({ onFrame: (v) => frames.push(v) });
  const junk = new Uint8Array(300);
  junk.fill(0xaa);
  dec.push(junk);
  dec.push(makeFrame(valuesOf(3)));
  assert(frames.length === 1, "resync after junk");
}

/* ---------- store ---------- */
console.log("\n[TelemetryStore]");

{
  const store = new TelemetryStore(16, 10);
  for (let i = 0; i < 15; i++) {
    const v = new Float32Array(16).fill(i);
    store.push(v, i);
  }
  assert(store.length === 10, "capacity cap");
  assert(store.latest[0] === 14, "latest after wrap");
  assert(store.framesTotal === 15, "framesTotal");
  const s = store.getSeries(0, 5);
  assert(s.n === 5, "getSeries n");
  assert(s.y[4] === 14, "getSeries last is newest");
  assert(s.y[0] === 10, "getSeries first of window");
}

{
  const store = new TelemetryStore(16, 1000);
  for (let i = 0; i < 1000; i++) {
    const v = new Float32Array(16);
    v[0] = Math.sin(i / 20) * 10;
    v[1] = i;
    store.push(v, i);
  }
  const p = store.getSeriesPeaks(0, 1000, 100);
  assert(p.n === 100, "peaks columns");
  let globalMax = -Infinity;
  for (let i = 0; i < p.n; i++) globalMax = Math.max(globalMax, p.maxY[i]);
  assert(globalMax > 9, `peak max ≈ 10 got ${globalMax}`);
}

{
  const store = new TelemetryStore(16, 50);
  store.push(new Float32Array(16).fill(1), 0);
  store.clear();
  assert(store.length === 0, "clear length");
  assert(Number.isNaN(store.latest[0]), "clear latest NaN");
  store.push(new Float32Array(16).fill(2), 0);
  assert(store.latest[0] === 2, "push after clear");
}

/* ---------- channels meta ---------- */
console.log("\n[channels]");

{
  assert(DEFAULT_CHANNELS.length === CHANNEL_COUNT, `${CHANNEL_COUNT} default channels`);
  assert(DEFAULT_CHANNELS[26].name === "vbus_fast", "ch26 default name");
  assert(DEFAULT_CHANNELS.filter((c) => c.visible).length >= 3, "some channels visible by default");
}

/* ---------- CSV shape ---------- */
console.log("\n[csv shape]");

{
  const store = new TelemetryStore(16, 20);
  for (let i = 0; i < 5; i++) store.push(new Float32Array(16).fill(i), i);
  const rows = [];
  for (let i = 0; i < store.length; i++) {
    const s = store.sampleAt(i);
    rows.push([(s.sampleIndex / 1000).toFixed(6), ...Array.from(s.values, (v) => v.toFixed(6))].join(","));
  }
  assert(rows.length === 5, "csv rows");
  assert(rows[0].split(",").length === 17, "csv cols = 1+16");
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
