/**
 * UI 打磨回归：measure last、AUTO rearm
 */

import { measureSeries } from "../js/ui/measure.js";
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

console.log("\n[measure last finite]");
{
  const m = measureSeries([1, 2, NaN, 3]);
  assert(m.last === 3, `last finite got ${m.last}`);
  assert(m.n === 3, "skips NaN in stats");
}

console.log("\n[trigger AUTO rearm]");
{
  const t = new TriggerEngine();
  t.autoTimeoutMs = 30;
  t.configure({ mode: TriggerMode.AUTO, source: 1, edge: "rising", level: 1 });
  t.arm();
  const v = new Float32Array(16);
  v[1] = 0;
  t.push(v, 0);
  v[1] = 5;
  const r = t.push(v, 1);
  assert(r === true && t.frozen, "fired");
  v[1] = 5;
  const r2 = t.push(v, 2);
  assert(r2 === false, "still frozen immediately");
  // wait
  const t0 = Date.now();
  while (Date.now() - t0 < 40) {
    /* spin */
  }
  const r3 = t.push(v, 3);
  assert(r3 === "auto-rearm" && !t.frozen && t.armed, "auto rearm after timeout");
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
