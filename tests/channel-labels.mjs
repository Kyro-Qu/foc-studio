import { channelLabel, CHANNEL_LABELS, DEFAULT_CHANNELS, formatValueCompact } from "../js/channels.js";

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

console.log("\n[channel labels]");
assert(channelLabel(26, "zh") === "母线电压", `zh vbus_fast=${channelLabel(26, "zh")}`);
assert(channelLabel(26, "en") === "VBUS", `en vbus_fast=${channelLabel(26, "en")}`);
assert(channelLabel(0, "zh") === "电角度", `zh theta_e=${channelLabel(0, "zh")}`);
assert(channelLabel(2, "zh") === "控制转速", "zh rpm");
assert(channelLabel(2, "en") === "VEL_CTRL", "en rpm");
assert(channelLabel(1, "zh") === "Iq 原始", "iq raw zh");
assert(DEFAULT_CHANNELS.length === 32, "32 ch");

assert(formatValueCompact(NaN) === "—", "compact NaN");
assert(formatValueCompact(0) === "0", "compact 0");
assert(formatValueCompact(24.1234) === "24.12", "compact 24.12");
assert(formatValueCompact(800.45) === "800.5", "compact 800.5");
assert(formatValueCompact(12500) === "12500", "compact 12500");
assert(formatValueCompact(0.3542) === "0.354", "compact 0.354");

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
