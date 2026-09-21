import { chromium } from "playwright-core";
import path from "path";
import fs from "fs";
const OUT = path.resolve("output/playwright/ctxmenu");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.locator('nav .nav-btn[data-panel="scope"]').first().click();
await page.waitForTimeout(400);

// open settings drawer - should NOT contain btn-png/btn-csv
await page.locator("#btn-scope-settings").click();
await page.waitForTimeout(250);
const drawer = await page.evaluate(() => ({
  hasPng: !!document.getElementById("btn-png"),
  hasCsv: !!document.getElementById("btn-csv"),
  drawerText: document.getElementById("scope-drawer")?.innerText?.slice(0, 200),
  hint: document.querySelector("#scope-drawer .wf-note")?.textContent?.trim(),
}));
console.log("drawer", drawer);
await page.screenshot({ path: path.join(OUT, "drawer.png") });

// right-click canvas wrap
const wrap = page.locator(".scope-canvas-wrap");
const box = await wrap.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
await page.waitForTimeout(200);
const menu = await page.evaluate(() => {
  const m = document.getElementById("scope-ctx-menu");
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return {
    hidden: m.hidden,
    items: [...m.querySelectorAll("button")].map((b) => b.textContent.trim()),
    x: Math.round(r.x),
    y: Math.round(r.y),
    visible: r.width > 0 && r.height > 0,
  };
});
console.log("menu", menu);
await page.screenshot({ path: path.join(OUT, "ctxmenu.png") });

// click outside closes
await page.locator("#cursor-readout").click();
await page.waitForTimeout(150);
const after = await page.evaluate(() => document.getElementById("scope-ctx-menu")?.hidden);
console.log("hidden after outside click", after);
await browser.close();
