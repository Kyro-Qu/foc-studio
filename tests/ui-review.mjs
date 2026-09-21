import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const OUT = path.resolve("output/playwright/review");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

const findings = [];
function note(x) {
  findings.push(x);
  console.log("NOTE", x);
}

async function open(step) {
  const btn = page.locator(`nav .nav-btn[data-step="${step}"]`).first();
  if (await btn.count()) await btn.click();
  else await page.locator(`nav .nav-btn[data-panel="${step}"]`).first().click();
  await page.waitForTimeout(400);
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("shot", name);
}

// PID / tuning wizard page
await open("pid");
await shot("pid");
const pidInfo = await page.evaluate(() => {
  const sections = [...document.querySelectorAll("#panel-wf .wf-section")].map((s) => ({
    text: s.textContent.trim().slice(0, 40),
    hasIco: !!s.querySelector(".wf-ico"),
  }));
  const rawKeys = [...document.querySelectorAll("#panel-wf *")]
    .map((el) => (el.childElementCount === 0 ? el.textContent.trim() : ""))
    .filter((t) => t && /^[a-z][a-z0-9_.]+\.[a-z0-9_.]+$/i.test(t));
  const formLbls = [...document.querySelectorAll("#panel-wf .form-lbl")].length;
  const formRows = [...document.querySelectorAll("#panel-wf .form-row")].length;
  const rowsNoIco = [...document.querySelectorAll("#panel-wf .form-row")].filter(
    (r) => r.querySelector("label") && !r.querySelector(".wf-ico")
  ).map((r) => r.textContent.trim().slice(0, 30));
  return { sections, rawKeys, formLbls, formRows, rowsNoIco };
});
console.log("PID", JSON.stringify(pidInfo, null, 2));
for (const s of pidInfo.sections) if (!s.hasIco) note(`PID section without icon: ${s.text}`);
for (const k of pidInfo.rawKeys) note(`raw i18n key visible: ${k}`);
if (pidInfo.rowsNoIco.length) note(`PID form rows without icons (${pidInfo.rowsNoIco.length}): ${pidInfo.rowsNoIco.slice(0, 8).join(" | ")}`);

// Expert
await open("expert");
await shot("expert");
const exp = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("#panel-expert .wf-section")].map((s) => ({
    t: s.textContent.trim().slice(0, 36),
    ico: !!s.querySelector(".wf-ico"),
  }));
  const raw = [...document.querySelectorAll("#panel-expert *")]
    .filter((el) => el.childElementCount === 0)
    .map((el) => el.textContent.trim())
    .filter((t) => /^[a-z][a-z0-9_.]+$/i.test(t) && t.includes("."));
  return { heads, raw };
});
console.log("EXPERT", JSON.stringify(exp, null, 2));
for (const h of exp.heads) if (!h.ico) note(`Expert section without icon: ${h.t}`);
for (const k of exp.raw) note(`expert raw key: ${k}`);

// Console / run dashboard chips
await open("run");
await shot("console");
const run = await page.evaluate(() => {
  const chips = [...document.querySelectorAll(".dash-chips .chip")].map((c) => c.textContent.trim());
  const groups = [...document.querySelectorAll(".dash-ctrl .wf-section, .dash-group-title")].map((s) => s.textContent.trim());
  return { chips, groups };
});
console.log("RUN", JSON.stringify(run));

// Terminal
await open("terminal");
await shot("terminal");

// Encoder full
await open("encoder");
await shot("encoder");
const enc = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("#panel-wf .wf-section")].map((s) => ({
    t: s.textContent.trim().slice(0, 40),
    ico: !!s.querySelector(".wf-ico"),
  }));
  return heads;
});
console.log("ENC heads", JSON.stringify(enc, null, 2));
for (const h of enc) if (!h.ico) note(`Encoder section without icon: ${h.t}`);

// Footer / header consistency
await page.evaluate(() => window.scrollTo(0, 0));
const chromeInfo = await page.evaluate(() => {
  const hud = [...document.querySelectorAll(".tb-hud-item")].map((el) => el.textContent.trim());
  const footer = document.querySelector("footer")?.innerText?.slice(0, 200);
  return { hud, footer };
});
console.log("CHROME", JSON.stringify(chromeInfo));

console.log("\n==== FINDINGS", findings.length, "====");
for (const f of findings) console.log("-", f);
await browser.close();
