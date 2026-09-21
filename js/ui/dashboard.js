/**
 * Dashboard v0.3.2：表盘 + 控制滑条 + 分组读数。
 * 控制滑条映射 CLI（target / rpm），不读 MCU 参数回读。
 */

import { formatValue, channelLabel } from "../channels.js";
import { faultTextUi, decodeFault } from "./fault.js";
import { getLang, t } from "../i18n.js";
import { Gauge } from "./gauge.js";
import { RotorGauge } from "./rotor.js";
import { MODE_CONTROLS, IQ_UI_LIMIT_DEFAULT, RPM_UI_LIMIT_DEFAULT } from "./console.js";

const MODE_LIST = [
  { id: "vf", key: "mode.vf" },
  { id: "iq", key: "mode.iq" },
  { id: "vel", key: "mode.vel" },
  { id: "pos", key: "mode.pos" },
];

/** 固件 foc_mode_t → UI id */
const MODE_IDS = ["vf", "iq", "vel", "pos"];
/** 固件 foc_state_t */
const STATE_NAMES = ["IDLE", "RUN", "CALIB", "FAULT"];

export class Dashboard {
  /**
   * @param {HTMLElement} root
   * @param {import('../data/telemetry-store.js').TelemetryStore} store
   * @param {Array} channels
   * @param {{send?:(cmd:string)=>Promise<void>|void}} [opts]
   */
  constructor(root, store, channels, opts = {}) {
    this.root = root;
    this.store = store;
    this.channels = channels;
    this.send = opts.send || null;
    this._timer = null;
    this.gauges = {};
    this.rotor = null;
    this._cells = new Map();
    this._lastStatus = null;
    this._lastStatusTime = 0;
    this._mode = "vf"; // 与固件上电默认 FOC_MODE_OPENLOOP_VF 对齐；STATUS 到达后再反同步
    this._posSem = "rel"; /* pos: rel | abs | step */
    this._iqLimit = IQ_UI_LIMIT_DEFAULT;
    this._rpmLimit = RPM_UI_LIMIT_DEFAULT;
    this.isConnected = opts.isConnected || (() => true);
    this._build();
  }

  /** 板载电流软限下发后，收紧电流环滑条范围 */
  setIqLimit(amps) {
    const a = Number(amps);
    if (!Number.isFinite(a) || a <= 0) return;
    this._iqLimit = Math.min(a, 20);
    if (typeof this._applyModeMetaHook === "function") this._applyModeMetaHook();
  }

  /** 板卡/电机最大转速下发后，收紧速度环滑条范围 */
  setMaxRpm(rpm) {
    const r = Number(rpm);
    if (!Number.isFinite(r) || r <= 0) return;
    // 合理上限保护：不因错误回显放大到离谱值
    this._rpmLimit = Math.min(Math.round(r), 30000);
    if (typeof this._applyModeMetaHook === "function") this._applyModeMetaHook();
  }

  _gate() {
    if (!this.isConnected || this.isConnected()) return true;
    const err = new Error("disconnected");
    err.needConnect = true;
    return false;
  }

  setChannels(channels) {
    this.channels = channels;
    this._build();
  }

  setSend(send) {
    this.send = send;
  }

  _build() {
    this.root.innerHTML = "";
    this._cells.clear();
    for (const g of Object.values(this.gauges)) {
      if (g && g.destroy) g.destroy();
    }
    this.gauges = {};
    if (this.rotor) {
      this.rotor.destroy();
      this.rotor = null;
    }

    /* 状态 chips：挂在控制台卡片头右侧（#dash-chips-host），与标题同一行 */
    this.strip = document.createElement("div");
    this.strip.className = "dash-chips";
    this.strip.innerHTML = `
      <span class="chip chip-fault" data-strip="fault">${t("dash.fault")} —</span>
      <span class="chip" data-strip="state">${t("dash.state")} —</span>
      <span class="chip" data-strip="mode">${t("dash.mode")} —</span>
    `;
    const chipsHost = document.getElementById("dash-chips-host");
    if (chipsHost) {
      chipsHost.innerHTML = "";
      chipsHost.appendChild(this.strip);
    } else {
      this.root.appendChild(this.strip);
    }

    /* 左：转子盘（全程）  右：上三表盘 / 下运行控制 */
    const mid = document.createElement("div");
    mid.className = "dash-mid";

    this.rotorWrap = document.createElement("div");
    this.rotorWrap.className = "dash-rotor";
    this.rotorWrap.innerHTML = `<div class="dash-rotor-host"></div>`;
    mid.appendChild(this.rotorWrap);

    const right = document.createElement("div");
    right.className = "dash-right";

    this.gaugeWrap = document.createElement("div");
    this.gaugeWrap.className = "dash-gauges";
    const gdefs = [
      { id: "rpm", label: t("dash.rpm"), unit: "rpm", min: 0, max: 5000, color: "#7fd962", digits: 0 },
      { id: "iq", label: "Iq", unit: "A", min: -5, max: 5, color: "#ff9f43", digits: 2 },
      { id: "vbus", label: t("dash.vbus"), unit: "V", min: 0, max: 25, color: "#58a6ff", digits: 1 },
    ];
    for (const d of gdefs) {
      const box = document.createElement("div");
      box.className = "dash-gauge";
      box.setAttribute("data-gauge", d.id);
      const cv = document.createElement("canvas");
      box.appendChild(cv);
      this.gaugeWrap.appendChild(box);
      this.gauges[d.id] = new Gauge(cv, d);
    }
    right.appendChild(this.gaugeWrap);

    /* 专属模式驾驶舱核心指标组 (Cockpit KPI Deck) */
    this.kpiDeck = document.createElement("div");
    this.kpiDeck.className = "dash-kpi-deck";
    this.kpiDeck.id = "dash-kpi-deck";
    for (let i = 0; i < 4; i++) {
      const card = document.createElement("div");
      card.className = "dash-kpi-card";
      card.setAttribute("data-kpi-idx", String(i));
      card.innerHTML = `
        <span class="dash-kpi-label" data-kpi="label">—</span>
        <span class="dash-kpi-val" data-kpi="val">—</span>
        <span class="dash-kpi-sub" data-kpi="sub"></span>
      `;
      this.kpiDeck.appendChild(card);
    }
    right.appendChild(this.kpiDeck);

    /* 右下：运行控制 — 仅合并「目标 + 快捷值」为一排，交互保持 HEAD */
    const ctrl = document.createElement("div");
    ctrl.className = "dash-ctrl";
    ctrl.innerHTML = `
      <div class="dash-ctrl-head">
        <h3 class="dash-group-title">
          <svg class="wf-ico" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.5"/><polygon points="6.5,5 11,8 6.5,11" fill="currentColor" stroke="none"/></svg>
          <span>${t("dash.ctrl.title")}</span>
        </h3>
        <span class="dash-mode-badge" id="dash-mode-badge">—</span>
      </div>
      <div class="dash-ctrl-row dash-mode-row">
        <label for="dash-mode">${t("dash.ctrl.mode")}</label>
        <select id="dash-mode" class="dash-mode-select">
          ${MODE_LIST.map((m) => `<option value="${m.id}">${t(m.key)}</option>`).join("")}
        </select>
      </div>
      <p class="dash-mode-desc" id="dash-mode-desc"></p>
      <div class="dash-target-block" id="dash-target-row">
        <div class="dash-target-main">
          <span class="dash-target-lbl">
            ${t("dash.ctrl.target")}
            <span id="dash-target-label" class="dash-unit-tag">RPM</span>
          </span>
          <span class="slider-wrap dash-target-slider">
            <input type="range" id="dash-target-range" min="-8000" max="8000" step="10" value="0" />
            <span class="slider-zero" title="0" aria-hidden="true">
              <span class="slider-zero-tick"></span>
              <span class="slider-zero-label">0</span>
            </span>
          </span>
          <input type="number" id="dash-target-num" class="dash-target-num" min="-8000" max="8000" step="10" value="0" />
        </div>
        <div class="dash-presets dash-target-presets" id="dash-presets"></div>
      </div>
      <div class="dash-pos-card" id="dash-pos-card" hidden>
        <div class="dash-pos-head">
          <span class="dash-pos-title">${t("pos.sem.title")}</span>
          <div class="dash-pos-seg" role="radiogroup" aria-label="position semantic">
            <button type="button" class="is-active" data-pos-sem="rel">${t("pos.mode_rel")}</button>
            <button type="button" data-pos-sem="abs">${t("pos.mode_abs")}</button>
            <button type="button" data-pos-sem="step">${t("pos.mode_step")}</button>
          </div>
        </div>
        <div class="dash-pos-row" id="dash-pos-step-row" hidden>
          <label>${t("pos.step_label")}</label>
          <input type="number" id="dash-pos-step-val" step="0.01" value="0.175" min="-20" max="20" />
          <span class="dash-unit-tag">rad</span>
          <button type="button" class="small ok" id="dash-pos-step-go">${t("pos.step_btn")}</button>
        </div>
        <div class="dash-pos-row dash-pos-jog">
          <span class="dash-pos-jog-lbl">${t("pos.jog")}</span>
          <button type="button" class="small dash-jog-btn" data-jog-deg="-90">-90°</button>
          <button type="button" class="small dash-jog-btn" data-jog-deg="-45">-45°</button>
          <button type="button" class="small dash-jog-btn" data-jog-deg="-10">-10°</button>
          <button type="button" class="small dash-jog-btn" data-jog-deg="10">+10°</button>
          <button type="button" class="small dash-jog-btn" data-jog-deg="45">+45°</button>
          <button type="button" class="small dash-jog-btn" data-jog-deg="90">+90°</button>
          <button type="button" class="small ok" id="dash-pos-zero">${t("pos.set_zero")}</button>
        </div>
        <p class="dash-pos-note" id="dash-pos-note"></p>
      </div>
      <div class="dash-ctrl-row" id="dash-vf-row" hidden>
        <label>Vq <span class="dash-unit-tag">V</span></label>
        <input type="number" id="dash-vq-num" min="0" max="12" step="0.1" value="0.5" style="width:80px" />
        <button class="small" id="dash-vq-send">${t("dash.ctrl.send")}</button>
      </div>
      <div class="dash-ctrl-actions">
        <button class="ok" id="dash-enable">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><polygon points="4,3 13,8 4,13"/></svg>
          <span>${t("dash.ctrl.enable")}</span>
        </button>
        <button class="danger" id="dash-disable">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>
          <span>${t("dash.ctrl.disable")}</span>
        </button>
        <button id="dash-fault">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11.5h.01"/></svg>
          <span>${t("wf.safety.fault")}</span>
        </button>
      </div>
      <p class="dash-ctrl-note">${t("dash.ctrl.note")}</p>
    `;
    right.appendChild(ctrl);
    mid.appendChild(right);
    this.root.appendChild(mid);

    this._wireCtrl();
  }

  _wireCtrl() {
    const range = this.root.querySelector("#dash-target-range");
    const num = this.root.querySelector("#dash-target-num");
    const modeSel = this.root.querySelector("#dash-mode");
    const targetLabel = this.root.querySelector("#dash-target-label");
    const targetRow = this.root.querySelector("#dash-target-row");
    const vfRow = this.root.querySelector("#dash-vf-row");
    const presetBox = this.root.querySelector("#dash-presets");
    const modeDesc = this.root.querySelector("#dash-mode-desc");
    let mode = this._mode || "vf"; // 固件上电默认 FOC_MODE_OPENLOOP_VF

    const PRESETS = {
      vel: [0, 300, 1000, 2500, -1000, -2500],
      iq: [0, 0.5, 1.0, 2.0, -0.5, -1.0],
      pos: [0, 1.57, 3.14, 6.28, -1.57, -3.14, -6.28],
      vf: [0, 200, 500, 1000, 2000, -1000],
    };

    const setVizMode = () => {
      // 转子全程显示；确保已实例化（测试环境可能无 SVG API）
      if (!this.rotor && typeof document !== "undefined" && document.createElementNS) {
        const host = this.rotorWrap?.querySelector(".dash-rotor-host");
        if (host) {
          try {
            this.rotor = new RotorGauge(host);
          } catch {
            this.rotor = null;
          }
        }
      }
      // 模式侧重：驾驶舱整体布局、表盘顺序与高亮
      const mid = this.root.querySelector(".dash-mid");
      if (mid) mid.setAttribute("data-cockpit-mode", mode);

      const wrap = this.gaugeWrap;
      if (!wrap) return;
      wrap.setAttribute("data-mode", mode);
      const order =
        mode === "iq" ? ["iq", "vbus", "rpm"] :
        mode === "vf" ? ["rpm", "vbus", "iq"] :
        ["rpm", "iq", "vbus"];
      for (const id of order) {
        const el = wrap.querySelector(`[data-gauge="${id}"]`);
        if (el) {
          wrap.appendChild(el);
          // 表盘自适应突出显示
          const isPrimary = (mode === "vel" && id === "rpm") ||
                            (mode === "vf" && id === "rpm") ||
                            (mode === "iq" && id === "iq");
          el.classList.toggle("is-primary", isPrimary);
        }
      }
    };

    const sendTargetVal = (val) => {
      let v = Number(val);
      if (!Number.isFinite(v) || !this.send) return;
      if (mode === "iq") {
        const lim = this._iqLimit || IQ_UI_LIMIT_DEFAULT;
        if (Math.abs(v) > lim) {
          v = Math.sign(v) * lim;
          const num = this.root.querySelector("#dash-target-num");
          const range = this.root.querySelector("#dash-target-range");
          if (num) num.value = String(v);
          if (range) range.value = String(v);
        }
      }
      if (this.isConnected && !this.isConnected()) return;
      if (mode === "vel" || mode === "vf") {
        const rpmLim = this._rpmLimit || RPM_UI_LIMIT_DEFAULT;
        if (Math.abs(v) > rpmLim) {
          v = Math.sign(v) * rpmLim;
          const num = this.root.querySelector("#dash-target-num");
          const range = this.root.querySelector("#dash-target-range");
          if (num && mode === "vel") num.value = String(v);
          if (range && mode === "vel") range.value = String(v);
        }
      }
      let cmd;
      if (mode === "vf") cmd = `rpm ${v}`;
      else if (mode === "pos") {
        const sem = this._posSem || "rel";
        if (sem === "abs") cmd = `pos abs ${v}`;
        else if (sem === "step") cmd = `pos step ${v}`;
        else cmd = `target ${v}`; /* 相对使能原点，保持与旧固件兼容 */
      } else cmd = `target ${v}`;
      Promise.resolve(this.send(cmd)).catch(() => {});
    };

    const sendPosCmd = (cmd) => {
      if (!this.send || !cmd) return;
      if (this.isConnected && !this.isConnected()) return;
      Promise.resolve(this.send(cmd)).catch(() => {});
    };

    const applyPosSemUI = () => {
      const card = this.root.querySelector("#dash-pos-card");
      const stepRow = this.root.querySelector("#dash-pos-step-row");
      const note = this.root.querySelector("#dash-pos-note");
      const sem = this._posSem || "rel";
      const show = mode === "pos";
      if (card) card.hidden = !show;
      if (stepRow) stepRow.hidden = !(show && sem === "step");
      this.root.querySelectorAll(".dash-pos-seg [data-pos-sem]").forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-pos-sem") === sem);
      });
      if (note) {
        if (!show) note.textContent = "";
        else if (sem === "abs") note.textContent = t("pos.note_abs");
        else if (sem === "step") note.textContent = t("pos.note_step");
        else note.textContent = t("pos.note_rel");
      }
      if (show && targetLabel) targetLabel.textContent = "rad";
    };

    const applyModeMeta = () => {
      const mc = MODE_CONTROLS[mode] || MODE_CONTROLS.vel;
      const useRpm = mode === "vf";
      const rpmLim = this._rpmLimit || RPM_UI_LIMIT_DEFAULT;
      let meta = useRpm
        ? { unit: "RPM", min: -rpmLim, max: rpmLim, step: rpmLim >= 2000 ? 10 : 1 }
        : mc.target || { unit: "RPM", min: -rpmLim, max: rpmLim, step: rpmLim >= 2000 ? 10 : 1 };
      if (mode === "vel") {
        meta = { unit: "RPM", min: -rpmLim, max: rpmLim, step: rpmLim >= 2000 ? 10 : 1 };
      }
      if (mode === "pos") {
        const sem = this._posSem || "rel";
        if (sem === "abs") meta = { unit: "rad", min: -40, max: 40, step: 0.01 };
        else if (sem === "step") meta = { unit: "rad", min: -6.28, max: 6.28, step: 0.01 };
        else meta = { unit: "rad", min: -50, max: 50, step: 0.01 };
      }
      if (mode === "iq") {
        const lim = this._iqLimit || IQ_UI_LIMIT_DEFAULT;
        meta = { unit: "A", min: -lim, max: lim, step: 0.1 };
      }
      // 步进模式：隐藏目标滑条，只保留步进/点动/清零
      if (targetRow) targetRow.hidden = mode === "pos" && (this._posSem || "rel") === "step";
      if (vfRow) vfRow.hidden = !useRpm;
      if (range) {
        range.min = String(meta.min);
        range.max = String(meta.max);
        range.step = String(meta.step);
      }
      if (num) {
        num.min = String(meta.min);
        num.max = String(meta.max);
        num.step = String(meta.step);
      }
      if (targetLabel) targetLabel.textContent = meta.unit;
      const zeroEl = this.root.querySelector(".slider-zero");
      if (zeroEl) {
        const frac = (0 - meta.min) / (meta.max - meta.min);
        zeroEl.style.left = `${(frac * 100).toFixed(2)}%`;
      }
      if (modeDesc) modeDesc.textContent = t(`dash.mode.${mode}`);
      if (modeSel && modeSel.value !== mode) modeSel.value = mode;
      setVizMode();
      applyPosSemUI();
      if (presetBox) {
        presetBox.innerHTML = "";
        if (mode === "pos" && (this._posSem || "rel") === "step") {
          /* 步进：点动只放在定位语义卡内，避免与预设区重复 */
          presetBox.hidden = true;
          return;
        }
        presetBox.hidden = false;
        const label = document.createElement("span");
        label.className = "dash-presets-label";
        label.textContent = t("dash.ctrl.presets");
        presetBox.appendChild(label);
        for (const v of PRESETS[mode] || []) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "small dash-preset-btn";
          b.textContent = String(v);
          b.addEventListener("click", () => {
            if (num) num.value = String(v);
            if (range) range.value = String(v);
            sendTargetVal(v);
          });
          presetBox.appendChild(b);
        }
      }
    };

    this.root.querySelectorAll(".dash-pos-seg [data-pos-sem]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sem = btn.getAttribute("data-pos-sem") || "rel";
        this._posSem = sem;
        applyModeMeta();
      });
    });
    this.root.querySelectorAll(".dash-jog-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!this.isConnected || !this.isConnected()) return;
        const deg = Number(btn.getAttribute("data-jog-deg"));
        if (!Number.isFinite(deg)) return;
        const rad = (deg * Math.PI) / 180;
        sendPosCmd(`pos step ${rad.toFixed(5)}`);
      });
    });
    this.root.querySelector("#dash-pos-zero")?.addEventListener("click", () => {
      if (!this.isConnected || !this.isConnected()) return;
      sendPosCmd("pos zero");
    });
    this.root.querySelector("#dash-pos-step-go")?.addEventListener("click", () => {
      if (!this.isConnected || !this.isConnected()) return;
      const el = this.root.querySelector("#dash-pos-step-val");
      const v = Number(el?.value);
      if (!Number.isFinite(v)) return;
      sendPosCmd(`pos step ${v}`);
    });

    modeSel?.addEventListener("change", () => {
      // UI 模式切换始终允许；仅在已连接时下发 CLI
      const nextMode = modeSel.value || "vf";
      if (mode !== nextMode) {
        mode = nextMode;
        this._mode = mode;
        applyModeMeta();
        if (this.send && this.isConnected && this.isConnected()) {
          Promise.resolve(this.send(`mode ${mode}`)).catch(() => {});
        }
      }
    });
    // 板子 STATUS 反同步：只更新本地 UI，不下发 mode
    this._onModeSync = (boardMode) => {
      mode = boardMode;
      applyModeMeta();
    };
    this._applyModeMetaHook = applyModeMeta;
    applyModeMeta();
    applyModeMeta();

    if (range && num) {
      // HEAD 行为：滑条松开 / 输入失焦 / 回车 / 快捷值点击 → 自动下发
      range.addEventListener("input", () => {
        num.value = range.value;
      });
      range.addEventListener("change", () => {
        sendTargetVal(range.value);
      });
      num.addEventListener("change", () => {
        range.value = num.value;
        sendTargetVal(num.value);
      });
      num.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          range.value = num.value;
          sendTargetVal(num.value);
        }
      });
    }
    const vqSend = this.root.querySelector("#dash-vq-send");
    if (vqSend) {
      vqSend.addEventListener("click", () => {
        const v = Number(this.root.querySelector("#dash-vq-num")?.value);
        if (!Number.isFinite(v) || !this.send) return;
        if (this.isConnected && !this.isConnected()) return;
        Promise.resolve(this.send(`vq ${v}`)).catch(() => {});
      });
    }
    const en = this.root.querySelector("#dash-enable");
    if (en) en.addEventListener("click", () => {
      if (this.isConnected && !this.isConnected()) return;
      this.send && Promise.resolve(this.send("enable")).catch(() => {});
    });
    const dis = this.root.querySelector("#dash-disable");
    if (dis) dis.addEventListener("click", () => {
      if (this.isConnected && !this.isConnected()) return;
      this.send && Promise.resolve(this.send("disable")).catch(() => {});
    });
    const faultBtn = this.root.querySelector("#dash-fault");
    if (faultBtn) faultBtn.addEventListener("click", () => {
      if (this.isConnected && !this.isConnected()) return;
      this.send && Promise.resolve(this.send("fault")).catch(() => {});
    });
  }

  /**
   * 由 CLI 文本回显同步模式（`M0 mode=vel` / `M0 IDLE mode=vel`）。
   * 10B STATUS 不再携带 mode，终端/脚本/预设直接下发 `mode xx` 时靠这里保持 UI 一致。
   * @param {string} id vf|iq|vel|pos
   */
  syncMode(id) {
    if (!MODE_IDS.includes(id) || id === this._mode) return;
    this._mode = id;
    const sel = this.root.querySelector("#dash-mode");
    if (sel && sel.value !== id) sel.value = id;
    if (typeof this._onModeSync === "function") this._onModeSync(id);
  }

  /**
   * 接收 10 Hz STATUS 心跳帧独立更新仪表盘
   * 即使波形流关闭，仪表盘与状态指示灯也能持续刷新
   * @param {{timestampMs:number, vbus:number, motorFault:number, shuntFault:number, state:number, mode:number, tempC:number, rpmEst:number, iqEst:number}} s
   */
  handleStatusUpdate(s) {
    this._lastStatus = s;
    this._lastStatusTime = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    this.refresh();
  }

  resizeGauges() {
    for (const g of Object.values(this.gauges)) {
      if (g && !g._destroyed) {
        g._resize();
        g.draw();
      }
    }
  }

  start(intervalMs = 100) {
    this.stop();
    this._timer = setInterval(() => this.refresh(), intervalMs);
    this.refresh();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  refresh() {
    const latest = this.store.latest;
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const isStatusFresh = !!(this._lastStatus && ((now - this._lastStatusTime) < 3000));

    const setStrip = (id, text, bad) => {
      const el = (this.strip || this.root).querySelector(`[data-strip="${id}"]`);
      if (!el) return;
      el.textContent = text;
      el.classList.toggle("bad", !!bad);
    };

    const badge = this.root.querySelector("#dash-mode-badge");
    const MODE_NAMES = [t("mode.vf"), t("mode.iq"), t("mode.vel"), t("mode.pos")];

    // 转速与电流表盘完全由高速 Wave 驱动；Vbus 由 Wave 或 Status 驱动
    const rpmVal = Number.isFinite(latest[2]) ? latest[2] : NaN;
    const iqVal = Number.isFinite(latest[5]) ? latest[5] : NaN;
    const vbusVal = isStatusFresh ? this._lastStatus.vbus : (Number.isFinite(latest[26]) ? latest[26] : NaN);
    const posVal = Number.isFinite(latest[17]) ? latest[17] : NaN;
    const posRef = Number.isFinite(latest[16]) ? latest[16] : NaN;

    if (isStatusFresh) {
      const s = this._lastStatus;
      const fCode = s.faultCode !== undefined ? s.faultCode : (s.motorFault || s.shuntFault);
      const hasFault = fCode !== 0;
      const faultStr = (s.motorFault !== undefined && s.shuntFault !== undefined && (s.motorFault || s.shuntFault))
        ? `${t("dash.fault")} ${faultTextUi(s.motorFault * 100 + s.shuntFault)}`
        : `${t("dash.fault")}: ${faultTextUi(fCode)}`;
      setStrip("fault", hasFault ? faultStr : `${t("dash.fault")} ${t("dash.ok")}`, hasFault);

      // state：IDLE/RUN/CALIB/FAULT（固件枚举名保留）
      if (Number.isFinite(s.state)) {
        const st = STATE_NAMES[s.state] || String(s.state);
        setStrip("state", `${t("dash.state")} ${st}`, s.state === 3);
      }

      // mode：精简版 10B STATUS 已不带 mode；有则以板子为准反同步选框
      if (Number.isFinite(s.mode)) {
        const modeName = MODE_NAMES[s.mode] || String(s.mode);
        setStrip("mode", `${t("dash.mode")} ${modeName}`, false);
        if (badge) badge.textContent = modeName;
        const boardMode = MODE_IDS[s.mode];
        if (boardMode && boardMode !== this._mode) {
          this._mode = boardMode;
          const sel = this.root.querySelector("#dash-mode");
          if (sel && sel.value !== boardMode) sel.value = boardMode;
          if (typeof this._onModeSync === "function") this._onModeSync(boardMode);
        }
      } else {
        const idx = MODE_IDS.indexOf(this._mode);
        const modeName = idx >= 0 ? MODE_NAMES[idx] : "—";
        setStrip("mode", `${t("dash.mode")} ${modeName}`, false);
        if (badge) badge.textContent = modeName;
      }
    } else {
      setStrip("fault", `${t("dash.fault")} —`, false);
      setStrip("state", `${t("dash.state")} —`, false);
      setStrip("mode", `${t("dash.mode")} —`, false);
      if (badge) badge.textContent = "—";
    }

    // 专属模式 KPI 卡组刷新
    const updateKpi = (idx, label, val, sub, stateClass = "") => {
      const card = this.root.querySelector(`[data-kpi-idx="${idx}"]`);
      if (!card) return;
      const lblEl = card.querySelector('[data-kpi="label"]');
      const valEl = card.querySelector('[data-kpi="val"]');
      const subEl = card.querySelector('[data-kpi="sub"]');
      if (lblEl) lblEl.textContent = label;
      if (valEl) valEl.textContent = val;
      if (subEl) subEl.textContent = sub;
      card.className = `dash-kpi-card ${stateClass}`.trim();
    };

    const uiMode = this._mode || "vf";
    if (uiMode === "pos") {
      const pErr = Number.isFinite(posVal) && Number.isFinite(posRef) ? posRef - posVal : NaN;
      updateKpi(
        0,
        t("dash.kpi.target_pos"),
        Number.isFinite(posRef) ? `${posRef.toFixed(3)} rad` : "—",
        Number.isFinite(posRef) ? `${(posRef * 180 / Math.PI).toFixed(1)}°` : "",
        "is-accent"
      );
      updateKpi(
        1,
        t("dash.kpi.actual_pos"),
        Number.isFinite(posVal) ? `${posVal.toFixed(3)} rad` : "—",
        Number.isFinite(posVal) ? `${(posVal * 180 / Math.PI).toFixed(1)}°` : ""
      );
      const badErr = Number.isFinite(pErr) && Math.abs(pErr) > 0.2;
      const warnErr = Number.isFinite(pErr) && Math.abs(pErr) > 0.05;
      updateKpi(
        2,
        t("dash.kpi.pos_err"),
        Number.isFinite(pErr) ? `${pErr > 0 ? "+" : ""}${pErr.toFixed(3)} rad` : "—",
        Number.isFinite(pErr) ? `${(pErr * 180 / Math.PI).toFixed(1)}°` : "",
        badErr ? "is-bad" : (warnErr ? "is-warn" : "")
      );
      updateKpi(
        3,
        t("dash.kpi.torque_iq"),
        Number.isFinite(iqVal) ? `${iqVal.toFixed(2)} A` : "—",
        t("dash.kpi.sub.fb")
      );
    } else if (uiMode === "iq") {
      const iqRef = Number.isFinite(latest[6]) ? latest[6] : NaN;
      const vd = Number.isFinite(latest[7]) ? latest[7] : NaN;
      const vq = Number.isFinite(latest[8]) ? latest[8] : NaN;
      updateKpi(0, t("dash.kpi.target_iq"), Number.isFinite(iqRef) ? `${iqRef.toFixed(2)} A` : "—", t("dash.kpi.sub.cmd"), "is-accent");
      updateKpi(1, t("dash.kpi.actual_iq"), Number.isFinite(iqVal) ? `${iqVal.toFixed(2)} A` : "—", t("dash.kpi.sub.fb"));
      updateKpi(2, t("dash.kpi.vd_out"), Number.isFinite(vd) ? `${vd.toFixed(2)} V` : "—", t("dash.kpi.sub.d"));
      updateKpi(3, t("dash.kpi.vq_out"), Number.isFinite(vq) ? `${vq.toFixed(2)} V` : "—", t("dash.kpi.sub.q"));
    } else if (uiMode === "vf") {
      const vq = Number.isFinite(latest[8]) ? latest[8] : NaN;
      const tgtRpm = Number.isFinite(latest[3]) ? latest[3] : NaN;
      updateKpi(0, t("dash.kpi.open_rpm"), Number.isFinite(tgtRpm) ? `${tgtRpm.toFixed(0)} RPM` : "—", t("dash.kpi.sub.tgt"), "is-accent");
      updateKpi(1, t("dash.kpi.est_speed"), Number.isFinite(rpmVal) ? `${rpmVal.toFixed(0)} RPM` : "—", t("dash.kpi.sub.est"));
      updateKpi(2, t("dash.kpi.boost_vq"), Number.isFinite(vq) ? `${vq.toFixed(2)} V` : "—", t("dash.kpi.sub.volt"));
      updateKpi(3, t("dash.kpi.bus_vbus"), Number.isFinite(vbusVal) ? `${vbusVal.toFixed(1)} V` : "—", t("dash.kpi.sub.dc"));
    } else {
      const velRef = Number.isFinite(latest[3]) ? latest[3] : NaN;
      const spdErr = (Number.isFinite(rpmVal) && Number.isFinite(velRef))
        ? (rpmVal - velRef)
        : (Number.isFinite(latest[30]) ? latest[30] : NaN);
      const badSpd = Number.isFinite(spdErr) && Math.abs(spdErr) > 200;
      const warnSpd = Number.isFinite(spdErr) && Math.abs(spdErr) > 50;
      updateKpi(0, t("dash.kpi.target_rpm"), Number.isFinite(velRef) ? `${velRef.toFixed(0)} RPM` : "—", Number.isFinite(velRef) ? `${(velRef / 60).toFixed(1)} rps` : "", "is-accent");
      updateKpi(1, t("dash.kpi.speed_rpm"), Number.isFinite(rpmVal) ? `${rpmVal.toFixed(0)} RPM` : "—", Number.isFinite(rpmVal) ? `${(rpmVal / 60).toFixed(1)} rps` : "");
      updateKpi(2, t("dash.kpi.speed_err"), Number.isFinite(spdErr) ? `${spdErr > 0 ? "+" : ""}${spdErr.toFixed(0)} RPM` : "—", Number.isFinite(spdErr) ? `${(spdErr / 60).toFixed(1)} rps` : "", badSpd ? "is-bad" : (warnSpd ? "is-warn" : ""));
      updateKpi(3, t("dash.kpi.load_iq"), Number.isFinite(iqVal) ? `${iqVal.toFixed(2)} A` : "—", t("dash.kpi.sub.cur"));
    }

    if (this.gauges.rpm && Number.isFinite(rpmVal)) this.gauges.rpm.setValue(rpmVal);
    if (this.gauges.iq && Number.isFinite(iqVal)) this.gauges.iq.setValue(iqVal);
    if (this.gauges.vbus && Number.isFinite(vbusVal)) this.gauges.vbus.setValue(vbusVal);

    if (this.rotor) {
      if (Number.isFinite(posVal)) this.rotor.setActualRad(posVal);
      if (Number.isFinite(posRef)) this.rotor.setTargetRad(posRef);
      if (this.rotor && typeof this.rotor.setPosReadout === "function") {
        const tgtNum = Number(this.root.querySelector("#dash-target-num")?.value);
        const hasTel = Number.isFinite(posVal) && this.store && this.store.length > 0;
        this.rotor.setPosReadout({
          absRad: hasTel ? posVal : undefined,
          relRad: hasTel && Number.isFinite(posRef) && Number.isFinite(posVal) ? posRef - posVal : undefined,
          tgtRad: Number.isFinite(tgtNum) ? tgtNum : undefined,
        });
        // Rel 显示为跟踪误差 (target-actual)，标签由 rotor 使用 Err
      }
    }
  }
}
