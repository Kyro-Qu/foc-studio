/**
 * v0.3：fault 解码、tuning CLI 映射
 */

import { decodeFault, faultText } from "../js/ui/fault.js";
import { TUNING_PARAMS } from "../js/ui/tuning.js";

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

console.log("\n[fault decode]");
{
  assert(decodeFault(0).ok, "0 is ok");
  assert(decodeFault(NaN).ok, "NaN is ok");
  const d = decodeFault(100); // motor bit0
  assert(!d.ok && d.motor === 1 && d.names.includes("OVERCURRENT"), "100 → OVERCURRENT");
  const d2 = decodeFault(203); // motor 2 + sense 3
  assert(d2.motor === 2 && d2.sense === 3, "203 split");
  assert(faultText(0) === "OK", "text OK");
}

console.log("\n[tuning params]");
{
  assert(TUNING_PARAMS.length >= 6, "has params");
  assert(TUNING_PARAMS.every((p) => p.cmdPrefix && p.min < p.max), "cmd/range valid");
  const kp = TUNING_PARAMS.find((p) => p.id === "vel_kp");
  assert(kp.cmdPrefix === "vel kp", "vel kp CLI");
  const bw = TUNING_PARAMS.find((p) => p.id === "current_bw");
  assert(bw.cmdPrefix === "current bw", "current bw CLI");
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
