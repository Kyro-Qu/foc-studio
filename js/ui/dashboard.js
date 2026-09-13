/**
 * Dashboard v0.3.2：表盘 + 控制滑条 + 分组读数。
 * 控制滑条映射 CLI（target / rpm），不读 MCU 参数回读。
 */

import { formatValue, channelLabel } from "../channels.js";
import { faultText, decodeFault } from "./fault.js";
import { getLang, t } from "../i18n.js";
import { Gauge } from "./gauge.js";
import { MODE_CONTROLS } from "./console.js";

const ROW_GROUPS = [
  {
    titleKey: "dash.grp.speed",
    items: [2, 3],
  },
  {
    titleKey: "dash.grp.current",
    items: [5, 6, 4, 1],
  },
  {
    titleKey: "dash.grp.voltage",
    items: [26, 8, 7, 12],
  },
  {
    titleKey: "dash.grp.angle",
    items: [0, 20, 22],
  },
];

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
    this._cells = new Map();
    this._lastStatus = null;
    this._lastStatusTime = 0;
    this._build();
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
    const lang = getLang();

    /* 状态条 */
    this.strip = document.createElement("div");
    this.strip.className = "dash-strip";
    for (const s of [
      { id: "fault", key: "dash.fault", unit: "" },
      { id: "rpm", key: "dash.rpm", unit: "rpm" },
      { id: "iq", key: "dash.iq", unit: "A" },
      { id: "vbus", key: "dash.vbus", unit: "V" },
      { id: "track", key: "dash.track", unit: "rpm" },
    ]) {
      const cell = document.createElement("div");
      cell.className = `dash-state dash-state-${s.id}`;
      cell.innerHTML = `
        <div class="dash-state-label">${t(s.key)}${s.unit ? ` <span class="dash-state-unit">${s.unit}</span>` : ""}</div>
        <div class="dash-state-val" data-strip="${s.id}">—</div>
      `;
      this.strip.appendChild(cell);
    }
    this.root.appendChild(this.strip);

    /* 表盘 + 控制 */
    const mid = document.createElement("div");
    mid.className = "dash-mid";

    const gaugeWrap = document.createElement("div");
    gaugeWrap.className = "dash-gauges";
    const gdefs = [
      { id: "rpm", label: t("dash.rpm"), unit: "rpm", min: 0, max: 5000, color: "#7fd962", digits: 0 },
      { id: "iq", label: "Iq", unit: "A", min: -5, max: 5, color: "#ff9f43", digits: 2 },
      { id: "vbus", label: t("dash.vbus"), unit: "V", min: 0, max: 25, color: "#58a6ff", digits: 1 },
      { id: "duty", label: channelLabel(12, lang), unit: "", min: 0, max: 1, color: "#c3a6ff", digits: 2 },
    ];
    for (const d of gdefs) {
      const box = document.createElement("div");
      box.className = "dash-gauge";
      const cv = document.createElement("canvas");
      box.appendChild(cv);
      gaugeWrap.appendChild(box);
      this.gauges[d.id] = new Gauge(cv, d);
    }
    mid.appendChild(gaugeWrap);

    /* 控制滑条 */
    const ctrl = document.createElement("div");
    ctrl.className = "dash-ctrl";
    ctrl.innerHTML = `
      <h3 class="dash-group-title">${t("dash.ctrl.title")}</h3>
      <div class="dash-ctrl-row">
        <label>${t("dash.ctrl.mode")}</label>
        <select id="dash-mode">
          <option value="vel">${t("mode.vel")}</option>
          <option value="iq">${t("mode.iq")}</option>
          <option value="vf">${t("mode.vf")}</option>
          <option value="pos">${t("mode.pos")}</option>
        </select>
        <button class="small" id="dash-mode-send">${t("dash.ctrl.set")}</button>
      </div>
      <div class="dash-ctrl-row" id="dash-target-row">
        <label><span id="dash-target-label" class="dash-unit-tag">RPM</span></label>
        <div class="slider-wrap">
          <input type="range" id="dash-target-range" min="-8000" max="8000" step="10" value="0" />
          <span class="slider-zero" title="0" aria-hidden="true">
            <span class="slider-zero-tick"></span>
            <span class="slider-zero-label">0</span>
          </span>
        </div>
        <input type="number" id="dash-target-num" min="-8000" max="8000" step="10" value="0" style="width:90px" />
        <button class="small" id="dash-target-send">${t("dash.ctrl.send")}</button>
      </div>
      <div class="dash-ctrl-row" id="dash-vf-row" hidden>
        <label>Vq <span class="dash-unit-tag">V</span></label>
        <input type="number" id="dash-vq-num" min="0" max="12" step="0.1" value="0.5" style="width:80px" />
        <button class="small" id="dash-vq-send">${t("dash.ctrl.send")}</button>
      </div>
      <div class="dash-ctrl-row dash-ctrl-actions">
        <button class="small ok" id="dash-enable">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><polygon points="4,3 13,8 4,13"/></svg>
          <span>${t("dash.ctrl.enable")}</span>
        </button>
        <button class="small danger" id="dash-disable">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>
          <span>${t("dash.ctrl.disable")}</span>
        </button>
        <button class="small" id="dash-fault">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11.5h.01"/></svg>
          <span>${t("wf.safety.fault")}</span>
        </button>
      </div>
      <p class="dash-ctrl-note">${t("dash.ctrl.note")}</p>
    `;
    mid.appendChild(ctrl);
    this.root.appendChild(mid);

    /* 分组读数 */
    const grid = document.createElement("div");
    grid.className = "dash-groups";
    for (const g of ROW_GROUPS) {
      const sec = document.createElement("section");
      sec.className = "dash-group";
      const title = document.createElement("h3");
      title.className = "dash-group-title";
      title.textContent = t(g.titleKey);
      sec.appendChild(title);
      const list = document.createElement("div");
      list.className = "dash-list";
      for (const id of g.items) {
        const label = channelLabel(id, lang);
        const ch = this.channels.find((c) => c.id === id);
        const unit = ch ? ch.unit : "";
        const row = document.createElement("div");
        row.className = "dash-row";
        row.innerHTML = `
          <span class="dash-row-name" title="ch${id}">${label}</span>
          <span class="dash-row-val" data-id="${id}">—</span>
          <span class="dash-row-unit">${unit}</span>
        `;
        list.appendChild(row);
        this._cells.set(id, row.querySelector(".dash-row-val"));
      }
      sec.appendChild(list);
      grid.appendChild(sec);
    }
    this.root.appendChild(grid);

    this.hint = document.createElement("p");
    this.hint.className = "dash-hint";
    this.hint.textContent = t("dash.hint");
    this.root.appendChild(this.hint);

    this._wireCtrl();
  }

  _wireCtrl() {
    const range = this.root.querySelector("#dash-target-range");
    const num = this.root.querySelector("#dash-target-num");
    const modeSel = this.root.querySelector("#dash-mode");
    const targetLabel = this.root.querySelector("#dash-target-label");
    const targetRow = this.root.querySelector("#dash-target-row");
    const vfRow = this.root.querySelector("#dash-vf-row");

    const applyModeMeta = () => {
      const id = modeSel?.value || "vel";
      const mc = MODE_CONTROLS[id] || MODE_CONTROLS.vel;
      // vf：滑条发 rpm，另发 vq；闭环：滑条发 target
      const useRpm = id === "vf";
      const meta = useRpm
        ? { unit: "RPM", min: -8000, max: 8000, step: 10 }
        : mc.target || { unit: "RPM", min: -8000, max: 8000, step: 10 };
      if (targetRow) targetRow.hidden = false;
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
    };
    applyModeMeta();
    if (modeSel) modeSel.addEventListener("change", applyModeMeta);

    if (range && num) {
      range.addEventListener("input", () => {
        num.value = range.value;
      });
      num.addEventListener("change", () => {
        range.value = num.value;
      });
    }
    const send = this.root.querySelector("#dash-target-send");
    if (send) {
      send.addEventListener("click", () => {
        const v = Number(num && num.value);
        if (!Number.isFinite(v) || !this.send) return;
        const mode = modeSel?.value || "vel";
        const cmd = mode === "vf" ? `rpm ${v}` : `target ${v}`;
        Promise.resolve(this.send(cmd)).catch(() => {});
      });
    }
    const vqSend = this.root.querySelector("#dash-vq-send");
    if (vqSend) {
      vqSend.addEventListener("click", () => {
        const v = Number(this.root.querySelector("#dash-vq-num")?.value);
        if (!Number.isFinite(v) || !this.send) return;
        Promise.resolve(this.send(`vq ${v}`)).catch(() => {});
      });
    }
    const modeSend = this.root.querySelector("#dash-mode-send");
    if (modeSend) {
      modeSend.addEventListener("click", () => {
        const m = modeSel?.value;
        if (m && this.send) Promise.resolve(this.send(`mode ${m}`)).catch(() => {});
      });
    }
    const en = this.root.querySelector("#dash-enable");
    if (en) en.addEventListener("click", () => this.send && Promise.resolve(this.send("enable")).catch(() => {}));
    const dis = this.root.querySelector("#dash-disable");
    if (dis) dis.addEventListener("click", () => this.send && Promise.resolve(this.send("disable")).catch(() => {}));
    const faultBtn = this.root.querySelector("#dash-fault");
    if (faultBtn) faultBtn.addEventListener("click", () => this.send && Promise.resolve(this.send("fault")).catch(() => {}));
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
      const el = this.root.querySelector(`[data-strip="${id}"]`);
      if (!el) return;
      el.textContent = text;
      el.classList.toggle("bad", !!bad);
    };

    // 1. 故障展示：严格由 STATUS 帧驱动
    if (isStatusFresh) {
      const s = this._lastStatus;
      const hasFault = (s.motorFault !== 0) || (s.shuntFault !== 0);
      const faultDesc = hasFault ? `M:${s.motorFault} S:${s.shuntFault}` : "OK";
      setStrip("fault", faultDesc, hasFault);
    } else {
      setStrip("fault", "—", false);
    }

    // 2. 转速与电流：优先使用高频波形，若未订阅波形则平滑回退到 STATUS 低频估计值
    let rpmVal = Number.isFinite(latest[2]) ? latest[2] : (isStatusFresh ? this._lastStatus.rpmEst : NaN);
    let iqVal = Number.isFinite(latest[5]) ? latest[5] : (isStatusFresh ? this._lastStatus.iqEst : NaN);
    // 3. 母线电压：优先使用实时波形 ch26，若未订阅则使用 STATUS 中的 vbus
    let vbusVal = Number.isFinite(latest[26]) ? latest[26] : (isStatusFresh ? this._lastStatus.vbus : NaN);

    setStrip("rpm", Number.isFinite(rpmVal) ? rpmVal.toFixed(1) : "—");
    setStrip("iq", Number.isFinite(iqVal) ? iqVal.toFixed(2) : "—");
    setStrip("vbus", Number.isFinite(vbusVal) ? vbusVal.toFixed(2) : "—");

    const track = latest[2] - latest[3];
    setStrip("track", Number.isFinite(track) ? track.toFixed(1) : "—");

    if (this.gauges.rpm && Number.isFinite(rpmVal)) this.gauges.rpm.setValue(rpmVal);
    if (this.gauges.iq && Number.isFinite(iqVal)) this.gauges.iq.setValue(iqVal);
    if (this.gauges.vbus && Number.isFinite(vbusVal)) this.gauges.vbus.setValue(vbusVal);
    if (this.gauges.duty && Number.isFinite(latest[12])) this.gauges.duty.setValue(latest[12]);

    for (const [id, el] of this._cells) {
      const ch = this.channels.find((c) => c.id === id);
      el.textContent = formatValue(latest[id], ch ? ch.unit : "");
    }
  }
}
