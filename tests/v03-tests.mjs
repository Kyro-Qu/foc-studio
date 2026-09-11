/**
 * v0.3 fault 解码（与 foc_types.h / current_shunt.h 对齐）
 */

import { decodeFault, faultText, MOTOR_FAULTS, SENSE_FAULTS } from "../js/ui/fault.js";
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

console.log("\n[fault decode — real enums]");
{
  assert(MOTOR_FAULTS[3] === "RUN_OVERCURRENT", "motor 3 RUN_OVERCURRENT");
  assert(MOTOR_FAULTS[11] === "UNDERVOLTAGE", "motor 11 UNDERVOLTAGE");
  assert(SENSE_FAULTS[15] === "QUEUE_OVERFLOW", "sense 15 QUEUE_OVERFLOW");
  assert(decodeFault(0).ok, "0 ok");
  // motor=3, sense=5 → 305
  const d = decodeFault(305);
  assert(d.motor === 3 && d.sense === 5, "305 split");
  assert(d.motorName === "RUN_OVERCURRENT" && d.senseName === "ADC2_CALIBRATION", "names");
  const unk = decodeFault(9999);
  assert(unk.motorName.startsWith("M") || unk.senseName.startsWith("S"), "unknown keeps number form");
  assert(faultText(0) === "OK", "text OK");
  assert(faultText(305).includes("RUN_OVERCURRENT"), "text has name");
}

console.log("\n[tuning]");
{
  assert(TUNING_PARAMS.every((p) => p.cmdPrefix && p.min < p.max), "params valid");
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
