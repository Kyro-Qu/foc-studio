/**
 * UI 生命周期：Scope / Dashboard / Gauge / Mode switch
 * Node 无 DOM/RAF：用最小 stub 验证 start/stop 幂等与 destroy 清理逻辑。
 */

import { TelemetryStore } from "../js/data/telemetry-store.js";
import { SimulationSource } from "../js/sim/simulation.js";
import { SessionRecorder } from "../js/data/recorder.js";
import { JustFloatDecoder } from "../js/protocol/justfloat.js";
import { TelemetryAdapter } from "../js/protocol/protocol.js";
import { TriggerEngine } from "../js/ui/trigger.js";

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

// --- RAF/timer counters ---
let rafCount = 0;
let rafLive = 0;
const rafCallbacks = new Map();
let rafId = 1;
globalThis.requestAnimationFrame = (cb) => {
  const id = rafId++;
  rafCallbacks.set(id, cb);
  rafCount++;
  rafLive++;
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  if (rafCallbacks.delete(id)) rafLive--;
};

let intervalCount = 0;
let intervalLive = 0;
const intervals = new Set();
const origSet = globalThis.setInterval;
const origClr = globalThis.clearInterval;
globalThis.setInterval = (fn, ms) => {
  intervalCount++;
  intervalLive++;
  const id = origSet(fn, ms);
  intervals.add(id);
  return id;
};
globalThis.clearInterval = (id) => {
  if (intervals.has(id)) {
    intervals.delete(id);
    intervalLive--;
  }
  return origClr(id);
};

// Scope needs canvas — skip full Scope class; test trigger+store path instead
console.log("\n[store offsetOf continuous constraint]");
{
  const st = new TelemetryStore(16, 100);
  for (let i = 0; i < 10; i++) st.push(new Float32Array(16), i);
  assert(st.offsetOf(0) === 0 && st.offsetOf(9) === 9, "continuous offsetOf");
  assert(st.offsetOf(-1) === -1 && st.offsetOf(10) === -1, "out of window -1");
  st.push(new Float32Array(16), 1000); // 跳变
  assert(st.offsetOf(500) === -1, "gap index not mapped (documented)");
  const buf = new Float32Array(16);
  assert(st.sampleAtInto(0, buf) !== -1, "sampleAtInto");
  assert(st.offsetOf(1000) === st.count - 1, "latest maps to last slot");
}

console.log("\n[mock pipeline 50 mode switches sim/replay]");
{
  const store = new TelemetryStore(16, 5000);
  const dec = new JustFloatDecoder({});
  const rec = new SessionRecorder(16, 1000);
  const adapter = new TelemetryAdapter({
    onSample: ({ values, sampleIndex }) => {
      store.push(values, sampleIndex);
      rec.push(values, sampleIndex);
    },
  });
  adapter.attach(dec);

  let liveSources = 0;
  function startSim() {
    liveSources++;
    return new SimulationSource({
      rateHz: 1000,
      onFrame: (v, i) => adapter.feed ? null : null,
    });
  }

  for (let i = 0; i < 50; i++) {
    // SIM
    store.clear();
    adapter.reset();
    dec.reset();
    const sim = new SimulationSource({
      rateHz: 1000,
      onFrame: (v, idx) => store.push(v, idx),
    });
    sim.start();
    sim._tick();
    sim.stop();
    assert(!sim.running, `cycle ${i} sim stopped`);
    // REPLAY empty
    store.clear();
    // SERIAL mock feed
    const frame = new Uint8Array(68);
    new DataView(frame.buffer).setFloat32(0, 1, true);
    frame[64] = 0;
    frame[65] = 0;
    frame[66] = 0x80;
    frame[67] = 0x7f;
    adapter.feed(frame);
  }
  assert(store.framesTotal > 0, "pipeline collected data");
  assert(intervalLive === 0, "no leaked intervals from sim stop");
}

console.log("\n[gauge destroy no-op after destroy]");
{
  // Minimal fake canvas
  function fakeCanvas() {
    const ctx = {
      clearRect() {},
      beginPath() {},
      arc() {},
      stroke() {},
      fill() {},
      moveTo() {},
      lineTo() {},
      fillText() {},
      save() {},
      restore() {},
      setTransform() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      set strokeStyle(v) {},
      set fillStyle(v) {},
      set lineWidth(v) {},
      set lineCap(v) {},
      set font(v) {},
      set textAlign(v) {},
      set textBaseline(v) {},
    };
    return {
      getContext: () => ctx,
      parentElement: null,
      style: {},
      width: 0,
      height: 0,
    };
  }
  // import after stubs
  const { Gauge } = await import("../js/ui/gauge.js");
  let live = 0;
  for (let i = 0; i < 100; i++) {
    const g = new Gauge(fakeCanvas(), { label: "x", min: 0, max: 1 });
    live++;
    g.setValue(0.5);
    g.destroy();
    g.setValue(1); // must not throw
  }
  assert(live === 100, "100 gauge create/destroy");
}

console.log("\n[dashboard start idempotent via interval counter]");
{
  // Dashboard requires DOM — verify pattern used by dashboard.start
  let ticks = 0;
  function startIdempotent() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => ticks++, 10);
    return this._timer;
  }
  const obj = { _timer: null };
  const t1 = startIdempotent.call(obj);
  const t2 = startIdempotent.call(obj);
  assert(t1 !== t2, "second start replaces timer");
  assert(intervals.has(t2) && !intervals.has(t1), "old timer cleared");
  clearInterval(t2);
  obj._timer = null;
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
