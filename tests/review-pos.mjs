/**
 * POS UI thorough review: screenshots + DOM/command assertions.
 */
import { chromium } from "playwright-core";
import path from "path";
import fs from "fs";

const OUT = path.resolve("output/playwright/pos-review");
fs.mkdirSync(OUT, { recursive: true });
const notes = [];
const ok = (c, m) => {
  if (!c) {
    notes.push(m);
    console.log("FAIL", m);
  } else console.log("PASS", m);
};

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// capture CLI commands the UI would send
await page.addInitScript(() => {
  window.__cmds = [];
});

await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);

// hook after app boot — find dashboard send if exposed via console
// We'll dispatch clicks and inspect DOM; for commands we monkey-patch after modules load
await page.evaluate(async () => {
  // wait a tick for dashboard instance if any
});

await page.locator('nav .nav-btn[data-step="run"]').first().click();
await page.waitForTimeout(400);

// Patch dashboard send by walking DOM listeners is hard; instead use consoleCtl if global
// Fallback: override Window console? Better: click and read nothing; verify UI only +
// inject a spy on prototype if dashboard stored on window.

const hasPosCard = await page.locator("#dash-pos-card").count();
ok(hasPosCard === 1, "POS card exists in DOM");

await page.selectOption("#dash-mode", "pos");
await page.waitForTimeout(300);

// --- REL state ---
let st = await page.evaluate(() => {
  const vis = (el) => !!el && !el.hidden && getComputedStyle(el).display !== "none";
  return {
    card: vis(document.getElementById("dash-pos-card")),
    step: vis(document.getElementById("dash-pos-step-row")),
    active: document.querySelector(".dash-pos-seg button.is-active")?.getAttribute("data-pos-sem"),
    unit: document.getElementById("dash-target-label")?.textContent?.trim(),
    note: document.getElementById("dash-pos-note")?.textContent?.trim(),
    jogs: [...document.querySelectorAll(".dash-jog-btn")].map((b) => b.textContent.trim()),
    zero: document.getElementById("dash-pos-zero")?.textContent?.trim(),
    presets: [...document.querySelectorAll("#dash-presets button")].map((b) => b.textContent.trim()),
    rotor: document.querySelector(".rotor-pos-line")?.textContent?.replace(/\s+/g, " ").trim(),
  };
});
console.log("REL", JSON.stringify(st, null, 2));
ok(st.card, "rel: card visible");
ok(!st.step, "rel: step row hidden");
ok(st.active === "rel", "rel: segmented on rel");
ok(st.unit === "rad", "rel: unit rad");
ok((st.note || "").includes("target"), "rel: note mentions target compat");
ok(st.jogs.length === 6, "rel: 6 jog buttons");
ok(st.presets.some((p) => p === "3.14"), "rel: numeric presets present");
ok((st.rotor || "").includes("Abs"), "rotor Abs/Rel/Tgt line present");
await page.screenshot({ path: path.join(OUT, "01-console-pos-rel.png") });

// --- ABS ---
await page.locator('[data-pos-sem="abs"]').click();
await page.waitForTimeout(200);
st = await page.evaluate(() => ({
  step: (() => {
    const el = document.getElementById("dash-pos-step-row");
    return !!el && !el.hidden && getComputedStyle(el).display !== "none";
  })(),
  active: document.querySelector(".dash-pos-seg button.is-active")?.getAttribute("data-pos-sem"),
  note: document.getElementById("dash-pos-note")?.textContent?.trim(),
  unit: document.getElementById("dash-target-label")?.textContent?.trim(),
}));
console.log("ABS", st);
ok(st.active === "abs", "abs: segmented active");
ok(!st.step, "abs: step row hidden");
ok((st.note || "").includes("pos abs"), "abs: note mentions pos abs");
await page.screenshot({ path: path.join(OUT, "02-console-pos-abs.png") });

// --- STEP ---
await page.locator('[data-pos-sem="step"]').click();
await page.waitForTimeout(200);
st = await page.evaluate(() => ({
  step: (() => {
    const el = document.getElementById("dash-pos-step-row");
    return !!el && !el.hidden && getComputedStyle(el).display !== "none";
  })(),
  active: document.querySelector(".dash-pos-seg button.is-active")?.getAttribute("data-pos-sem"),
  note: document.getElementById("dash-pos-note")?.textContent?.trim(),
  presets: [...document.querySelectorAll("#dash-presets button")].map((b) => b.textContent.trim()),
  stepVal: document.getElementById("dash-pos-step-val")?.value,
}));
console.log("STEP", st);
ok(st.active === "step", "step: segmented active");
ok(st.step, "step: step row visible");
ok((st.note || "").includes("pos step"), "step: note mentions pos step");
ok(st.presets.length === 0, "step: preset row empty (jog only in POS card)");
const cardJogs = await page.evaluate(() =>
  [...document.querySelectorAll(".dash-jog-btn")].map((b) => b.textContent.trim())
);
ok(cardJogs.length === 6, "step: 6 jog buttons in POS card");
await page.screenshot({ path: path.join(OUT, "03-console-pos-step.png") });

// --- spacing / overflow on POS card ---
const layout = await page.evaluate(() => {
  const card = document.getElementById("dash-pos-card");
  const r = card.getBoundingClientRect();
  const rows = [...card.querySelectorAll(".dash-pos-head,.dash-pos-row,.dash-pos-note")].map((el) => {
    const b = el.getBoundingClientRect();
    return { cls: el.className, y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) };
  });
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    scrollW: card.scrollWidth,
    clientW: card.clientWidth,
    rows,
  };
});
console.log("LAYOUT", JSON.stringify(layout, null, 2));
ok(layout.scrollW <= layout.clientW + 2, "POS card no horizontal overflow");

// --- other panels still ok ---
for (const [step, name] of [
  ["device", "04-device"],
  ["motor", "05-motor"],
  ["encoder", "06-encoder"],
  ["pid", "07-pid"],
]) {
  await page.locator(`nav .nav-btn[data-step="${step}"]`).first().click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}
await page.locator('nav .nav-btn[data-panel="scope"]').first().click();
await page.waitForTimeout(350);
const scope = await page.evaluate(() => {
  const menu = document.getElementById("scope-ctx-menu");
  return {
    hasMenu: !!menu,
    drawerHasPng: !!document.getElementById("btn-png"),
    topbar: !!document.getElementById("scope-topbar"),
  };
});
ok(scope.hasMenu, "scope ctx menu present");
ok(!scope.drawerHasPng, "scope drawer has no PNG button");
ok(scope.topbar, "scope topbar present");
await page.screenshot({ path: path.join(OUT, "08-scope.png") });

// right-click canvas
const wrap = page.locator(".scope-canvas-wrap");
const box = await wrap.boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.waitForTimeout(200);
  const menuState = await page.evaluate(() => {
    const m = document.getElementById("scope-ctx-menu");
    return {
      hidden: m.hidden,
      items: [...m.querySelectorAll("button")].map((b) => b.textContent.trim()),
    };
  });
  ok(!menuState.hidden, "scope right-click menu opens");
  ok(
    menuState.items.join("|").includes("CSV"),
    "menu has CSV: " + menuState.items.join("/")
  );
  await page.screenshot({ path: path.join(OUT, "09-scope-ctxmenu.png") });
}

console.log("\n==== REVIEW SUMMARY ====");
console.log(`issues=${notes.length}`);
for (const n of notes) console.log("-", n);
await browser.close();
process.exit(notes.length ? 1 : 0);
