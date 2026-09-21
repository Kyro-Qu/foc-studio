import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const OUT = path.resolve("output/playwright/icons");
fs.mkdirSync(OUT, { recursive: true });
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

async function open(step) {
  await page.locator(`nav .nav-btn[data-step="${step}"]`).first().click();
  await page.waitForTimeout(400);
}

async function countIcons(sel) {
  return page.locator(`${sel} .wf-ico`).count();
}

await open("device");
await page.screenshot({ path: path.join(OUT, "device.png") });
console.log("device section icons", await countIcons("#panel-wf .wf-section"));
console.log("device form icons", await countIcons("#panel-wf .form-lbl"));
console.log("device board tile icons", await countIcons("#wf-board-info .wf-ico, #wf-board-info svg"));

await open("motor");
await page.screenshot({ path: path.join(OUT, "motor.png") });
console.log("motor section icons", await countIcons("#panel-wf .wf-section"));
console.log("motor form icons", await countIcons("#panel-wf .form-lbl"));

await open("encoder");
await page.screenshot({ path: path.join(OUT, "encoder.png") });
console.log("encoder section icons", await countIcons("#panel-wf .wf-section"));

// measure form label gaps
const gaps = await page.evaluate(() => {
  // back to motor via clicking is hard; measure from current encoder + generic form-lbl
  return [...document.querySelectorAll(".form-lbl")].slice(0, 8).map((el) => {
    const r = el.getBoundingClientRect();
    return { t: el.textContent.trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) };
  });
});
console.log("form-lbl sample", gaps);

await browser.close();
console.log("shots in", OUT);
