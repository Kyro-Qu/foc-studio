import { chromium } from "playwright-core";
import path from "path";
import fs from "fs";
const OUT = path.resolve("output/playwright/topbar");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
for (const width of [1440, 1280, 1100]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.locator('nav .nav-btn[data-panel="scope"]').first().click();
  await page.waitForTimeout(400);
  // inject long values like live board
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set("hud-vbus", "14.45 V");
    set("hud-rpm", "0 RPM");
    set("hud-iq", "0.00 A");
    set("hud-state", "IDLE");
    set("hud-mode", "POS");
  });
  const m = await page.evaluate((w) => {
    const bar = document.querySelector("#scope-topbar");
    const right = document.querySelector(".scope-topbar-right");
    const kids = [...bar.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { cls: c.className.toString().slice(0, 28), y: Math.round(r.y), h: Math.round(r.height) };
    });
    const ys = [...new Set(kids.map((k) => k.y))];
    return {
      w,
      barH: Math.round(bar.getBoundingClientRect().height),
      lines: ys.length,
      rightY: right ? Math.round(right.getBoundingClientRect().y) : null,
      firstY: ys[0],
      scrollW: bar.scrollWidth,
      clientW: bar.clientWidth,
      kids,
    };
  }, width);
  console.log(JSON.stringify(m, null, 2));
  await page.locator("#scope-topbar").screenshot({ path: path.join(OUT, `topbar-${width}.png`) });
  await page.close();
}
await browser.close();
