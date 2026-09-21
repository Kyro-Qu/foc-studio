import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const OUT = path.resolve("output/playwright/polish");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

const notes = [];
function note(s) {
  notes.push(s);
  console.log("NOTE", s);
}

async function open(step) {
  const b = page.locator(`nav .nav-btn[data-step="${step}"]`).first();
  if (await b.count()) await b.click();
  else await page.locator(`nav .nav-btn[data-panel="${step}"]`).first().click();
  await page.waitForTimeout(400);
}

// header HUD
const hud = await page.evaluate(() => {
  return [...document.querySelectorAll(".tb-hud-item")].map((el) => ({
    text: el.textContent.replace(/\s+/g, " ").trim(),
    hasIco: !!el.querySelector(".tb-hud-ico"),
  }));
});
console.log("HUD", hud);
for (const h of hud) if (!h.hasIco) note(`HUD missing icon: ${h.text}`);

await open("expert");
await page.screenshot({ path: path.join(OUT, "expert.png") });
const expBtns = await page.evaluate(() => {
  return [...document.querySelectorAll("#panel-expert button")].map((b) => ({
    t: b.textContent.replace(/\s+/g, " ").trim().slice(0, 24),
    ico: !!b.querySelector("svg"),
  }));
});
console.log("expert buttons", expBtns);
for (const b of expBtns) if (!b.ico) note(`expert btn no icon: ${b.t}`);

await open("run");
await page.screenshot({ path: path.join(OUT, "console.png") });
const group = await page.evaluate(() => {
  const t = document.querySelector(".dash-group-title");
  return t ? { text: t.textContent.trim(), ico: !!t.querySelector(".wf-ico") } : null;
});
console.log("dash group", group);
if (group && !group.ico) note("console group title missing icon");

await open("terminal");
await page.screenshot({ path: path.join(OUT, "terminal.png") });
const term = await page.evaluate(() => {
  const t = document.querySelector("#panel-terminal .panel-title");
  return t ? { text: t.textContent.trim(), ico: !!t.querySelector("svg") } : null;
});
console.log("terminal title", term);
if (term && !term.ico) note("terminal title missing icon");

console.log("\n====", notes.length, "notes ====");
for (const n of notes) console.log("-", n);
await browser.close();
