/**
 * 触发冻结数据窗回归：冻结后 peaks 必须来自触发区间，而非 live last-n
 */

import { TelemetryStore } from "../js/data/telemetry-store.js";
import { TriggerEngine, TriggerMode } from "../js/ui/trigger.js";

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

console.log("\n[trigger freeze data window]");

const store = new TelemetryStore(16, 10000);
const trig = new TriggerEngine();
trig.configure({ mode: TriggerMode.NORMAL, source: 1, edge: "rising", level: 10, windowPoints: 200 });
trig.arm();

// ch1: 0 for 100 samples, then step to 50 (trigger), then ramp
for (let i = 0; i < 100; i++) {
  const v = new Float32Array(16);
  v[1] = 0;
  v[2] = i; // marker channel
  store.push(v, i);
  trig.push(v, i);
}
assert(!trig.frozen, "not frozen before edge");

{
  const v = new Float32Array(16);
  v[1] = 50;
  v[2] = 100;
  store.push(v, 100);
  const fired = trig.push(v, 100);
  assert(fired && trig.frozen, "frozen at sample 100");
}

// Post-window may include values up to endIdx (~260).
// Values only appear after endIdx must be excluded from frozen peaks.
for (let i = 101; i < 300; i++) {
  const v = new Float32Array(16);
  v[1] = i <= 260 ? 20 : 999;
  v[2] = i;
  store.push(v, i);
}

const vw = trig.viewWindow(200, store.latestIndex);
assert(vw && vw.triggerIndex === 100, "viewWindow trigger 100");
assert(vw.endIdx <= store.latestIndex, "endIdx clamped");
assert(vw.endIdx < 290, `endIdx=${vw.endIdx} near post window`);

const peaks = store.getSeriesPeaksByRange(1, vw.startIdx, vw.endIdx, 40);
let maxV = -Infinity;
for (let i = 0; i < peaks.n; i++) maxV = Math.max(maxV, peaks.maxY[i]);
assert(maxV < 999, `frozen peaks exclude beyond-window 999 (max=${maxV})`);
assert(maxV >= 50, `frozen peaks include trigger edge (max=${maxV})`);

const live = store.getSeriesPeaks(1, 300, 40);
let liveMax = -Infinity;
for (let i = 0; i < live.n; i++) liveMax = Math.max(liveMax, live.maxY[i]);
assert(liveMax >= 999, `live last-n includes late 999 (max=${liveMax})`);

// viewWindow early trigger should not go wild negative without clamp to latest
const t2 = new TriggerEngine();
t2.configure({ mode: TriggerMode.NORMAL, source: 0, edge: "rising", level: 0, windowPoints: 1000 });
t2.arm();
const vv = new Float32Array(16);
vv[0] = 1;
t2.push(vv, 0); // fire at 0 immediately? need prev
// set prev
const v0 = new Float32Array(16);
v0[0] = -1;
t2.push(v0, 0);
t2.push(vv, 1);
const w2 = t2.viewWindow(1000, 5);
assert(w2 && w2.endIdx === 5, "endIdx follows latest when post would overflow");

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
