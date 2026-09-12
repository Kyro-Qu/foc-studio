import { channelLabel, CHANNEL_LABELS, DEFAULT_CHANNELS } from "../js/channels.js";

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
assert(channelLabel(26, "zh") === "实时母线电压", `zh vbus_fast=${channelLabel(26, "zh")}`);
assert(channelLabel(26, "en") === "VBUS_FAST", `en vbus_fast=${channelLabel(26, "en")}`);
assert(channelLabel(2, "zh") === "控制转速", "zh rpm");
assert(channelLabel(2, "en") === "VEL_CTRL", "en rpm");
assert(channelLabel(1, "zh") === "Iq 原始", "iq raw zh");
assert(DEFAULT_CHANNELS.length === 32, "32 ch");

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
