/**
 * Layout audit: screenshots + spacing measurements for foc-studio UI.
 * Run: node tests/layout-audit.mjs
 * Expects local server at http://127.0.0.1:8765/
 */
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const BASE = process.env.FOC_STUDIO_URL || "http://127.0.0.1:8765/";
const OUT = path.resolve("output/playwright/audit");
fs.mkdirSync(OUT, { recursive: true });

const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.CHROME_PATH,
].filter(Boolean);

const executablePath = chromePaths.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error("Chrome not found");
  process.exit(2);
}

const issues = [];

function note(msg) {
  issues.push(msg);
  console.log("ISSUE", msg);
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(500);

async function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", file);
}

async function measureRow(sel, label) {
  const data = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const kids = [...el.children].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        cls: c.className?.toString?.().slice(0, 40) || c.tagName,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: (c.textContent || "").trim().slice(0, 24),
      };
    });
    // pairwise gaps for same-row kids
    const sameY = kids.filter((k) => Math.abs(k.y - kids[0]?.y) < 4);
    const gaps = [];
    for (let i = 1; i < sameY.length; i++) {
      const prev = sameY[i - 1];
      const cur = sameY[i];
      gaps.push({ between: `${prev.text || prev.cls} → ${cur.text || cur.cls}`, gap: cur.x - (prev.x + prev.w) });
    }
    const r = el.getBoundingClientRect();
    return {
      sel: s,
      wrap: cs.flexWrap,
      gap: cs.gap,
      overflowX: cs.overflowX,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      height: Math.round(r.height),
      kids,
      gaps,
      crowded: gaps.filter((g) => g.gap < 6),
    };
  }, sel);

  if (!data) {
    note(`${label}: selector missing ${sel}`);
    return null;
  }
  console.log(JSON.stringify({ label, ...data }, null, 2));
  if (data.scrollW > data.clientW + 2) {
    note(`${label}: horizontal overflow scrollW=${data.scrollW} clientW=${data.clientW}`);
  }
  if (data.crowded?.length) {
    for (const c of data.crowded) {
      note(`${label}: crowded gap ${c.gap}px between ${c.between}`);
    }
  }
  if (data.wrap && data.wrap.includes("nowrap") && data.kids.length > 4 && data.scrollW > data.clientW - 4) {
    note(`${label}: nowrap + tight width`);
  }
  return data;
}

async function openNav(step) {
  const btn = page.locator(`nav .nav-btn[data-step="${step}"]`);
  if (await btn.count()) {
    await btn.click();
  } else {
    const alt = page.locator(`nav .nav-btn[data-panel="${step}"]`);
    if (await alt.count()) await alt.click();
  }
  await page.waitForTimeout(350);
}

// --- Console / dashboard ---
await openNav("run");
await shot("01-console-run");
await measureRow(".dash-target-main", "dashboard target main");
await measureRow("#dash-presets", "dashboard presets");
await measureRow(".dash-ctrl-actions", "dashboard actions");
await measureRow(".dash-mode-row", "dashboard mode row");

// pos mode more presets
await page.selectOption("#dash-mode", "pos");
await page.waitForTimeout(200);
await shot("02-console-pos");
await measureRow("#dash-presets", "dashboard presets pos");

// --- Scope ---
await openNav("scope");
await shot("03-scope");
await measureRow("#scope-topbar", "scope topbar");
// open control bar
const ctl = page.locator("#scope-fab-toggle");
if (await ctl.count()) {
  await ctl.click();
  await page.waitForTimeout(250);
  await shot("04-scope-ctrlbar");
  await measureRow("#scope-fab-panel", "scope control bar");
  await measureRow("#scope-fab-panel .scope-drawer-row", "scope control row");
  await ctl.click();
  await page.waitForTimeout(150);
}
const settings = page.locator("#btn-scope-settings");
if (await settings.count()) {
  await settings.click();
  await page.waitForTimeout(250);
  await shot("05-scope-drawer");
  await measureRow("#scope-drawer .scope-drawer-inner", "scope drawer inner");
  const yrow = page.locator("#scope-drawer .scope-drawer-col").first();
  if (await yrow.count()) {
    const yd = await yrow.evaluate((el) => {
      const kids = [...el.querySelectorAll(".scope-drawer-row > *, .scope-drawer-title")].map((c) => {
        const r = c.getBoundingClientRect();
        return { t: (c.textContent || "").trim().slice(0, 20), x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y) };
      });
      const gaps = [];
      for (let i = 1; i < kids.length; i++) {
        if (Math.abs(kids[i].y - kids[0].y) < 4) gaps.push({ a: kids[i - 1].t, b: kids[i].t, gap: kids[i].x - (kids[i - 1].x + kids[i - 1].w) });
      }
      return { kids, gaps };
    });
    console.log("drawer-y-col", JSON.stringify(yd, null, 2));
    for (const g of yd.gaps || []) {
      if (g.gap < 8) note(`drawer Y col crowded: ${g.a} → ${g.b} gap=${g.gap}`);
    }
  }
}

// --- Encoder ---
await openNav("encoder");
await shot("06-encoder");
await measureRow("#enc-panel-inc .wf-card-actions", "encoder ABZ actions");
const formRow = page.locator("#enc-panel-inc .form-row").first();
if (await formRow.count()) {
  const fr = await formRow.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const kids = [...el.children].map((c) => {
      const b = c.getBoundingClientRect();
      return { t: (c.textContent || "").trim().slice(0, 30), x: Math.round(b.x), w: Math.round(b.width) };
    });
    return { h: Math.round(r.height), kids };
  });
  console.log("encoder form-row", JSON.stringify(fr, null, 2));
}

// --- Motor ---
await openNav("motor");
await shot("07-motor");
await measureRow("#panel-wf .wf-card .wf-card-actions", "motor card actions (first)");

// --- Tuning ---
const pid = page.locator('nav .nav-btn[data-step="pid"]');
if (await pid.count()) {
  await pid.click();
  await page.waitForTimeout(350);
  await shot("08-pid");
}

// --- Expert ---
await openNav("expert");
await shot("09-expert");

// --- Terminal ---
await openNav("terminal");
await shot("10-terminal");

console.log("\n==== SUMMARY ====");
console.log(`issues=${issues.length}`);
for (const i of issues) console.log("-", i);

await browser.close();
process.exit(issues.length ? 1 : 0);
