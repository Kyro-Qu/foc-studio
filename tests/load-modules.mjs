/**
 * 模块加载完整性：任一 import 语法错误会导致 main 整页瘫痪。
 * 运行: node tests/load-modules.mjs
 */

const mods = [
  "../js/channels.js",
  "../js/transport/serial.js",
  "../js/protocol/justfloat.js",
  "../js/protocol/protocol.js",
  "../js/data/telemetry-store.js",
  "../js/sim/simulation.js",
  "../js/data/recorder.js",
  "../js/ui/scope.js",
  "../js/ui/dashboard.js",
  "../js/ui/gauge.js",
  "../js/ui/terminal.js",
  "../js/ui/console.js",
  "../js/ui/math.js",
  "../js/ui/trigger.js",
  "../js/ui/measure.js",
  "../js/ui/fault.js",
  "../js/ui/legend.js",
  "../js/ui/tuning.js",
  "../js/i18n.js",
];

let failed = 0;
for (const m of mods) {
  try {
    await import(m);
    console.log(`  PASS  ${m}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${m}: ${e.message}`);
  }
}
console.log(failed ? `\n${failed} module(s) failed\n` : "\nall modules load\n");
process.exit(failed ? 1 : 0);
