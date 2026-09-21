import { chromium } from "playwright-core";
import path from "path";
import fs from "fs";
const OUT = path.resolve("output/playwright/pos");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.locator('nav .nav-btn[data-step="run"]').first().click();
await page.waitForTimeout(400);
await page.selectOption("#dash-mode", "pos");
await page.waitForTimeout(250);

const info = await page.evaluate(() => {
  const card = document.getElementById("dash-pos-card");
  const segs = [...document.querySelectorAll(".dash-pos-seg [data-pos-sem]")].map((b) => ({
    sem: b.getAttribute("data-pos-sem"),
    text: b.textContent.trim(),
    active: b.classList.contains("is-active"),
  }));
  const jogs = [...document.querySelectorAll(".dash-jog-btn")].map((b) => b.textContent.trim());
  return {
    cardHidden: card?.hidden,
    segs,
    jogs,
    zero: document.getElementById("dash-pos-zero")?.textContent?.trim(),
    stepRowHidden: document.getElementById("dash-pos-step-row")?.hidden,
    note: document.getElementById("dash-pos-note")?.textContent?.trim(),
    targetUnit: document.getElementById("dash-target-label")?.textContent?.trim(),
    rotorLine: document.querySelector(".rotor-pos-line")?.textContent?.replace(/\s+/g, " ").trim(),
  };
});
console.log("POS rel", JSON.stringify(info, null, 2));
await page.locator(".dash-ctrl").screenshot({ path: path.join(OUT, "pos-rel.png") });

await page.locator('[data-pos-sem="abs"]').click();
await page.waitForTimeout(200);
console.log("abs note", await page.locator("#dash-pos-note").innerText());
await page.locator('[data-pos-sem="step"]').click();
await page.waitForTimeout(200);
const step = await page.evaluate(() => ({
  stepRowHidden: document.getElementById("dash-pos-step-row")?.hidden,
  note: document.getElementById("dash-pos-note")?.textContent?.trim(),
  presets: [...document.querySelectorAll("#dash-presets button")].map((b) => b.textContent.trim()),
}));
console.log("POS step", step);
await page.locator(".dash-ctrl").screenshot({ path: path.join(OUT, "pos-step.png") });
await browser.close();
