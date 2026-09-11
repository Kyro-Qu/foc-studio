/**
 * 端到端链路集成测试：模拟固件混流 → decoder → store → 统计
 * 运行: node tests/integration.mjs
 */

import { JustFloatDecoder, JUSTFLOAT_FRAME_SIZE } from "../js/protocol/justfloat.js";
import { TelemetryStore } from "../js/data/telemetry-store.js";
import { TelemetryAdapter } from "../js/protocol/protocol.js";

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log(`  PASS  ${msg}`);
  else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

function makeFrame(idx) {
  const buf = new Uint8Array(JUSTFLOAT_FRAME_SIZE);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 16; i++) dv.setFloat32(i * 4, idx + i * 0.01, true);
  buf[64] = 0;
  buf[65] = 0;
  buf[66] = 0x80;
  buf[67] = 0x7f;
  return buf;
}

/** 模拟 status 多行：文本块之间夹 JustFloat 帧 */
function buildStatusLikeStream(nFrames) {
  const chunks = [];
  const enc = new TextEncoder();
  // 连接后先来几帧遥测
  for (let i = 0; i < 5; i++) chunks.push(makeFrame(i));
  // 用户发 status，固件逐行打印，行间遥测恢复
  const lines = [
    "M0 RUN mode=vel\r\n",
    "tgt=100.000\r\n",
    "vel=1820.0rpm\r\n",
    "id=0.010A iq=1.820A\r\n",
    "vbus=14.20V\r\n",
    "fault=0\r\n",
  ];
  let fi = 100;
  for (const line of lines) {
    chunks.push(enc.encode(line));
    chunks.push(makeFrame(fi++));
    chunks.push(makeFrame(fi++));
  }
  // 之后稳定遥测
  for (let i = 0; i < nFrames; i++) chunks.push(makeFrame(1000 + i));
  return chunks;
}

console.log("\n[integration: status interleaved with JustFloat]");

{
  const store = new TelemetryStore(16, 5000);
  const texts = [];
  const decoder = new JustFloatDecoder({ channels: 16 });
  const adapter = new TelemetryAdapter({
    onSample: ({ values, sampleIndex }) => store.push(values, sampleIndex),
    onText: (t) => texts.push(t),
  });
  adapter.attach(decoder);

  const chunks = buildStatusLikeStream(50);
  // 模拟 Web Serial 不定长分包
  for (const c of chunks) {
    let off = 0;
    while (off < c.length) {
      const n = Math.min(c.length - off, 1 + ((off * 17 + c.length) % 40));
      adapter.feed(c.subarray(off, off + n));
      off += n;
    }
  }

  const text = texts.join("");
  assert(text.includes("M0 RUN mode=vel"), "status line1 extracted");
  assert(text.includes("vel=1820.0rpm"), "status line3 extracted");
  assert(text.includes("fault=0"), "status last line extracted");
  // 5 + 6*2 + 50 = 67 帧
  assert(store.framesTotal === 67, `frame count 67 got ${store.framesTotal}`);
  assert(decoder.desync === 0 || decoder.desync < 3, `low desync got ${decoder.desync}`);
  assert(decoder.locked === true || store.framesTotal > 60, "pipeline recovered to locked/stable");
  const last = store.latest;
  assert(Math.abs(last[0] - (1000 + 49)) < 1e-3, `last ch0 ≈ 1049 got ${last[0]}`);
}

console.log("\n[integration: throughput 5000 frames]");

{
  const store = new TelemetryStore(16, 10000);
  const decoder = new JustFloatDecoder({});
  const adapter = new TelemetryAdapter({
    onSample: ({ values, sampleIndex }) => store.push(values, sampleIndex),
  });
  adapter.attach(decoder);

  const t0 = performance.now();
  const N = 5000;
  const batch = new Uint8Array(N * JUSTFLOAT_FRAME_SIZE);
  for (let i = 0; i < N; i++) batch.set(makeFrame(i), i * JUSTFLOAT_FRAME_SIZE);
  // 一次灌入（最坏情况）
  adapter.feed(batch);
  const ms = performance.now() - t0;
  assert(store.framesTotal === N, `all ${N} frames`);
  assert(ms < 500, `decode+store ${N} frames in ${ms.toFixed(1)}ms`);
  console.log(`  info  ${N} frames / ${ms.toFixed(1)} ms = ${(N / (ms / 1000)).toFixed(0)} fps decode`);
}

console.log("\n[integration: peaks downsample]");

{
  const store = new TelemetryStore(16, 30000);
  for (let i = 0; i < 5000; i++) {
    const v = new Float32Array(16);
    v[1] = Math.sin(i / 30) * 5 + (i === 2500 ? 20 : 0); // 尖峰
    store.push(v, i);
  }
  const p = store.getSeriesPeaks(1, 5000, 200);
  let mx = -Infinity;
  for (let i = 0; i < p.n; i++) mx = Math.max(mx, p.maxY[i]);
  assert(mx > 19, `spike preserved in peaks max=${mx}`);
}

console.log(`\nIntegration result: ${failed ? failed + " failed" : "all ok"}\n`);
process.exit(failed ? 1 : 0);
