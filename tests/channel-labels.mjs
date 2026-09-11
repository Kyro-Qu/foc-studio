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
assert(channelLabel(15, "zh") === "母线电压", `zh vbus=${channelLabel(15, "zh")}`);
assert(channelLabel(15, "en") === "VBUS", `en vbus=${channelLabel(15, "en")}`);
assert(channelLabel(2, "zh") === "转速", "zh rpm");
assert(channelLabel(2, "en") === "RPM", "en rpm");
assert(CHANNEL_LABELS[13].zh === "故障码", "fault zh");
assert(DEFAULT_CHANNELS.length === 16, "16 ch");

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
