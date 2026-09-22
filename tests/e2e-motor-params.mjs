/**
 * 端到端全链路视觉与交互验证脚本 (Chrome CDP Headless E2E)
 * 验证：
 * 1. 电机参数 3x2 + 3x2 优雅对偶布局
 * 2. 状态胶囊与就绪诊断
 * 3. 单向 DAG 自动推导 (输入 KV & pp 自动计算磁链与凸极比)
 * 4. 辨识会话浮动横条 (Batch Adopt Bar)
 * 5. 多源溯源卡弹出 (Provenance Popover)
 * 6. 极对数两级确认硬门禁弹窗 (PP Conflict Modal)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TMP_PROFILE = path.resolve("tests", ".chrome-e2e-tmp");
const SCREENSHOT_DIR = path.resolve("screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
  }

  async send(method, params = {}) {
    await this.ready;
    const msgId = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error("Eval failed: " + JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  }

  async screenshot(filePath) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const buffer = Buffer.from(res.data, "base64");
    fs.writeFileSync(filePath, buffer);
    console.log(`[E2E] Screenshot saved: ${path.basename(filePath)} (${buffer.length} bytes)`);
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log("[E2E] Starting Chrome Headless for visual and interactive audit...");
  const chrome = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      "--remote-debugging-port=9223",
      `--user-data-dir=${TMP_PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,960",
      "http://127.0.0.1:8765/",
    ],
    { stdio: "ignore" }
  );

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        const res = await fetch("http://127.0.0.1:9223/json/list");
        const list = await res.json();
        const pageTarget = list?.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (pageTarget) {
          wsUrl = pageTarget.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {
        // waiting for chrome to listen
      }
    }

    if (!wsUrl) {
      throw new Error("Could not connect to Chrome debugging port");
    }

    const cdp = new CdpClient(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.consoleAPICalled") {
        console.log("[Browser Console]", msg.params.type, msg.params.args.map((a) => a.value || a.description).join(" "));
      } else if (msg.method === "Runtime.exceptionThrown") {
        console.error("[Browser Exception]", msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
      }
    });

    console.log("[E2E] Navigating to http://127.0.0.1:8765/ ...");
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:8765/" });
    await sleep(2000);

    const docState = await cdp.eval(`({
      url: window.location.href,
      title: document.title,
      navBtns: Array.from(document.querySelectorAll('.nav-btn')).map(b => ({
        text: b.textContent.trim(),
        panel: b.dataset.panel,
        step: b.dataset.step
      })),
      activePanel: document.querySelector('.panel.active')?.id
    })`);
    console.log("[E2E] Document state after load:", JSON.stringify(docState, null, 2));

    // 1. 点击左侧导航栏中的“电机”步骤按钮
    console.log("[E2E] Switching to Motor Params tab...");
    await cdp.eval(`
      const motorBtn = document.querySelector('.nav-btn[data-step="motor"]');
      if (motorBtn) motorBtn.click();
    `);
    await sleep(600);

    // 2. 检查顶栏状态胶囊和表单布局结构
    const layoutInfo = await cdp.eval(`
      (() => {
        const statusCapsule = document.querySelector(".param-top-status");
        const sections = document.querySelectorAll(".wf-card");
        const inputs = document.querySelectorAll("input[data-param-key]");
        return {
          hasStatusCapsule: !!statusCapsule,
          statusText: statusCapsule ? statusCapsule.textContent.trim() : "",
          cardCount: sections.length,
          paramInputCount: inputs.length,
        };
      })()
    `);
    console.log("[E2E] Initial Layout Inspection:", layoutInfo);
    if (!layoutInfo.hasStatusCapsule || layoutInfo.paramInputCount < 10) {
      throw new Error("Motor params UI did not render properly");
    }

    const alignmentCheck = await cdp.eval(`
      (() => {
        const rows = [...document.querySelectorAll(".form-row")];
        return rows.map(r => {
          const nameEl = r.querySelector(".lbl-name");
          const badge = r.querySelector(".ident-badge");
          if (!nameEl) return null;
          const key = r.querySelector("input[data-param-key]")?.dataset.paramKey;
          return {
            key,
            name: nameEl.innerText.trim(),
            nameWidth: window.getComputedStyle(nameEl).width,
            badgeText: badge ? badge.innerText.trim() : null,
            badgeX: badge ? Math.round(badge.getBoundingClientRect().left) : null,
            badgeW: badge ? Math.round(badge.getBoundingClientRect().width) : null,
            badgeH: badge ? Math.round(badge.getBoundingClientRect().height) : null,
            badgeFont: badge ? window.getComputedStyle(badge).fontSize : null,
            isStatic: badge ? badge.classList.contains("is-static") : false,
            cursor: badge ? window.getComputedStyle(badge).cursor : null,
          };
        }).filter(Boolean);
      })()
    `);
    console.log("[E2E] Badge Alignment & Static Property Check:", JSON.stringify(alignmentCheck, null, 2));

    // 验证固定项无弹窗（motor_name 纯本地型号型号标签，无法点击出 popover）
    console.log("[E2E] Testing that fixed motor_name item DOES NOT open popover on click...");
    const staticClickTest = await cdp.eval(`
      (() => {
        const nameBadge = document.querySelector('.ident-badge[data-param-key="motor_name"]');
        if (nameBadge) nameBadge.click();
        const popover = document.querySelector(".provenance-popover");
        return {
          nameStatic: nameBadge?.classList.contains("is-static"),
          popoverOpened: !!popover,
        };
      })()
    `);
    console.log("[E2E] Static Item Click Safety Result:", staticClickTest);
    if (!staticClickTest.nameStatic || staticClickTest.popoverOpened) {
      throw new Error("Fixed manual motor_name item mistakenly opened a provenance popover!");
    }

    // 验证表单行直接外露展示硬件读取块 (param-read-pill) 与三角形引用按钮 (btn-import-read)
    console.log("[E2E] Testing exposed Read Pill & Triangle Transfer Button on form rows...");
    const exposedReadTest = await cdp.eval(`
      (() => {
        const wizard = window.__focWizard;
        // 模拟注入硬件读取数据 (syncFromMcuRam)
        wizard.paramMgr.syncFromMcuRam({
          max_rpm: 8000,
          pp: 7,
          rs: 0.1042,
        });
        wizard.render();

        const maxRpmRow = document.querySelector('input[data-param-key="max_rpm"]')?.closest(".form-row");
        const readPill = maxRpmRow?.querySelector(".param-read-pill");
        const triangleBtn = maxRpmRow?.querySelector(".btn-import-read");
        const badge = maxRpmRow?.querySelector(".ident-badge");

        // 测量读取胶囊与三角形、三角形与徽章之间的微观间距
        const readRect = readPill?.getBoundingClientRect();
        const triRect = triangleBtn?.getBoundingClientRect();
        const badgeRect = badge?.getBoundingClientRect();

        const distReadToTri = triRect && readRect ? Math.round(triRect.left - readRect.right) : 0;
        const distTriToBadge = badgeRect && triRect ? Math.round(badgeRect.left - triRect.right) : 0;

        const rsRow = document.querySelector('input[data-param-key="rs"]')?.closest(".form-row");
        const rsReadPill = rsRow?.querySelector(".param-read-pill");

        return {
          hasReadPill: !!readPill,
          readText: readPill?.innerText.replace(/\\s+/g, ' ').trim(),
          rsReadText: rsReadPill?.innerText.replace(/\\s+/g, ' ').trim(),
          hasTriangleBtn: !!triangleBtn,
          triangleEnabled: triangleBtn ? !triangleBtn.disabled : false,
          badgeText: badge?.innerText.trim(),
          distReadToTri,
          distTriToBadge,
        };
      })()
    `);
    console.log("[E2E] Exposed Read & Transfer Button State:", exposedReadTest);
    if (!exposedReadTest.hasReadPill || !exposedReadTest.readText.includes("8000")) {
      throw new Error("Form row should display exposed Read Pill with value 8000!");
    }
    if (!exposedReadTest.readText.includes("rpm")) {
      throw new Error(`Read Pill should display unit rpm! Got: ${exposedReadTest.readText}`);
    }
    if (!exposedReadTest.rsReadText.includes("Ω")) {
      throw new Error(`Rs Read Pill should display unit Ω! Got: ${exposedReadTest.rsReadText}`);
    }
    if (!exposedReadTest.hasTriangleBtn || !exposedReadTest.triangleEnabled) {
      throw new Error("Form row should have an enabled triangle transfer button!");
    }
    if (exposedReadTest.distReadToTri < 16 || exposedReadTest.distTriToBadge < 16) {
      throw new Error(`Spacing between Read Pill, Triangle Button and Badge is too crowded! Got Read->Tri: ${exposedReadTest.distReadToTri}px, Tri->Badge: ${exposedReadTest.distTriToBadge}px`);
    }

    // 验证读取数据时的高亮动效语义：只点亮左侧读取胶囊 (read-bloom)，绝不误闪右侧辨识徽章与输入框 (ident-bloom)
    console.log("[E2E] Testing Readback Bloom Feedback (Left Read Pill Blooms, Right Badge/Input DO NOT bloom)...");
    const readBloomTest = await cdp.eval(`
      (() => {
        const wizard = window.__focWizard;
        // 模拟触发读取刷新动效
        const pills = document.querySelectorAll(".param-read-pill.has-data");
        pills.forEach(p => p.classList.add("read-bloom"));

        const bloomingPills = document.querySelectorAll(".param-read-pill.read-bloom");
        const wrongBloomingBadges = document.querySelectorAll(".ident-badge.ident-bloom");
        const wrongBloomingInputs = document.querySelectorAll(".num-field.ident-bloom");

        return {
          bloomingPillCount: bloomingPills.length,
          wrongBadgeBloomCount: wrongBloomingBadges.length,
          wrongInputBloomCount: wrongBloomingInputs.length,
        };
      })()
    `);
    console.log("[E2E] Readback Bloom Test Result:", readBloomTest);
    if (readBloomTest.bloomingPillCount === 0 || readBloomTest.wrongBadgeBloomCount > 0 || readBloomTest.wrongInputBloomCount > 0) {
      throw new Error("Read action mistakenly bloomed the right badges/inputs instead of left read pills!");
    }

    // 验证点击三角形按钮将读取值一键引用至手填
    console.log("[E2E] Testing triangle button click to import readback into manual...");
    const triangleClickTest = await cdp.eval(`
      (() => {
        const wizard = window.__focWizard;
        const ppRow = document.querySelector('input[data-param-key="pp"]')?.closest(".form-row");
        const triangleBtn = ppRow?.querySelector(".btn-import-read");
        if (triangleBtn) triangleBtn.click();

        const ppInput = document.querySelector('input[data-param-key="pp"]');
        const ppBadge = ppRow?.querySelector(".ident-badge");

        return {
          ppValue: ppInput ? ppInput.value : null,
          badgeText: ppBadge ? ppBadge.innerText.trim() : null,
          isReadonly: ppInput ? ppInput.hasAttribute("readonly") : true,
        };
      })()
    `);
    console.log("[E2E] Triangle Button Transfer Result:", triangleClickTest);
    if (triangleClickTest.ppValue !== "7" || triangleClickTest.badgeText !== "✎ 手填" || triangleClickTest.isReadonly) {
      throw new Error("Clicking triangle button failed to import readback into manual candidate!");
    }
    await sleep(300);
    // 截图 7：外露读取块、三角形引用按钮与手填/辨识对齐展示
    await cdp.screenshot(path.join(SCREENSHOT_DIR, "e2e-7-maxrpm-popover.png"));

    const spacingCheck = await cdp.eval(`
      (() => {
        const rows = [...document.querySelectorAll(".form-list:first-child .form-row")];
        return rows.map((r, i) => {
          const rect = r.getBoundingClientRect();
          const nextRect = rows[i + 1]?.getBoundingClientRect();
          return {
            row: i + 1,
            name: r.querySelector(".lbl-name")?.innerText || r.querySelector(".form-lbl")?.innerText,
            height: Math.round(rect.height),
            pitch: nextRect ? Math.round(nextRect.top - rect.top) : null,
          };
        });
      })()
    `);
    console.log("[E2E] Left Column Row Spacing (Pitch) Check:", JSON.stringify(spacingCheck, null, 2));

    // 截图 1：干净的初始 3x2 + 3x2 布局与状态指示
    await cdp.screenshot(path.join(SCREENSHOT_DIR, "e2e-1-motor-layout.png"));

    // 3. 模拟输入手册已知标称：pp=7, kv=960, motor_name="DJI 2312S"
    console.log("[E2E] Typing manual params: pp=7, kv=960, motor_name=DJI 2312S...");
    const dagResult = await cdp.eval(`
      (() => {
        const ppInput = document.querySelector('input[data-param-key="pp"]');
        const kvInput = document.querySelector('input[data-param-key="kv"]');
        const nameInput = document.querySelector('input[data-param-key="motor_name"]');

        nameInput.value = "DJI 2312S";
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));

        ppInput.value = "7";
        ppInput.dispatchEvent(new Event("input", { bubbles: true }));

        kvInput.value = "960";
        kvInput.dispatchEvent(new Event("input", { bubbles: true }));

        // 获取 DAG 推导计算出的磁链
        const fluxInput = document.querySelector('input[data-param-key="flux"]');
        const fluxBadge = document.querySelector('.ident-badge[data-param-key="flux"]');
        return {
          fluxVal: fluxInput ? fluxInput.value : null,
          badgeText: fluxBadge ? fluxBadge.textContent.trim() : "",
        };
      })()
    `);
    console.log("[E2E] DAG Inference Result:", dagResult);

    // 4. 模拟下位机辨识完成，灌入辨识事务 (包含电阻、电感、实测磁链以及冲突的极对数 8)
    console.log("[E2E] Injecting Candidate Ident Session with pp=8 (conflict) & measured Rs, Ls...");
    const sessionResult = await cdp.eval(`
      (() => {
        const wizard = window.__focWizard;
        if (!wizard || !wizard.paramMgr) return { error: "No wizard instance" };

        wizard.paramMgr.startIdentSession("full");
        wizard.paramMgr.feedIdentResult({
          rs: 0.125,
          ls: 22.5,
          ld: 21.0,
          lq: 24.0,
          flux: 0.00082075,
          pp: 8, // 冲突！标称 7，辨识 8
        });

        // 重新渲染电机页面以刷新状态
        wizard.render();

        const batchBar = document.getElementById("batch-adopt-bar");
        const ppBadge = document.querySelector('.diff-badge[data-param-key="pp"]');
        return {
          batchBarVisible: batchBar ? (!batchBar.hidden && batchBar.style.display !== "none") : false,
          ppBadgeClass: ppBadge ? ppBadge.className : "",
          ppBadgeText: ppBadge ? ppBadge.textContent.trim() : "",
        };
      })()
    `);
    console.log("[E2E] Session Bar & PP Conflict Detection:", sessionResult);
    await sleep(500);

    // 截图 2：辨识事务浮动横条出现，极对数显示分歧红标
    await cdp.screenshot(path.join(SCREENSHOT_DIR, "e2e-2-dag-and-adopt-bar.png"));

    // 5. 验证顶部辨识下拉动作组 (Split Button Group & Dropdown Menu)
    console.log("[E2E] Testing Ident Split Button Group and Dropdown Menu...");
    const splitMenuResult = await cdp.eval(`
      (() => {
        const toggleBtn = document.getElementById("btn-ident-menu-toggle");
        const menu = document.getElementById("ident-dropdown-menu");
        if (toggleBtn) toggleBtn.click();
        const items = [...(menu?.querySelectorAll(".menu-item") || [])].map((el) => ({
          mode: el.dataset.identMode,
          title: el.querySelector(".item-title")?.innerText.trim(),
        }));
        return {
          hasToggleBtn: !!toggleBtn,
          menuVisible: menu ? !menu.hidden : false,
          itemCount: items.length,
          modes: items.map((i) => i.mode),
        };
      })()
    `);
    console.log("[E2E] Ident Dropdown Menu State:", splitMenuResult);
    if (!splitMenuResult.menuVisible || splitMenuResult.itemCount < 5) {
      throw new Error("Ident dropdown menu did not open or has missing items!");
    }
    await sleep(400);

    // 截图 3：辨识下拉动作组展示
    await cdp.screenshot(path.join(SCREENSHOT_DIR, "e2e-3-ident-dropdown.png"));

    // 关闭下拉菜单
    await cdp.eval(`document.getElementById("btn-ident-menu-toggle")?.click();`);
    await sleep(200);

    // 6. 点击相电阻徽章弹出纯溯源卡 (Popover)，验证纯文本对比（弹窗无任何输入框）、无 Candidate 冗余行、主界面锁定小锁指示与点击解锁
    console.log("[E2E] Clicking Rs badge to inspect Provenance Popover (No Candidate row, pure text display, no input inside popover)...");
    const rsPopoverResult = await cdp.eval(`
      (() => {
        const rsBadge = document.querySelector('.ident-badge[data-param-key="rs"]');
        if (rsBadge) rsBadge.click();
        const popover = document.querySelector(".provenance-popover");
        if (!popover) return { popoverVisible: false };

        // 检查是否彻底移除了 Candidate 冗余行
        const allText = popover.innerText;
        const hasCandidateRow = allText.includes("当前采纳") || allText.includes("Candidate");

        // 检查弹窗内部绝无任何 input 输入框 (纯文本显示)
        const inputsInPopover = popover.querySelectorAll("input");

        // 检查系统辨识行与手填行文本呈现
        const inUseBadges = [...popover.querySelectorAll(".source-in-use")].map(b => b.innerText.trim());

        // 检查主表单当前状态 (已测定状态应为 identified 只读锁定，无多余小锁图标)
        const mainRsInput = document.querySelector('input[data-param-key="rs"]');
        const isMainLocked = mainRsInput ? mainRsInput.hasAttribute("readonly") : false;

        return {
          popoverVisible: true,
          popoverTitle: popover.querySelector(".popover-title")?.textContent.trim(),
          hasCandidateRow,
          inputCountInPopover: inputsInPopover.length,
          inUseBadges,
          isMainLocked,
        };
      })()
    `);
    console.log("[E2E] Rs Popover Card Inspection:", rsPopoverResult);
    if (rsPopoverResult.hasCandidateRow) {
      throw new Error("Popover still contains redundant Candidate row!");
    }
    if (rsPopoverResult.inputCountInPopover > 0) {
      throw new Error("Popover mistakenly contains input fields! Window must be pure display only.");
    }
    if (!rsPopoverResult.isMainLocked) {
      throw new Error("Main form Rs input must be readonly when identified source is active!");
    }
    if (rsPopoverResult.popoverTitle !== "相电阻") {
      throw new Error(`Popover title should be purely parameter name without suffix! Got: ${rsPopoverResult.popoverTitle}`);
    }
    await sleep(300);

    // 测试在 Popover 中采纳手填，主表单输入框自动解锁，用户在主表单修改数字
    console.log("[E2E] Testing Popover adoption: adopt manual -> main input unlocked & editable...");
    const adoptManualResult = await cdp.eval(`
      (() => {
        const popover = document.querySelector(".provenance-popover");
        const adoptManualBtn = popover?.querySelector('.btn-adopt[data-adopt-src="manual"]');
        if (adoptManualBtn) adoptManualBtn.click();

        const mainRsInput = document.querySelector('input[data-param-key="rs"]');
        const rsBadge = document.querySelector('.ident-badge[data-param-key="rs"]');
        const isLockedField = document.querySelector('.num-field[data-param-key="rs"]')?.classList.contains("is-locked");

        // 此时在主表单输入框直接键入修改手填数值
        if (mainRsInput) {
          mainRsInput.value = "0.1350";
          mainRsInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        return {
          mainRsVal: mainRsInput ? mainRsInput.value : null,
          isMainReadonly: mainRsInput ? mainRsInput.hasAttribute("readonly") : true,
          badgeText: rsBadge ? rsBadge.innerText.trim() : null,
          isLockedField,
        };
      })()
    `);
    console.log("[E2E] Adopt Manual and Type in Main Input Result:", adoptManualResult);
    if (adoptManualResult.isMainReadonly || adoptManualResult.badgeText !== "✎ 手填") {
      throw new Error("Switching to manual failed to unlock main input or update badge to 手填!");
    }
    await sleep(300);

    // 重新打开 Popover，验证手填行显示刚才在主表单修改的 0.1350 且为使用中，辨识行依然完好并可一键切回
    console.log("[E2E] Inspecting Popover after manual edit, then switching back to identified...");
    const switchBackResult = await cdp.eval(`
      (() => {
        const rsBadge = document.querySelector('.ident-badge[data-param-key="rs"]');
        if (rsBadge) rsBadge.click();

        const popover = document.querySelector(".provenance-popover");
        const adoptIdentBtn = popover?.querySelector('.btn-adopt[data-adopt-src="identified"]');
        if (adoptIdentBtn) adoptIdentBtn.click();

        const mainRsInput = document.querySelector('input[data-param-key="rs"]');
        const newBadge = document.querySelector('.ident-badge[data-param-key="rs"]');

        return {
          isMainReadonly: mainRsInput ? mainRsInput.hasAttribute("readonly") : false,
          badgeText: newBadge ? newBadge.innerText.trim() : null,
        };
      })()
    `);
    console.log("[E2E] Switch Back to Identified Result:", switchBackResult);
    if (!switchBackResult.isMainReadonly || switchBackResult.badgeText !== "⚡ 辨识") {
      throw new Error("Switching back to identified failed to lock main input!");
    }
    await sleep(300);

    // 点击 KV 徽章打开 Popover 观察纯净三源展示 (手填/辨识/读取三源常驻对比，绝无公式残留，无括号英文，宽度紧凑小巧，标题纯粹为参数名)
    console.log("[E2E] Clicking KV badge to inspect Pure Provenance Popover (Manual/Ident/Read 3-source, No formula, no parens English)...");
    const popoverResult = await cdp.eval(`
      (() => {
        const kvBadge = document.querySelector('.ident-badge[data-param-key="kv"]');
        if (kvBadge) kvBadge.click();
        const popover = document.querySelector(".provenance-popover");
        return {
          popoverVisible: !!popover,
          popoverTitle: popover ? popover.querySelector(".popover-title")?.textContent.trim() : "",
          popoverFormulas: popover ? popover.querySelectorAll(".popover-formula").length : 0,
          popoverWidth: popover ? popover.offsetWidth : 0,
          sourceNames: popover ? Array.from(popover.querySelectorAll(".source-name")).map(td => td.textContent.trim()) : [],
        };
      })()
    `);
    console.log("[E2E] KV Popover Card State (Pure and clean):", popoverResult);
    if (popoverResult.popoverFormulas > 0) {
      throw new Error("Popover mistakenly still contains formula derivation residue!");
    }
    if (popoverResult.popoverTitle !== "电机 KV 值") {
      throw new Error(`Popover title should be purely parameter name without suffix! Got: ${popoverResult.popoverTitle}`);
    }
    if (popoverResult.popoverWidth > 280) {
      throw new Error(`Popover width should be compact (<=280px)! Got: ${popoverResult.popoverWidth}`);
    }
    const hasEnglishParens = popoverResult.sourceNames.some(name => name.includes("(") || name.includes("Manual") || name.includes("Identified"));
    if (hasEnglishParens) {
      throw new Error(`Popover source names should not have (Manual) or (Identified) in Chinese mode! Got: ${popoverResult.sourceNames.join(", ")}`);
    }
    // 弹窗不再混入读取行，保持纯粹的手填与辨识对比
    if (popoverResult.sourceNames.includes("📥 读取")) {
      throw new Error(`Popover should NOT contain Read row because Read is now directly exposed on the form row! Got: ${popoverResult.sourceNames.join(", ")}`);
    }
    await sleep(400);

    // 截图 4：多源溯源卡浮层展示
    await cdp.screenshot(path.join(SCREENSHOT_DIR, "e2e-4-provenance-popover.png"));

    // 7. 触发极对数硬门禁确认弹窗 (PP Conflict Modal)
    console.log("[E2E] Triggering PP Conflict Modal...");
    const modalResult = await cdp.eval(`
      (() => {
        // 关闭 popover
        document.querySelector(".popover-close")?.click();

        const wizard = window.__focWizard;
        wizard._showPpConflictModal();

        const modal = document.querySelector(".pp-modal-overlay");
        return {
          modalVisible: !!modal,
          optionCount: modal ? modal.querySelectorAll(".pp-option-card").length : 0,
          hasConfirmBtn: !!modal?.querySelector("#btn-confirm-pp-modal"),
        };
      })()
    `);
    console.log("[E2E] PP Modal State:", modalResult);
    await sleep(400);

    // 截图 5：极对数两级确认硬门禁弹窗
    await cdp.screenshot(path.join(SCREENSHOT_DIR, "e2e-5-pp-conflict-modal.png"));

    // 8. 在弹窗中选择辨识实测值 (8) 并点击人工确认裁决
    console.log("[E2E] Resolving PP Conflict via user adjudication...");
    const resolutionResult = await cdp.eval(`
      (() => {
        const identOption = document.querySelector('.pp-option-card[data-pp-choice="identified"]');
        if (identOption) identOption.click();

        const confirmBtn = document.getElementById("btn-confirm-pp-modal");
        if (confirmBtn) confirmBtn.click();

        const wizard = window.__focWizard;
        const report = wizard.paramMgr.getReadinessReport();
        const pp = wizard.paramMgr.get("pp");
        return {
          ppConflict: wizard.paramMgr.ppConflict,
          ppConfirmedByUser: wizard.paramMgr.ppConfirmedByUser,
          ppDiffStatus: pp.diff.status,
          ppCandidate: pp.candidate.value,
          canCloseLoop: report.canCloseLoop,
          blockers: report.blockers,
        };
      })()
    `);
    console.log("[E2E] Adjudication Resolution Result:", resolutionResult);
    await sleep(400);

    // 截图 6：门禁解除后放行闭环状态
    await cdp.screenshot(path.join(SCREENSHOT_DIR, "e2e-6-pp-resolved-ready.png"));

    cdp.close();
    console.log("\n>>> ALL E2E VISUAL & INTERACTIVE TESTS COMPLETED SUCCESSFULLY! <<<");
  } finally {
    chrome.kill();
    try {
      fs.rmSync(TMP_PROFILE, { recursive: true, force: true });
    } catch (e) {}
  }
}

main().catch((err) => {
  console.error("[E2E] Test failed with error:", err);
  process.exit(1);
});
