import { loadChannels, saveChannels, CHANNEL_COUNT, channelLabel, formatValueCompact } from "./channels.js";
import { SerialTransport, SerialState } from "./transport/serial.js";
import { StpDecoder } from "./protocol/stp.js";
import { TelemetryAdapter } from "./protocol/protocol.js";
import { TelemetryStore } from "./data/telemetry-store.js";
import { SimulationSource } from "./sim/simulation.js";
import { SessionRecorder, parseCsv, ReplaySource } from "./data/recorder.js";
import { Scope } from "./ui/scope.js";
import { Dashboard } from "./ui/dashboard.js";
import { Terminal } from "./ui/terminal.js";
import { ControlConsole, PRESET_COMMANDS, MODES, IDENT_COMMANDS, FEEDBACK_COMMANDS, MODE_CONTROLS } from "./ui/console.js";
import { WorkflowWizard } from "./ui/wizard.js";
import { MathChannels, MATH_OPS } from "./ui/math.js";
import { TriggerEngine, TriggerMode } from "./ui/trigger.js";
import { ScopeLegend } from "./ui/legend.js";
import { TuningPanel } from "./ui/tuning.js";
import { ExpertPanel } from "./ui/expert.js";
import { t, getLang, setLang, applyI18n } from "./i18n.js";

const $ = (id) => document.getElementById(id);

const state = {
  mode: "serial", // serial | sim | replay
  channels: loadChannels(),
  // Firmware: 16 kHz / FOC_TELEMETRY_DIV(32) = 500 frames/s.
  sampleRate: 500,
  windowSec: 5,
  bytesWindow: 0,
  framesWindow: 0,
  lastStats: performance.now(),
  lastChValUpdate: 0,
  textBuf: "",
  textFlush: 0,
  waveActive: false,
};

const store = new TelemetryStore(CHANNEL_COUNT, 40000);
const serial = new SerialTransport();
const decoder = new StpDecoder();
const recorder = new SessionRecorder(CHANNEL_COUNT, 60000);
const math = new MathChannels();
const trigger = new TriggerEngine();
let sim = null;
let replay = null;
let replaySession = null;
let expertPanel = null;
/** 示波器浮窗模式选框的反向同步钩子（由浮窗 IIFE 赋值） */
let fabSyncMode = null;

function queueText(text) {
  state.textBuf += text;
  if (state.capture) state.capture(text);
  // 10B STATUS 不带 mode：从 CLI 回显（`mode xx` / `status`）同步控制台、HUD 与浮窗的模式显示
  const mm = text.match(/\bmode=(vf|iq|vel|pos)\b/);
  if (mm) {
    dashboard.syncMode(mm[1]);
    if (fabSyncMode) fabSyncMode(mm[1]);
  }
  if (state.textBuf.length > 8192) state.textBuf = state.textBuf.slice(-8192);
  if (!state.textFlush) state.textFlush = requestAnimationFrame(flushText);
}

function flushText() {
  state.textFlush = 0;
  if (state.textBuf) {
    terminal.appendText(state.textBuf, "rx");
    state.textBuf = "";
  }
}

function onSample(values, sampleIndex, mask = null, tick = null) {
  // 统一展开为全局 32 通道标准空间，未选通道填入 NaN
  const fullValues = new Float32Array(CHANNEL_COUNT);
  fullValues.fill(NaN);

  if (mask !== null && mask !== undefined) {
    let vIdx = 0;
    for (let bit = 0; bit < CHANNEL_COUNT; bit++) {
      if ((mask & (1 << bit)) !== 0) {
        if (vIdx < values.length) {
          fullValues[bit] = values[vIdx++];
        }
      }
    }
  } else {
    for (let i = 0; i < Math.min(values.length, CHANNEL_COUNT); i++) {
      fullValues[i] = values[i];
    }
  }

  store.push(fullValues, sampleIndex);
  recorder.push(fullValues, sampleIndex);
  if (expertPanel) {
    expertPanel.updateSensorlessFromTelemetry(fullValues);
  }

  // 限制通道侧边栏实时数值刷新率在 10 Hz 左右（100ms），丝滑且极省 CPU
  const now = performance.now();
  if (now - state.lastChValUpdate >= 100) {
    state.lastChValUpdate = now;
    if ($("panel-scope")?.classList.contains("active")) {
      updateChannelValues();
    }
  }

  if (trigger.mode !== TriggerMode.OFF) {
    const r = trigger.push(fullValues, sampleIndex);
    if (r === true) {
      scope.invalidate();
      recordLog(`TRIG fire @ ${sampleIndex} src=ch${trigger.source} level=${trigger.level}`);
    } else if (r === "auto-rearm") {
      scope.invalidate();
      recordLog("TRIG auto-rearm");
    }
  }
  state.framesWindow += 1;
}

const adapter = new TelemetryAdapter({
  onSample: ({ values, sampleIndex, mask, tick }) => onSample(values, sampleIndex, mask, tick),
  onText: queueText,
  onStatus: (status) => {
    state.lastStatus = status;
    state.lastStatusTime = Date.now();
    updateTopBarTelemetry(status);
    dashboard.handleStatusUpdate(status);
    scope.updateMiniHud(status, dashboard._mode);
  },
  onEvent: (event) => {
    const desc = `[EVENT] ID=${event.eventId} M_Fault=${event.motorFault} S_Fault=${event.shuntFault} Detail=${event.detail}`;
    recordLog(desc);
    terminal.appendText(desc + "\r\n", "rx");
    // 捕获跳闸事件：高亮提醒可拉取黑匣子
    if (event.eventId === 1) {
      terminal.appendText("[EVENT] 检测到跳闸！可前往「高级算法」面板一键拉取 512 拍故障黑匣子。\r\n", "err");
      const bbBadge = document.getElementById("bb-status-badge");
      if (bbBadge) {
        bbBadge.textContent = "已捕获跳闸 · 待拉取";
        bbBadge.className = "wf-badge danger";
      }
    }
  },
  onAck: (ack) => {
    const statusStr = ack.status === 0 ? "OK" : (ack.status === 2 ? "LIMITED" : "REJECTED");
    const msg = `[ACK] Cmd=${ack.cmdCode} Status=${statusStr} EffectiveMask=0x${(ack.effectiveMask >>> 0).toString(16).toUpperCase()} Rate=${ack.effectiveRateHz}Hz`;
    recordLog(msg);
    // 设备回传的真实生效波形速率是时间轴的唯一权威来源（telem rate 后自动跟随）
    if (state.mode === "serial" && ack.effectiveRateHz > 0 && ack.effectiveRateHz !== state.sampleRate) {
      state.sampleRate = ack.effectiveRateHz;
      scope.setSampleRate(state.sampleRate);
      recorder.sampleRate = state.sampleRate;
      terminal.appendText(`[sys] wave rate -> ${state.sampleRate} Hz\n`, "sys");
    }
  },
});
adapter.attach(decoder);

const scope = new Scope($("scope-canvas"), store, state.channels);
// 手动 Y 缩放/平移：关掉自动 Y，并回写 y-min/y-max 输入框
scope.onYRange = (mn, mx) => {
  const yMinEl = $("y-min");
  const yMaxEl = $("y-max");
  if (yMinEl) yMinEl.value = mn.toFixed(3);
  if (yMaxEl) yMaxEl.value = mx.toFixed(3);
};
scope.onAutoScale = (on) => {
  const chk = $("chk-autoscale");
  if (chk) chk.checked = !!on;
  const yMinEl = $("y-min");
  const yMaxEl = $("y-max");
  if (yMinEl) yMinEl.disabled = !!on;
  if (yMaxEl) yMaxEl.disabled = !!on;
};
const dashboard = new Dashboard($("dashboard"), store, state.channels, {
  send: (cmd) => consoleCtl.run(cmd),
  isConnected: () => {
    if (state.mode === "sim" || state.mode === "replay") return true;
    return serial.isConnected();
  },
});
const legend = new ScopeLegend($("scope-legend"), store, state.channels, { math });

function sendCli(line) {
  return consoleCtl.run(line);
}

/**
 * 集中管理下位机波形流（wave 模式）：
 * 示波器激活时下发 wave 1 开启 500 Hz 波形流且静默 CLI 回显；
 * 切出示波器时下发 wave 0 停止波形流，恢复普通命令行交互。
 */
function setWaveStream(enable) {
  state.waveActive = !!enable;
  const btn = $("btn-wave-toggle");
  if (btn) {
    btn.classList.toggle("is-on", state.waveActive);
    btn.classList.toggle("is-off", !state.waveActive);
    const label = btn.querySelector("span");
    if (label) label.textContent = state.waveActive ? `${t("scope.wave")}: ON` : `${t("scope.wave")}: OFF`;
  }
  const empty = $("scope-empty");
  if (empty) {
    if (!state.waveActive && state.mode === "serial" && serial.isConnected() && store.length <= 2) {
      empty.hidden = false;
      empty.textContent = t("empty.scope.wave");
    } else if (store.length > 2) {
      empty.hidden = true;
    }
  }
  if (state.mode === "serial" && serial.isConnected()) {
    sendCli(state.waveActive ? "wave 1" : "wave 0");
  }
}

const consoleCtl = new ControlConsole({
  send: async (line, opts) => {
    flushText();
    if (!opts?.quiet) terminal.echoCommand(line);
    if (state.mode === "sim" || state.mode === "replay") {
      if (line === "help") {
        terminal.appendText(
          "FOC CLI (offline/sim): help/version/status/mode/target/rpm/vq/vel/pos/ident/conf/feedback…\n" +
            "输入 / 查看完整命令表\n",
          "rx"
        );
      } else if (line === "status") {
        terminal.appendText(
          `M0 RUN mode=vel\r\nvel=${(store.latest[2] || 0).toFixed(1)}rpm\r\niq=${(store.latest[5] || 0).toFixed(3)}A\r\n`,
          "rx"
        );
      } else {
        terminal.appendText(`OK ${line}\r\n`, "rx");
      }
      return;
    }
    if (!serial.isConnected()) {
      throw new Error(t("sys.need_connect"));
    }
    await serial.write(line + "\r\n");
  },
});

const terminal = new Terminal($("term-log"), $("term-input"), $("term-send"), {
  suggestEl: $("term-suggest"),
  onSend: async (line) => {
    await consoleCtl.run(line);
  },
  onHistoryChange: (hist) => {
    const dl = $("term-history");
    if (!dl) return;
    dl.innerHTML = hist
      .slice()
      .reverse()
      .slice(0, 30)
      .map((h) => `<option value="${h.replace(/"/g, "&quot;")}"></option>`)
      .join("");
  },
});

const tuningRoot = $("tuning-root");
const tuning = tuningRoot ? new TuningPanel(tuningRoot, (cmd) => consoleCtl.run(cmd)) : null;

/**
 * 串行化的“发命令并捕获回显文本”。
 * 所有面板共用同一条队列：同一时刻只允许一个捕获在进行，
 * 采用智能结束检测（收到特定标志或数据到达后静止 25ms 立即完成），
 * 彻底消除 350~400ms 盲等导致的队列积压与界面卡顿。
 */
let captureChain = Promise.resolve();
function sendCapture(cmd, opts = 400) {
  const timeoutMs = typeof opts === "number" ? opts : (opts?.timeout || 400);
  const customMatcher = typeof opts === "object" ? opts?.endMatcher : null;
  const trimmed = cmd.trim();
  const isLongTask = trimmed.startsWith("ident") ||
                     (trimmed.startsWith("calib") && !trimmed.startsWith("calib offset")) ||
                     trimmed.startsWith("blackbox");
  const idleMs = (typeof opts === "object" && opts?.idleMs !== undefined)
    ? opts.idleMs
    : (isLongTask ? 0 : 25);

  const job = captureChain.then(() => {
    return new Promise(async (resolve) => {
      let buf = "";
      let resolved = false;
      let idleTimer = null;
      let hardTimer = null;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        state.capture = null;
        resolve(buf);
      };

      // 常见 CLI 命令结束标记检测，命中立即 0ms 完成
      const checkEnd = (str) => {
        if (customMatcher) {
          if (typeof customMatcher === "function") return customMatcher(str);
          if (customMatcher instanceof RegExp) return customMatcher.test(str);
          if (typeof customMatcher === "string") return str.includes(customMatcher);
        }
        if (trimmed.startsWith("ident")) {
          return str.includes("ident DONE:") || str.includes("ident FAIL:") ||
                 str.includes("err: ident") || str.includes("err: no valid result");
        }
        if (trimmed.startsWith("calib") && !trimmed.startsWith("calib offset")) {
          return str.includes("calib DONE") || str.includes("calib FAIL") ||
                 str.includes("err: calib");
        }
        if (trimmed === "status") return str.includes("cpu=");
        if (trimmed === "version") return str.includes("stp=");
        if (trimmed.startsWith("limit")) return str.includes("vbus_min=") || str.includes("limit=");
        if (trimmed.startsWith("vbus")) return str.includes("vbus=");
        if (trimmed.startsWith("conf read")) return str.includes("saved");
        if (trimmed.startsWith("pos")) return str.includes("pos ") || str.includes("iq_obs=");
        if (trimmed.startsWith("vel")) return str.includes("vel ") || str.includes("ki=");
        if (trimmed.startsWith("cpr")) return str.includes("cpr ");
        return false;
      };

      state.capture = (s) => {
        buf += s;
        if (checkEnd(buf)) {
          finish();
          return;
        }
        // 收到数据后启动空闲定时器：短命令 25ms 内无新字符认为接收完整；长任务绝不提前截断
        if (idleMs > 0 && !isLongTask) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            if (buf.length > 0) finish();
          }, idleMs);
        }
      };

      // 兜底硬超时定时器
      hardTimer = setTimeout(finish, timeoutMs);

      try {
        await consoleCtl.run(cmd, { quiet: true });
      } catch (e) {
        finish();
      }
    });
  });

  // 失败也不阻塞后续捕获
  captureChain = job.catch(() => {});
  return job;
}

const wizard = new WorkflowWizard($("panel-wf"), {
  send: (cmd) => consoleCtl.run(cmd),
  isConnected: () => {
    if (state.mode === "sim" || state.mode === "replay") return true;
    return serial.isConnected();
  },
  getStatus: () => (state.lastStatusTime && Date.now() - state.lastStatusTime < 3000 ? state.lastStatus : null),
  getLatest: () => store.latest,
  sendCapture,
  onIqLimit: (amps) => dashboard?.setIqLimit?.(amps),
  onMaxRpm: (rpm) => dashboard?.setMaxRpm?.(rpm),
});
window.__focWizard = wizard;

const expertRoot = $("panel-expert");
if (expertRoot) {
  expertPanel = new ExpertPanel(expertRoot, {
    send: (cmd) => consoleCtl.run(cmd),
    sendCapture,
  });
}

// 控制台页挂载仪表盘（表盘+状态）
wizard.onAfterRender = (step) => {
  const host = $("wf-dashboard-host");
  const dashEl = $("dashboard");
  if (!host || !dashEl) return;
  if (step === "run") {
    if (dashEl.parentElement !== host) {
      host.appendChild(dashEl);
    }
    // chips 挂到卡片头右侧（与「控制台」同一行）
    const chipHost = $("dash-chips-host");
    const strip = dashboard.strip || dashEl.querySelector(".dash-chips");
    if (chipHost && strip) {
      chipHost.innerHTML = "";
      chipHost.appendChild(strip);
    }
    dashboard.resizeGauges();
    dashboard.refresh();
  } else if (dashEl.parentElement === host) {
    $("panel-dashboard-hidden")?.appendChild(dashEl);
  }
};

scope.setMath(math);
scope.setTrigger(trigger);

/* ---------- helpers ---------- */

function setConnStatus(text, cls) {
  const el = $("conn-status");
  const dot = el?.querySelector(".status-dot");
  const txt = el?.querySelector(".status-text");
  if (txt) {
    txt.textContent = text;
  } else if (el) {
    el.textContent = text;
  }
  if (el) el.className = `status-pill ${cls}`;
}

/** 将毫秒转换为时分秒可读格式：01:23:45 或 12.3s */
function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const secTotal = Math.floor(ms / 1000);
  const hours = Math.floor(secTotal / 3600);
  const minutes = Math.floor((secTotal % 3600) / 60);
  const seconds = secTotal % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/** 顶栏与全局遥测微状态刷新 */
function updateTopBarTelemetry(status) {
  if (!status) return;

  const vbusEl = $("tb-vbus");
  if (vbusEl && Number.isFinite(status.vbus)) {
    vbusEl.textContent = `${status.vbus.toFixed(1)}V`;
    const item = vbusEl.closest(".tb-hud-item");
    if (item) {
      item.classList.toggle("is-warn", status.vbus < 11.5 || status.vbus > 28);
      item.classList.toggle("is-bad", status.vbus < 10.0 || status.vbus > 30);
    }
  }

  const uptimeEl = $("tb-uptime");
  if (uptimeEl && Number.isFinite(status.timestampMs)) {
    uptimeEl.textContent = formatUptime(status.timestampMs);
  }

  const cpuEl = $("tb-cpu");
  const cpuVal = Number.isFinite(status.cpuPct) ? status.cpuPct : (Number.isFinite(status.cpu) ? status.cpu : 0);
  if (cpuEl) {
    cpuEl.textContent = `${Math.round(cpuVal)}%`;
    const item = cpuEl.closest(".tb-hud-item");
    if (item) {
      item.classList.toggle("is-warn", cpuVal > 60);
      item.classList.toggle("is-bad", cpuVal > 80);
    }
  }

  const tempEl = $("tb-temp");
  if (tempEl && Number.isFinite(status.tempC)) {
    tempEl.textContent = `${Math.round(status.tempC)}℃`;
    const item = tempEl.closest(".tb-hud-item");
    if (item) {
      item.classList.toggle("is-warn", status.tempC > 65);
      item.classList.toggle("is-bad", status.tempC > 80);
    }
  }

  const dot = $("conn-status")?.querySelector(".status-dot");
  if (dot) {
    dot.style.opacity = "1";
    dot.style.transform = "scale(1.25)";
    setTimeout(() => {
      dot.style.opacity = "0.75";
      dot.style.transform = "scale(1)";
    }, 120);
  }
}

const STATUS_KEYS = {
  off: "status.off",
  busy: "status.connecting",
  ok: "status.connected",
  err: "status.error",
  sim: "status.sim",
};

function setStatusKey(key, cls) {
  setConnStatus(t(key), cls);
}

function applyModeUI() {
  const isConn = serial.isConnected();
  const toggleBtn = $("btn-toggle-port");
  if (toggleBtn) {
    toggleBtn.textContent = isConn ? t("serial.close") : t("serial.open");
    toggleBtn.title = isConn ? t("serial.close") : t("serial.open");
    toggleBtn.classList.toggle("is-open", isConn);
    toggleBtn.disabled = state.mode !== "serial";
  }
  const selectBtn = $("btn-select-port");
  if (selectBtn) {
    selectBtn.disabled = state.mode !== "serial";
  }
  if ($("btn-connect")) $("btn-connect").disabled = state.mode !== "serial";
  if ($("btn-disconnect")) $("btn-disconnect").disabled = state.mode !== "serial" || !isConn;
  const baudSel = $("baud");
  if (baudSel) baudSel.disabled = state.mode !== "serial";
  const baudC = $("baud-custom");
  if (baudC && baudSel) baudC.disabled = state.mode !== "serial" || baudSel.value !== "custom";
  document.querySelectorAll('input[name="data-mode"]').forEach((r) => {
    r.checked = r.value === state.mode;
  });
}

function resetPipeline() {
  adapter.reset();
  if (typeof decoder.reset === "function") {
    decoder.reset();
  }
  if (typeof decoder.resetSampleIndex === "function") {
    decoder.resetSampleIndex();
  }
  store.clear();
  trigger.disarm();
  state.textBuf = "";
  state.framesWindow = 0;
  state.bytesWindow = 0;
}

function recordLog(msg) {
  const el = $("record-log");
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.textContent += line;
  el.scrollTop = el.scrollHeight;
}

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function fillChannelSelects() {
  const lang = getLang();
  const opts = state.channels
    .map((c) => `<option value="${c.id}">ch${c.id} ${channelLabel(c.id, lang)}</option>`)
    .join("");
  $("trig-src").innerHTML = opts;
  $("math-a").innerHTML = opts;
  $("math-b").innerHTML = opts;
  $("trig-src").value = String(trigger.source);
}

function renderMathList() {
  const box = $("math-list");
  box.innerHTML = "";
  for (const m of math.items) {
    const row = document.createElement("div");
    row.className = "math-row";
    row.innerHTML = `
      <input type="checkbox" ${m.visible ? "checked" : ""} data-id="${m.id}" />
      <span class="swatch" style="background:${m.color}"></span>
      <span>${m.name}</span>
      <button class="small" data-del="${m.id}">×</button>
    `;
    box.appendChild(row);
  }
  box.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener("change", () => {
      const item = math.items.find((x) => x.id === Number(el.dataset.id));
      if (item) item.visible = el.checked;
      scope.invalidate();
    });
  });
  box.querySelectorAll("[data-del]").forEach((el) => {
    el.addEventListener("click", () => {
      math.remove(Number(el.dataset.del));
      renderMathList();
      scope.invalidate();
    });
  });
}

function renderConsole() {
  const root = $("console-root");
  if (!root) return;

  const presets = document.createElement("div");
  presets.className = "console-section";
  presets.innerHTML = `<div class="panel-title" style="font-size:11px">预设命令</div>`;
  const grid = document.createElement("div");
  grid.className = "console-grid";
  for (const p of PRESET_COMMANDS) {
    const b = document.createElement("button");
    b.textContent = p.label;
    if (p.kind === "ok") b.classList.add("ok");
    if (p.kind === "warn") b.classList.add("danger");
    b.addEventListener("click", () => consoleCtl.run(p.cmd).catch((e) => terminal.appendText(String(e) + "\n", "err")));
    grid.appendChild(b);
  }
  presets.appendChild(grid);
  root.appendChild(presets);

  /* 参数辨识 — 会转动电机的按钮标 danger */
  const identSec = document.createElement("div");
  identSec.className = "console-section";
  identSec.innerHTML = `<div class="panel-title" style="font-size:11px">${t("ident.title")}</div>
    <p class="dash-ctrl-note" style="margin:0">${t("ident.note")}</p>`;
  const identGrid = document.createElement("div");
  identGrid.className = "console-grid";
  for (const ic of IDENT_COMMANDS) {
    const b = document.createElement("button");
    b.textContent = t(ic.key);
    if (ic.danger) b.classList.add("danger");
    b.title = ic.cmd;
    b.addEventListener("click", () => {
      if (ic.danger) {
        if (!confirm(`${t(ic.key)} — ${ic.cmd}\n${t("ident.note")}`)) return;
      }
      consoleCtl
        .run(ic.cmd)
        .then(() => {
          if (ic.cmd.startsWith("ident") && ic.cmd !== "ident show" && ic.cmd !== "ident apply") {
            terminal.appendText(`[sys] ${t("ident.busy")} — 完成后 Terminal 看 ident show\n`, "sys");
          }
        })
        .catch((e) => terminal.appendText(String(e) + "\n", "err"));
    });
    identGrid.appendChild(b);
  }
  identSec.appendChild(identGrid);
  root.appendChild(identSec);

  /* 无感闭环控制 — feedback 命令集合 */
  const fbSec = document.createElement("div");
  fbSec.className = "console-section";
  fbSec.innerHTML = `<div class="panel-title" style="font-size:11px">${t("fb.title")}</div>
    <p class="dash-ctrl-note" style="margin:0">${t("fb.note")}</p>`;
  const fbGrid = document.createElement("div");
  fbGrid.className = "console-grid";
  for (const fc of FEEDBACK_COMMANDS) {
    const b = document.createElement("button");
    b.textContent = t(fc.key);
    if (fc.danger) b.classList.add("danger");
    b.title = fc.cmd;
    b.addEventListener("click", () => {
      consoleCtl
        .run(fc.cmd)
        .catch((e) => terminal.appendText(String(e) + "\n", "err"));
    });
    fbGrid.appendChild(b);
  }
  fbSec.appendChild(fbGrid);
  root.appendChild(fbSec);

  /* 模式/目标统一在 Dashboard 快捷控制，控制台只保留自定义 CLI */
  const custom = document.createElement("div");
  custom.className = "console-section";
  custom.innerHTML = `<div class="panel-title" style="font-size:11px">${t("dash.ctrl.custom") || "自定义 CLI"}</div>`;
  const customRow = document.createElement("div");
  customRow.className = "console-row";
  customRow.innerHTML = `
    <input type="text" id="ctl-custom-label" placeholder="${t("dash.ctrl.custom.label") || "标签"}" style="width:80px" />
    <input type="text" id="ctl-custom-cmd" placeholder="CLI 命令" style="flex:1;min-width:120px" />
    <button id="ctl-custom-add">Add</button>
    <div id="ctl-custom-list" style="display:flex;flex-wrap:wrap;gap:6px;width:100%"></div>
  `;
  custom.appendChild(customRow);
  root.appendChild(custom);

  const wire = () => {
    $("ctl-custom-add").onclick = () => {
      const cmd = $("ctl-custom-cmd").value.trim();
      if (!cmd) return;
      consoleCtl.addCustom($("ctl-custom-label").value.trim() || cmd, cmd);
      $("ctl-custom-label").value = "";
      $("ctl-custom-cmd").value = "";
      renderConsole();
    };
    const list = $("ctl-custom-list");
    list.innerHTML = "";
    for (const c of consoleCtl.custom) {
      const wrap = document.createElement("span");
      wrap.style.cssText = "display:inline-flex;gap:4px;align-items:center";
      const b = document.createElement("button");
      b.className = "small";
      b.textContent = c.label;
      b.onclick = () => consoleCtl.run(c.cmd).catch((e) => terminal.appendText(String(e) + "\n", "err"));
      const x = document.createElement("button");
      x.className = "small";
      x.textContent = "×";
      x.onclick = () => {
        consoleCtl.removeCustom(c.id);
        renderConsole();
      };
      wrap.append(b, x);
      list.appendChild(wrap);
    }
  };
  wire();
}

function renderChannelList() {
  const box = $("channel-list");
  const lang = getLang();
  box.innerHTML = "";
  for (const ch of state.channels) {
    const label = channelLabel(ch.id, lang);
    const row = document.createElement("label");
    row.className = "ch-row ch-row-static";
    row.innerHTML = `
      <input type="checkbox" ${ch.visible ? "checked" : ""} data-id="${ch.id}" />
      <span class="swatch" style="background:${ch.color}"></span>
      <span class="ch-label" title="ch${ch.id} ${ch.name}">${label}</span>
      <span class="ch-val-live is-empty" data-ch-val="${ch.id}">—</span>
      <span class="ch-unit-static">${ch.unit || ""}</span>
    `;
    box.appendChild(row);
  }
  const sync = () => {
    saveChannels(state.channels);
    scope.setChannels(state.channels);
    dashboard.setChannels(state.channels);
    legend.setChannels(state.channels);
    fillChannelSelects();
    syncChannelMaskToDevice();
  };
  box.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener("change", () => {
      const ch = state.channels.find((c) => c.id === Number(el.dataset.id));
      if (ch) ch.visible = el.checked;
      sync();
    });
  });
  updateChannelValues();
}

/**
 * 高效批量刷新通道列表中的实时数值
 */
function updateChannelValues() {
  const box = $("channel-list");
  if (!box) return;
  const valSpans = box.querySelectorAll(".ch-val-live");
  for (let i = 0; i < valSpans.length; i++) {
    const span = valSpans[i];
    const chId = Number(span.dataset.chVal);
    const v = store.latest ? store.latest[chId] : NaN;
    if (Number.isFinite(v)) {
      span.textContent = formatValueCompact(v);
      span.classList.remove("is-empty");
    } else {
      span.textContent = "—";
      span.classList.add("is-empty");
    }
  }
}

function updateMeasures() {
  // 通道统计条已移除；保留函数占位避免其它引用报错
}

async function switchMode(next) {
  if (next === state.mode) return;
  if (state.mode === "serial") await serial.disconnect();
  if (sim) {
    sim.stop();
    sim = null;
  }
  if (replay) {
    replay.stop();
    replay = null;
  }
  state.mode = next;
  resetPipeline();

  if (state.mode === "sim") {
    const rate = Number($("sim-rate")?.value) || 1000;
    state.sampleRate = rate;
    scope.setSampleRate(rate);
    recorder.sampleRate = rate;
    sim = new SimulationSource({ rateHz: rate, onFrame: onSample });
    sim.start(rate);
    setStatusKey(rate >= 5000 ? "status.stress" : "status.sim", "sim");
    terminal.appendText(t("sys.sim", { rate }), "sys");
  } else if (state.mode === "replay") {
    if (replaySession?.sampleRate) {
      state.sampleRate = replaySession.sampleRate;
      scope.setSampleRate(replaySession.sampleRate);
      recorder.sampleRate = replaySession.sampleRate;
    }
    setStatusKey("status.replay", "sim");
    terminal.appendText(t("sys.replay"), "sys");
  } else {
    state.sampleRate = 500;
    scope.setSampleRate(state.sampleRate);
    recorder.sampleRate = state.sampleRate;
    setStatusKey("status.off", "off");
    terminal.appendText(t("sys.serial"), "sys");
  }
  applyModeUI();
}

/* ---------- header ---------- */

document.querySelectorAll('input[name="data-mode"]').forEach((r) => {
  r.addEventListener("change", () => {
    switchMode(r.value).catch((e) => terminal.appendText(`[sys] mode switch: ${e}\n`, "err"));
  });
});

function getBaudRate() {
  const sel = $("baud");
  if (sel && sel.value === "custom") {
    const v = Number($("baud-custom")?.value);
    return Number.isFinite(v) && v >= 300 && v <= 12000000 ? Math.round(v) : 6500000;
  }
  return Number(sel?.value) || 6500000;
}

$("baud")?.addEventListener("change", () => {
  const custom = $("baud").value === "custom";
  const inp = $("baud-custom");
  if (inp) {
    inp.hidden = !custom;
    if (custom) {
      inp.disabled = $("btn-connect").disabled;
      inp.focus();
    }
  }
});

$("btn-select-port")?.addEventListener("click", async () => {
  try {
    await serial.selectPort();
    terminal.appendText("[sys] 串口已选定，点击「打开串口」连接\n", "sys");
  } catch (e) {
    if (e.name !== "NotFoundError" && !e.message?.includes("cancel")) {
      terminal.appendText(`[sys] 选择串口失败: ${e.message || e}\n`, "err");
    }
  }
});

async function doConnect() {
  const baud = getBaudRate();
  try {
    setConnStatus(t("status.connecting"), "busy");
    await serial.connect(baud);
    resetPipeline();
    // 固件默认 16 kHz / 32 = 500 Hz WAVE 帧；之后以 ACK 回传的 effectiveRateHz 为准
    state.sampleRate = 500;
    scope.setSampleRate(state.sampleRate);
    recorder.sampleRate = state.sampleRate;
    terminal.appendText(`[sys] connected @ ${baud}\n`, "sys");
    applyModeUI();
    // 板上电打印与半帧残留：短暂静默后重置解复用
    setTimeout(() => {
      if (serial.state === SerialState.READING || serial.state === SerialState.CONNECTED) {
        decoder.reset();
        adapter.reset();
        if (wizard?.step === "device") wizard._readBoardInfo?.();
      }
    }, 250);
  } catch (e) {
    setConnStatus(t("status.error"), "err");
    terminal.appendText(`[sys] connect failed: ${e.message || e}\n`, "err");
    applyModeUI();
  }
}

async function doDisconnect() {
  await serial.disconnect();
  setConnStatus(t("status.off"), "off");
  terminal.appendText("[sys] disconnected\n", "sys");
  applyModeUI();
}

$("btn-toggle-port")?.addEventListener("click", async () => {
  if (serial.isConnected()) {
    await doDisconnect();
  } else {
    await doConnect();
  }
});

$("btn-connect")?.addEventListener("click", doConnect);

$("btn-reconnect")?.addEventListener("click", async () => {
  try {
    setConnStatus(t("status.connecting"), "busy");
    await serial.reconnect(getBaudRate() || 0);
    resetPipeline();
    state.sampleRate = 500;
    scope.setSampleRate(state.sampleRate);
    recorder.sampleRate = state.sampleRate;
    terminal.appendText(`[sys] reconnected @ ${serial.lastBaud}\n`, "sys");
    applyModeUI();
    setTimeout(() => {
      if (serial.state === SerialState.READING || serial.state === SerialState.CONNECTED) {
        decoder.reset();
        adapter.reset();
      }
    }, 150);
  } catch (e) {
    setConnStatus(t("status.error"), "err");
    terminal.appendText(`[sys] reconnect failed: ${e.message || e}\n`, "err");
    applyModeUI();
  }
});

$("btn-disconnect")?.addEventListener("click", doDisconnect);

$("btn-estop").addEventListener("click", async () => {
  try {
    if (state.mode === "serial") {
      await serial.writePriority("disable\r\n");
    } else {
      await consoleCtl.estop();
    }
    terminal.appendText(t("sys.estop_use"), "err");
  } catch (e) {
    terminal.appendText(`[sys] E-STOP failed: ${e.message || e}\n`, "err");
  }
});

serial.onState = (s) => {
  if (state.mode !== "serial") return;
  const map = {
    [SerialState.DISCONNECTED]: ["status.off", "off"],
    [SerialState.CONNECTING]: ["status.connecting", "busy"],
    [SerialState.CONNECTED]: ["status.connected", "ok"],
    [SerialState.READING]: ["status.connected", "ok"],
    [SerialState.DISCONNECTING]: ["status.disconnecting", "busy"],
    [SerialState.ERROR]: ["status.error", "err"],
  };
  const [key, cls] = map[s] || ["status.off", "off"];
  setStatusKey(key, cls);
  applyModeUI();

  if (s === SerialState.CONNECTED || s === SerialState.READING) {
    syncChannelMaskToDevice();
    const isScopeActive = $("panel-scope")?.classList.contains("active");
    if (isScopeActive) {
      setWaveStream(true);
    }
    // 连接建立后自动拉取一次板卡信息，初始化设备页与相关状态
    if (!state._initialBoardInfoRead) {
      state._initialBoardInfoRead = true;
      setTimeout(() => {
        wizard?._readBoardInfo?.().catch(() => {});
      }, 150);
    }
  } else if (s === SerialState.DISCONNECTED || s === SerialState.ERROR) {
    state._initialBoardInfoRead = false;
    const btn = $("btn-wave-toggle");
    state.waveActive = false;
    if (btn) {
      btn.classList.remove("is-on");
      btn.classList.add("is-off");
      btn.textContent = "Wave: OFF";
    }
  }
};

let idleFlushTimer = 0;
serial.onData = (bytes) => {
  state.bytesWindow += bytes.length;
  if ($("chk-raw").checked) terminal.feedRaw(bytes);
  adapter.feed(bytes);
  // 链路静默 40ms 后把不足一帧头长度的短 CLI 回复当作文本刷出
  if (idleFlushTimer) clearTimeout(idleFlushTimer);
  idleFlushTimer = setTimeout(() => {
    idleFlushTimer = 0;
    if (typeof decoder.flushIdle === "function") decoder.flushIdle();
  }, 40);
};

/* ---------- scope controls ---------- */

$("window-select").addEventListener("change", (e) => {
  state.windowSec = Number(e.target.value);
  scope.setWindowSec(state.windowSec);
});

scope.onWheelWindow = (sec) => {
  state.windowSec = sec;
};

$("btn-pause").addEventListener("click", () => {
  const p = !scope.paused;
  scope.setPaused(p);
  $("btn-pause").textContent = p ? t("resume") : t("pause");
  $("btn-pause").classList.toggle("active", p);
});

$("btn-clear").addEventListener("click", () => {
  store.clear();
  if (sim) sim.reset();
  if (typeof decoder.resetSampleIndex === "function") {
    decoder.resetSampleIndex();
  }
  trigger.disarm();
  scope.invalidate();
});

$("btn-clear-cursors").addEventListener("click", () => scope.clearCursors());

/* ---- 示波器高级设置抽屉切换 (Y轴量程/触发/导出) ---- */
$("btn-scope-settings")?.addEventListener("click", () => {
  const drawer = $("scope-drawer");
  const btn = $("btn-scope-settings");
  if (!drawer) return;
  const isHidden = drawer.hidden;
  drawer.hidden = !isHidden;
  btn?.classList.toggle("is-active", isHidden);
});

/* ---- 示波器控制浮窗：顶栏内联按钮 + 下拉面板（兼容旧悬浮拖拽） ---- */
(() => {
  const fab = $("scope-fab");
  const panel = $("scope-fab-panel");
  if (!panel) return;

  const MODE_CMD = { vf: "vf", iq: "iq", vel: "vel", pos: "pos" };
  const TARGET_META = {
    vf: { label: "RPM", step: 10 },
    iq: { label: "A", step: 0.1 },
    vel: { label: "RPM", step: 10 },
    pos: { label: "rad", step: 0.01 },
  };

  const modeSel = $("fab-mode");
  const target = $("fab-target");
  const targetLabel = $("fab-target-label");

  const applyMeta = () => {
    const m = modeSel?.value || "vf";
    const meta = TARGET_META[m] || TARGET_META.vf;
    if (targetLabel) targetLabel.textContent = meta.label;
    if (target) {
      target.step = String(meta.step);
      target.setAttribute("aria-label", meta.label);
    }
  };
  modeSel?.addEventListener("change", () => {
    applyMeta();
    const m = modeSel.value;
    if (MODE_CMD[m]) consoleCtl.run(`mode ${MODE_CMD[m]}`).catch((e) => terminal.appendText(`${e.message || e}\n`, "err"));
  });
  fabSyncMode = (id) => {
    if (modeSel && MODE_CMD[id] && modeSel.value !== id) {
      modeSel.value = id;
      applyMeta();
    }
  };
  applyMeta();

  const setOpen = (open) => {
    if (!panel) return;
    panel.hidden = !open;
    fab?.classList.toggle("is-open", open);
  };

  // 控制项常驻顶栏一行，不再单独收成下方控制条
  setOpen(true);

  const send = (cmd) => consoleCtl.run(cmd).catch(() => {});
  $("fab-send")?.addEventListener("click", () => {
    const m = modeSel?.value || "vel";
    const v = Number(target?.value);
    if (!Number.isFinite(v)) return;
    send(m === "vf" ? `rpm ${v}` : `target ${v}`);
  });
  $("fab-enable")?.addEventListener("click", () => send("enable"));
  $("fab-disable")?.addEventListener("click", () => send("disable"));
  const closeBtn = $("scope-fab-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(false);
    });
  }
})();

/* 波形右键菜单：复制图片 / 另存 PNG / 导出 CSV（替代配置条导出按钮） */
(() => {
  const menu = $("scope-ctx-menu");
  const wrap = document.querySelector(".scope-canvas-wrap");
  const canvas = $("scope-canvas");
  if (!menu || !wrap || !canvas) return;

  const hide = () => {
    menu.hidden = true;
  };

  const showAt = (x, y) => {
    const r = wrap.getBoundingClientRect();
    menu.hidden = false;
    const mw = menu.offsetWidth || 148;
    const mh = menu.offsetHeight || 120;
    let left = x - r.left;
    let top = y - r.top;
    if (left + mw > r.width - 4) left = Math.max(4, r.width - mw - 4);
    if (top + mh > r.height - 4) top = Math.max(4, r.height - mh - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };

  wrap.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showAt(e.clientX, e.clientY);
  });

  document.addEventListener("pointerdown", (e) => {
    if (!menu.contains(e.target)) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });

  const stamp = () => Date.now();

  async function copyPng() {
    const blob = await scope.toPngBlob();
    if (!blob) return;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `foc-studio-${stamp()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `foc-studio-${stamp()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function savePng() {
    scope.toPngBlob().then((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `foc-studio-${stamp()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function exportCsv() {
    const n = store.length;
    if (n < 1) {
      alert("暂无数据");
      return;
    }
    const take = Math.min(n, Math.floor(state.windowSec * state.sampleRate));
    const header = ["time_s", ...state.channels.map((c) => c.name)].join(",");
    const parts = [header];
    const row = new Array(CHANNEL_COUNT + 1);
    for (let i = n - take; i < n; i++) {
      const s = store.sampleAt(i);
      if (!s) continue;
      row[0] = (s.sampleIndex / state.sampleRate).toFixed(6);
      for (let c = 0; c < CHANNEL_COUNT; c++) {
        const v = s.values[c];
        row[c + 1] = Number.isFinite(v) ? v.toFixed(6) : "NaN";
      }
      parts.push(row.join(","));
    }
    downloadText(`foc-scope-${stamp()}.csv`, parts.join("\n"), "text/csv");
  }

  menu.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    hide();
    if (act === "copy") await copyPng();
    else if (act === "png") savePng();
    else if (act === "csv") exportCsv();
  });
})();

/* 兼容：若 HTML 仍含旧导出按钮则绑定（新布局已移除） */
const _btnPng = $("btn-png");
if (_btnPng) {
  _btnPng.addEventListener("click", async () => {
    const blob = await scope.toPngBlob();
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `foc-studio-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

$("chk-autoscale")?.addEventListener("change", (e) => {
  const on = e.target.checked;
  scope.setAutoScale(on);
  $("y-min").disabled = on;
  $("y-max").disabled = on;
  if (!on) scope.setYRange(Number($("y-min").value), Number($("y-max").value));
});
$("y-min")?.addEventListener("change", () => {
  if (!scope.autoScale) scope.setYRange(Number($("y-min").value), Number($("y-max").value));
});
$("y-max")?.addEventListener("change", () => {
  if (!scope.autoScale) scope.setYRange(Number($("y-min").value), Number($("y-max").value));
});

const _btnCsv = $("btn-csv");
if (_btnCsv) {
  _btnCsv.addEventListener("click", () => {
    const n = store.length;
    if (n < 1) {
      alert("暂无数据");
      return;
    }
    const take = Math.min(n, Math.floor(state.windowSec * state.sampleRate));
    const header = ["time_s", ...state.channels.map((c) => c.name)].join(",");
    const parts = [header];
    const row = new Array(CHANNEL_COUNT + 1);
    for (let i = n - take; i < n; i++) {
      const s = store.sampleAt(i);
      if (!s) continue;
      row[0] = (s.sampleIndex / state.sampleRate).toFixed(6);
      for (let c = 0; c < CHANNEL_COUNT; c++) {
        const v = s.values[c];
        row[c + 1] = Number.isFinite(v) ? v.toFixed(6) : "NaN";
      }
      parts.push(row.join(","));
    }
    downloadText(`foc-studio-${Date.now()}.csv`, parts.join("\n"), "text/csv");
  });
}

/* trigger UI */
$("trig-mode").addEventListener("change", (e) => {
  const m = e.target.value;
  trigger.configure({ mode: m });
  if (m === TriggerMode.OFF) trigger.disarm();
});
$("trig-src").addEventListener("change", (e) => trigger.configure({ source: Number(e.target.value) }));
$("trig-edge").addEventListener("change", (e) => trigger.configure({ edge: e.target.value }));
$("trig-level").addEventListener("change", (e) => trigger.configure({ level: Number(e.target.value) }));
$("btn-trig-arm").addEventListener("click", () => {
  trigger.configure({
    mode: $("trig-mode").value,
    source: Number($("trig-src").value),
    edge: $("trig-edge").value,
    level: Number($("trig-level").value),
    windowPoints: Math.floor(state.windowSec * state.sampleRate),
  });
  if (trigger.mode === TriggerMode.OFF) {
    $("trig-mode").value = TriggerMode.NORMAL;
    trigger.configure({ mode: TriggerMode.NORMAL });
  }
  trigger.arm();
  recordLog(`TRIG armed level=${trigger.level} edge=${trigger.edge}`);
});
$("btn-trig-release").addEventListener("click", () => {
  trigger.disarm();
  scope.invalidate();
});

/* math */
$("btn-math-add").addEventListener("click", () => {
  const op = $("math-op").value;
  const a = Number($("math-a").value);
  const b = Number($("math-b").value);
  math.add(op, a, b);
  renderMathList();
  scope.invalidate();
});

/* channel presets — FOC-STP 32 通道常用组合 (硬件单帧最大 16 通道) */
const CHANNEL_PRESETS = {
  current: [1, 4, 5, 6, 13, 14], // iq_raw, id_filt, iq_filt, iq_ref, id_raw, id_ref
  velocity: [2, 3, 15, 30], // vel_ctrl, vel_ref, vel_raw, vel_err
  voltage: [7, 8, 12, 18, 19, 26], // vd, vq, duty_a, duty_b, duty_c, vbus_fast
  sensorless: [20, 21, 22, 23, 24], // obs_theta, obs_speed, obs_err, obs_conf, obs_flux
  all: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // 核心前 16 通道
  none: [],
};

let maskSyncTimer = null;
function syncChannelMaskToDevice() {
  if (state.mode !== "serial" || !serial.isConnected()) return;
  const curGen = serial.generation;
  if (maskSyncTimer) clearTimeout(maskSyncTimer);
  maskSyncTimer = setTimeout(() => {
    if (state.mode !== "serial" || !serial.isConnected() || serial.generation !== curGen) return;
    let mask = 0;
    let count = 0;
    const dropped = [];
    // 仪表盘依赖的通道强制订阅（用户未勾选时也下发）
    const essential = [2, 5, 26, 17]; // vel, iq_filt, vbus_fast, position
    for (const id of essential) {
      if ((mask & (1 << id)) === 0) {
        mask |= (1 << id);
        count++;
      }
    }
    for (const ch of state.channels) {
      if (!ch.visible) continue;
      if (count < 16) {
        mask |= (1 << ch.id);
        count++;
      } else {
        dropped.push(ch.id);
      }
    }
    if (dropped.length) {
      // 固件对 >16 路掩码整体拒绝（ACK LIMITED，保持旧掩码），所以本地只下发前 16 路并明确告知
      terminal.appendText(
        `[warn] 单帧最多 16 路，仅下发前 16 路；未订阅: ch${dropped.join(", ch")}（波形显示为断线）\r\n`,
        "rx"
      );
    }
    const hexMask = "0x" + (mask >>> 0).toString(16).toUpperCase();
    consoleCtl.run(`telem mask ${hexMask}`).catch(() => {});
  }, 150);
}

function applyChannelPreset(key) {
  const set = new Set(CHANNEL_PRESETS[key] || []);
  for (const ch of state.channels) ch.visible = set.has(ch.id);
  saveChannels(state.channels);
  scope.setChannels(state.channels);
  dashboard.setChannels(state.channels);
  legend.setChannels(state.channels);
  renderChannelList();
  fillChannelSelects();
  scope.invalidate();
  syncChannelMaskToDevice();
}

/** 通道列表：全开 / 全关（硬件单帧最多 16 路，超出由 mask 同步裁剪） */
function setAllChannelsVisible(on) {
  for (const ch of state.channels) ch.visible = !!on;
  saveChannels(state.channels);
  scope.setChannels(state.channels);
  dashboard.setChannels(state.channels);
  legend.setChannels(state.channels);
  renderChannelList();
  fillChannelSelects();
  scope.invalidate();
  syncChannelMaskToDevice();
}

$("btn-ch-all")?.addEventListener("click", () => setAllChannelsVisible(true));
$("btn-ch-none")?.addEventListener("click", () => setAllChannelsVisible(false));

document.querySelectorAll("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => applyChannelPreset(btn.dataset.preset));
});

/* cursor readout：单游标，显示当前时刻各通道 Y 值 */
scope.onCursor = (info) => {
  const el = $("cursor-readout");
  if (!info) {
    el.textContent = "—";
    return;
  }
  const parts = info.samples.map(
    (s) =>
      `<span style="color:${s.color}">${s.name}</span> ${Number.isFinite(s.value) ? s.value.toFixed(3) : "—"}${s.unit ? " " + s.unit : ""}`
  );
  el.innerHTML = `t=${info.t.toFixed(3)}s&nbsp;&nbsp;${parts.join("&nbsp;&nbsp;")}`;
};

/* terminal extras */
$("chk-autoscroll").addEventListener("change", (e) => {
  terminal.autoScroll = e.target.checked;
});
$("chk-raw").addEventListener("change", (e) => {
  terminal.rawMode = e.target.checked;
  $("term-raw").hidden = !e.target.checked;
});
$("btn-term-clear").addEventListener("click", () => {
  terminal.clear();
  $("term-raw").textContent = "";
});

/* record / replay — UI 已隐藏时元素可能不存在 */
$("btn-record")?.addEventListener("click", () => {
  recorder.sampleRate = state.sampleRate;
  const on = recorder.toggle();
  $("btn-record").textContent = on ? t("rec.stop") : t("rec.start");
  $("btn-record").classList.toggle("active", on);
  const st = $("record-status");
  if (st) {
    st.textContent = on ? "RECORDING" : `SAVED ${recorder.count}`;
    st.className = `status-pill ${on ? "err" : "ok"}`;
  }
  recordLog(on ? "record start" : `record stop count=${recorder.count}`);
});

$("btn-mark")?.addEventListener("click", () => {
  const m = recorder.mark($("mark-text")?.value?.trim() || undefined);
  if (m) recordLog(`mark @ ${m.sampleIndex}: ${m.text}`);
  else recordLog("mark ignored (not recording or empty)");
});

$("btn-save-csv")?.addEventListener("click", () => {
  if (!recorder.count) {
    alert("无录制数据");
    return;
  }
  downloadText(`foc-session-${Date.now()}.csv`, recorder.toCsv(state.channels), "text/csv");
  recordLog(`export CSV ${recorder.count} frames`);
});

$("btn-save-json")?.addEventListener("click", () => {
  if (!recorder.count) {
    alert("无录制数据");
    return;
  }
  downloadText(`foc-session-${Date.now()}.json`, recorder.toJson(state.channels), "application/json");
  recordLog(`export JSON ${recorder.count} frames marks=${recorder.marks.length}`);
});

$("btn-load-csv")?.addEventListener("click", () => $("file-csv")?.click());
$("file-csv")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const parsed = parseCsv(text);
  const detectedRate = parsed.sampleRate || state.sampleRate || 1000;
  replaySession = {
    sampleRate: detectedRate,
    frames: parsed.frames.map((f) => ({
      t: Math.round(f.t * detectedRate),
      v: f.v,
      timeMs: f.timeMs,
    })),
  };
  recordLog(`loaded CSV frames=${replaySession.frames.length} detectedRate=${detectedRate}Hz`);
  e.target.value = "";
});

$("btn-replay")?.addEventListener("click", async () => {
  if (!replaySession || !replaySession.frames.length) {
    alert("先 Load CSV");
    return;
  }
  await switchMode("replay");
  store.clear();
  replay = new ReplaySource(replaySession, onSample);
  replay.start(replaySession.sampleRate);
  recordLog(`replay started @ ${replaySession.sampleRate}Hz`);
});

$("btn-replay-stop")?.addEventListener("click", () => {
  if (replay) replay.stop();
  recordLog("replay stopped");
});

$("sim-rate")?.addEventListener("change", () => {
  if (state.mode !== "sim" || !sim) return;
  const rate = Number($("sim-rate").value) || 1000;
  state.sampleRate = rate;
  scope.setSampleRate(rate);
  recorder.sampleRate = rate;
  sim.stop();
  sim.start(rate);
  setConnStatus(rate >= 5000 ? "SIM STRESS" : "SIMULATION", "sim");
  recordLog(`sim rate → ${rate} Hz`);
});

/* keyboard — 1–5 对应侧栏前五步（向导主路径） */
const PANEL_HOTKEYS = {
  "1": '[data-panel="wf"][data-step="device"]',
  "2": '[data-panel="wf"][data-step="motor"]',
  "3": '[data-panel="wf"][data-step="encoder"]',
  "4": '[data-panel="wf"][data-step="pid"]',
  "5": '[data-panel="wf"][data-step="run"]',
};

window.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
  if (e.code === "Space") {
    e.preventDefault();
    $("btn-pause").click();
  } else if (e.key === "r" || e.key === "R") {
    $("btn-clear").click();
  } else if (PANEL_HOTKEYS[e.key]) {
    document.querySelector(PANEL_HOTKEYS[e.key])?.click();
  } else if (e.key === "e" || e.key === "E") {
    $("btn-estop").click();
  }
});

/* nav — 底栏：左侧全局统计/快捷键，右侧随面板切换的操作提示 */
const STEP_HINT_KEY = { run: "console" };

function updateFooterHint(panel, step) {
  const el = $("footer-page-hint");
  if (!el) return;
  const p = panel || "wf";
  let key;
  if (p === "wf") {
    const s = step || "device";
    key = `hint.${STEP_HINT_KEY[s] || s}`;
  } else {
    key = `hint.${p}`;
  }
  el.textContent = t(key);
}

function refreshFooterHint() {
  const btn = document.querySelector(".nav-btn.active");
  updateFooterHint(btn?.dataset.panel || "wf", btn?.dataset.step);
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const prevPanel = document.querySelector(".panel.active")?.id?.replace("panel-", "");
    const targetPanel = btn.dataset.panel;

    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    const panel = $(`panel-${targetPanel}`);
    if (panel) panel.classList.add("active");

    if (targetPanel === "scope") {
      scope._resize();
      setWaveStream(true);
    } else if (prevPanel === "scope") {
      setWaveStream(false);
    }

    if (targetPanel === "console") renderConsole();
    if (targetPanel === "expert" && expertPanel) {
      expertPanel.querySensorlessStatus();
    }
    if (targetPanel === "wf") {
      const step = btn.dataset.step;
      if (step) {
        wizard.setStep(step);
        document.querySelectorAll('.nav-btn[data-panel="wf"]').forEach((b) => {
          b.classList.toggle("active", b.dataset.step === step);
        });
        btn.classList.add("active");
        updateFooterHint("wf", step);
      }
    } else {
      updateFooterHint(targetPanel);
    }
  });
});

updateFooterHint("device", "device");

/* 波形流手动开关按钮 */
$("btn-wave-toggle")?.addEventListener("click", () => {
  setWaveStream(!state.waveActive);
});

/* 侧边栏折叠/展开 */
const bodyEl = document.querySelector(".body");
const btnToggleSidebar = $("btn-toggle-sidebar");
const LS_SIDEBAR_KEY = "foc-studio-nav-collapsed";

function setSidebarCollapsed(collapsed) {
  if (!bodyEl) return;
  bodyEl.classList.toggle("nav-collapsed", !!collapsed);
  btnToggleSidebar?.classList.toggle("active", !!collapsed);
  const tipEl = btnToggleSidebar?.querySelector(".toggle-tooltip");
  if (tipEl) {
    tipEl.textContent = collapsed ? t("nav.expand") : t("nav.collapse");
  }
  try {
    localStorage.setItem(LS_SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
  // 折叠变更后重新计算示波器和仪表盘尺寸
  setTimeout(() => {
    scope?._resize();
    dashboard?.resizeGauges();
  }, 240);
}

// 初始化读取持久化状态
try {
  if (localStorage.getItem(LS_SIDEBAR_KEY) === "1") {
    setSidebarCollapsed(true);
  }
} catch {
  /* ignore */
}

btnToggleSidebar?.addEventListener("click", () => {
  const isCollapsed = bodyEl?.classList.contains("nav-collapsed");
  setSidebarCollapsed(!isCollapsed);
});

/* stats */
setInterval(() => {
  const now = performance.now();
  const dt = (now - state.lastStats) / 1000;
  if (dt < 0.25) return;
  $("stat-rx").textContent = `${(state.bytesWindow / dt / 1000).toFixed(1)} kB/s`;
  $("stat-fps").textContent = `${(state.framesWindow / dt).toFixed(0)} fps`;
  $("stat-frames").textContent = `${store.framesTotal}`;
  $("stat-desync").textContent = `${decoder.desync}`;
  $("stat-mode").textContent = state.mode.toUpperCase();
  state.framesWindow = 0;
  state.bytesWindow = 0;
  state.lastStats = now;
  if ($("chk-raw").checked) $("term-raw").textContent = terminal.renderRaw().slice(-2000);
  if ($("panel-scope").classList.contains("active")) {
    updateChannelValues();
  }
  const empty = $("scope-empty");
  if (empty) empty.hidden = store.length > 2;
}, 400);

/* boot — 任一异常都要可见，否则整页“点不动” */
function showBootError(err) {
  console.error(err);
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:fixed;inset:auto 8px 8px 8px;z-index:9999;background:#3d1117;color:#ffb4b4;border:1px solid #f85149;border-radius:8px;padding:10px 12px;font:12px ui-monospace,monospace;white-space:pre-wrap";
  bar.textContent = `FOC Studio boot failed:\n${err && err.stack ? err.stack : err}`;
  document.body.appendChild(bar);
  const empty = document.getElementById("scope-empty");
  if (empty) {
    empty.hidden = false;
    empty.textContent = "启动失败，请查看底部红条";
  }
}

function localizeFabModeOptions() {
  const sel = $("fab-mode");
  if (!sel) return;
  const map = { vf: t("mode.vf.short"), iq: t("mode.iq.short"), vel: t("mode.vel.short"), pos: t("mode.pos.short") };
  [...sel.options].forEach((o) => {
    if (map[o.value]) o.textContent = map[o.value];
  });
}

try {
  applyI18n();
  localizeFabModeOptions();
  const langSel = $("lang-select");
  if (langSel) {
    langSel.value = getLang();
    langSel.addEventListener("change", () => {
      setLang(langSel.value);
      applyI18n();
      localizeFabModeOptions();
      $("btn-pause").textContent = scope.paused ? t("resume") : t("pause");
      const tipEl = btnToggleSidebar?.querySelector(".toggle-tooltip");
      const isCollapsed = bodyEl?.classList.contains("nav-collapsed");
      if (tipEl) {
        tipEl.textContent = isCollapsed ? t("nav.expand") : t("nav.collapse");
      }
      renderChannelList();
      fillChannelSelects();
      dashboard.setChannels(state.channels);
      legend.setChannels(state.channels);
      renderConsole();
      // 向导 HTML 由 t() 生成，必须重绘才能切语言
      wizard.setStep(wizard.step);
      refreshFooterHint();
      const rateNow = Number($("sim-rate")?.value) || 1000;
      if (state.mode === "sim") setStatusKey(rateNow >= 5000 ? "status.stress" : "status.sim", "sim");
      applyModeUI();
      terminal.appendText(`[sys] lang → ${getLang()}\n`, "sys");
    });
  }

  scope.setSampleRate(state.sampleRate);
  scope.setWindowSec(state.windowSec);
  renderChannelList();
  fillChannelSelects();
  renderMathList();
  renderConsole();
  scope.start();
  dashboard.start();
  legend.start();
  applyModeUI();
  setConnStatus(t("status.off"), "off");

  if (!SerialTransport.supported()) {
    terminal.appendText(t("sys.noserial"), "err");
  } else {
    terminal.appendText(t("sys.boot"), "sys");
  }

  switchMode("serial").catch(showBootError);
} catch (err) {
  showBootError(err);
}
