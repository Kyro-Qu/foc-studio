import { t, getLang, setLang } from "../js/i18n.js";

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

console.log("\n[i18n]");
assert(typeof getLang() === "string", `lang=${getLang()}`);
setLang("zh");
assert(t("nav.dashboard") === "仪表盘", `zh: ${t("nav.dashboard")}`);
assert(t("nav.scope") === "示波器", "zh scope");
setLang("en");
assert(t("nav.dashboard") === "Dashboard", `en: ${t("nav.dashboard")}`);
assert(t("sys.sim", { rate: 5000 }).includes("5000"), "interp");
setLang("zh");

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
