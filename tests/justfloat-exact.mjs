/**
 * JustFloat：exact / chunk / mixed CLI / fake tail / seeded fuzz
 */

import { JustFloatDecoder, JUSTFLOAT_FRAME_SIZE } from "../js/protocol/justfloat.js";

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

/** mulberry32 */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log("\n[A exact N frames]");
{
  const N = 64;
  let ok = 0;
  const dec = new JustFloatDecoder({ onFrame: () => ok++ });
  for (let i = 0; i < N; i++) dec.push(makeFrame(i));
  assert(ok === N, `exact ${ok}===${N}`);
  assert(dec.framesOk === N, "framesOk");
  assert(dec.desync === 0, "desync 0");
}

console.log("\n[B fixed chunk sizes]");
{
  for (const size of [1, 2, 3, 17, 67, 68, 69, 128]) {
    let ok = 0;
    const dec = new JustFloatDecoder({ onFrame: () => ok++ });
    const N = 20;
    const blob = new Uint8Array(N * JUSTFLOAT_FRAME_SIZE);
    for (let i = 0; i < N; i++) blob.set(makeFrame(i), i * JUSTFLOAT_FRAME_SIZE);
    for (let p = 0; p < blob.length; p += size) {
      dec.push(blob.subarray(p, Math.min(blob.length, p + size)));
    }
    assert(ok === N, `chunk ${size}px → ${ok}/${N}`);
  }
}

console.log("\n[C mixed CLI]");
{
  let ok = 0;
  const texts = [];
  const dec = new JustFloatDecoder({
    onFrame: () => ok++,
    onText: (t) => texts.push(t),
  });
  const enc = new TextEncoder();
  const parts = [];
  for (let i = 0; i < 30; i++) {
    parts.push(makeFrame(i));
    if (i % 5 === 0) parts.push(enc.encode("status\r\n"));
    if (i % 7 === 0) parts.push(enc.encode("help\r\nM0 RUN\r\nvel=1\r\n"));
    if (i % 11 === 0) {
      const g = new Uint8Array(40);
      g.fill(0x5a);
      parts.push(g);
    }
  }
  const blob = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
  let off = 0;
  for (const a of parts) {
    blob.set(a, off);
    off += a.length;
  }
  let p = 0;
  while (p < blob.length) {
    const n = 1 + Math.floor(p % 50);
    dec.push(blob.subarray(p, Math.min(blob.length, p + n)));
    p += n;
  }
  assert(ok === 30, `mixed frames ${ok}===30`);
  assert(texts.join("").includes("status"), "CLI text recovered");
}

console.log("\n[D fake tail in payload]");
{
  let ok = 0;
  const dec = new JustFloatDecoder({ onFrame: () => ok++ });
  // 先锁定
  for (let i = 0; i < 5; i++) dec.push(makeFrame(i));
  const lockedOk = ok;
  const f = makeFrame(9);
  // 把 ch2 写成 +Inf（字节即 tail）
  new DataView(f.buffer, f.byteOffset).setFloat32(8, Infinity, true);
  dec.push(f);
  for (let i = 0; i < 5; i++) dec.push(makeFrame(10 + i));
  assert(ok === lockedOk + 6, `Inf-in-payload locked stream ${ok}`);
  // 独立假 tail
  dec.push(new Uint8Array([0, 0, 0x80, 0x7f]));
  dec.push(makeFrame(100));
  assert(ok === lockedOk + 7, `after standalone fake tail ${ok}`);
}

console.log("\n[E seeded fuzz]");
{
  const rand = prng(0xc0ffee);
  let ok = 0;
  const dec = new JustFloatDecoder({ onFrame: () => ok++ });
  const N = 100;
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push(makeFrame(i));
    if (rand() < 0.15) parts.push(new TextEncoder().encode("fault\r\n"));
    if (rand() < 0.1) {
      const g = new Uint8Array(1 + Math.floor(rand() * 30));
      for (let k = 0; k < g.length; k++) g[k] = Math.floor(rand() * 256);
      parts.push(g);
    }
  }
  const blob = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
  let off = 0;
  for (const a of parts) {
    blob.set(a, off);
    off += a.length;
  }
  let p = 0;
  while (p < blob.length) {
    const n = 1 + Math.floor(rand() * 80);
    dec.push(blob.subarray(p, Math.min(blob.length, p + n)));
    p += n;
  }
  // 垃圾可导致少量丢帧，但应接近 N
  assert(ok >= N - 5, `seeded fuzz ok=${ok} expected~${N}`);
  assert(ok <= N, `no over-decode ${ok}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
