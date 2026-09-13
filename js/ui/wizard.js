/**
 * 六步调试工作流 UI — 超前于固件的能力也先做在上位机里。
 * 每步发既有 CLI；无固件命令时给出说明并禁用或标为「待固件」。
 */

import { t } from "../i18n.js";
import { MODES, MODE_CONTROLS, IDENT_COMMANDS, OBS_COMMANDS } from "./console.js";

const STEPS = [
  { id: "device", key: "wf.device" },
  { id: "motor", key: "wf.motor" },
  { id: "pid", key: "wf.pid" },
  { id: "run", key: "wf.run" },
];

export class WorkflowWizard {
  /**
   * @param {HTMLElement} root
   * @param {{send:(cmd:string)=>Promise<void>|void, isConnected?:()=>boolean}} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.send = opts.send;
    /** @type {(cmd:string,ms?:number)=>Promise<string>|undefined} */
    this.sendCapture = opts.sendCapture;
    this.isConnected = opts.isConnected || (() => true);
    this.step = "device";
    this.render();
  }

  setStep(id) {
    this.step = STEPS.some((s) => s.id === id) ? id : "device";
    this.render();
  }

  next() {
    const i = STEPS.findIndex((s) => s.id === this.step);
    if (i >= 0 && i < STEPS.length - 1) {
      const id = STEPS[i + 1].id;
      this.setStep(id);
      document.querySelectorAll('.nav-btn[data-panel="wf"]').forEach((b) => {
        b.classList.toggle("active", b.dataset.step === id);
      });
    }
  }

  prev() {
    const i = STEPS.findIndex((s) => s.id === this.step);
    if (i > 0) {
      const id = STEPS[i - 1].id;
      this.setStep(id);
      document.querySelectorAll('.nav-btn[data-panel="wf"]').forEach((b) => {
        b.classList.toggle("active", b.dataset.step === id);
      });
    }
  }

  async _cli(cmd) {
    try {
      await this.send(cmd);
    } catch (e) {
      /* terminal shows errors */
    }
  }

  /** 读取 version+status 并解析板卡信息 */
  async _readBoardInfo() {
    const box = this.root.querySelector("#wf-board-info");
    if (box) box.classList.add("loading");
    if (!this.sendCapture) {
      await this._cli("version");
      await this._cli("status");
      if (box) box.classList.remove("loading");
      return;
    }
    let text = "";
    try {
      text += await this.sendCapture("version", 350);
      text += "\n" + (await this.sendCapture("status", 400));
    } catch {
      /* ignore */
    }
    this._renderBoardInfo(text);
    if (box) box.classList.remove("loading");
  }

  _renderBoardInfo(text) {
    const box = this.root.querySelector("#wf-board-info");
    if (!box) return;
    const pick = (re) => {
      const m = text.match(re);
      return m ? m[1] : "—";
    };
    const rows = [
      [t("wf.device.mcu"), pick(/board=(\S+)/)],
      [t("wf.device.fw"), pick(/firmware=(\S+)/)],
      ["version", pick(/version=(\S+)/)],
      ["cli", pick(/cli=(\S+)/)],
      ["build", pick(/build=([^\r\n]+)/).trim()],
      [t("wf.motor.pp"), pick(/pole_pairs=([0-9.]+)/)],
      ["encoder_cpr", pick(/encoder_cpr=([0-9]+)/)],
      ["max_rpm", pick(/max_rpm=([0-9.]+)/)],
      ["udc / Vbus", pick(/udc=([0-9.]+)/) + " / " + pick(/vbus=([0-9.]+)/)],
      ["calib", pick(/calib=([0-9]+)/)],
      ["fault", pick(/fault=([0-9]+)/)],
      ["CPU %", pick(/cpu=([0-9.]+)/)],
      ["state / mode", pick(/M0 ([A-Z]+)/) + " / " + pick(/mode=(\S+)/)],
      ["rst_flags", pick(/rst_flags=(0x[0-9A-Fa-f]+)/)],
    ];
    box.innerHTML = rows
      .map(([k, v]) => `<div class="wf-kv"><span>${k}</span><strong>${v}</strong></div>`)
      .join("");
  }

  render() {
    this.root.innerHTML = "";
    // 步骤在左侧栏切换；页内不显示步骤条或上一步/下一步
    const body = document.createElement("div");
    body.className = "wf-body";
    body.innerHTML = this._pageHtml(this.step);
    this.root.appendChild(body);
    this._wire();
  }

  _pageHtml(id) {
    switch (id) {
      case "device":
        return this._htmlDevice();
      case "motor":
        return this._htmlMotor();
      case "pid":
        return this._htmlPid();
      case "run":
        return this._htmlRun();
      default:
        return "";
    }
  }

  _htmlDevice() {
    return `
      <h3 class="wf-h">${t("wf.device.h")}</h3>
      <p class="wf-p">${t("wf.device.p")}</p>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.device.info")}</h4>
        <div class="wf-row">
          <button class="ok" id="wf-read-info">${t("wf.device.read")}</button>
          <button data-cmd="log 0">log 0</button>
          <button data-cmd="log 1">log 1</button>
        </div>
        <div id="wf-board-info" class="wf-board">
          ${this._emptyBoardHtml()}
        </div>
      </section>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.safety.h")}</h4>
        <div class="wf-row">
          <label>${t("wf.safety.limit")} (A)</label>
          <input type="number" id="wf-limit" step="0.1" min="0.1" max="40" value="5.2" style="width:90px" />
          <button class="ok" id="wf-limit-set">${t("wf.apply")}</button>
          <button data-cmd="fault">${t("wf.safety.fault")}</button>
          <button data-cmd="fault clear">${t("wf.safety.clear")}</button>
        </div>
        <div class="wf-row">
          <label>${t("wf.safety.trip")} (A)</label>
          <input type="number" id="wf-trip" step="0.1" min="0.1" max="50" value="6.6" style="width:90px" />
          <span class="wf-badge">${t("wf.needs_fw")}</span>
        </div>
        <div class="wf-row">
          <label>${t("wf.safety.uv")} (V)</label>
          <input type="number" id="wf-uv" step="0.1" min="0" max="50" value="10" style="width:70px" />
          <label>${t("wf.safety.ov")} (V)</label>
          <input type="number" id="wf-ov" step="0.1" min="0" max="60" value="30" style="width:70px" />
          <span class="wf-badge">${t("wf.needs_fw")}</span>
        </div>
        <p class="wf-note">${t("wf.safety.note")}</p>
      </section>`;
  }

  _emptyBoardHtml() {
    const keys = [
      t("wf.device.mcu"),
      t("wf.device.fw"),
      "version",
      t("wf.motor.pp"),
      "udc / Vbus",
      "calib",
      "fault",
      "state / mode",
    ];
    return keys
      .map((k) => `<div class="wf-kv"><span>${k}</span><strong>—</strong></div>`)
      .join("");
  }

  _htmlMotor() {
    const ids = IDENT_COMMANDS.map((c) => {
      const cls = c.danger ? "danger" : "";
      return `<button class="${cls}" data-cmd="${c.cmd}" title="${c.cmd}">${t(c.key)}</button>`;
    }).join(" ");
    return `
      <h3 class="wf-h">${t("wf.motor.h")}</h3>
      <p class="wf-p">${t("wf.motor.p")}</p>
      <div class="wf-card">
        <div class="wf-row">
          <label>${t("wf.motor.pp")}</label>
          <input type="number" id="wf-pp" step="1" min="1" max="32" value="7" style="width:70px" />
          <button id="wf-pp-set">${t("wf.apply")}</button>
          <span class="wf-badge">${t("wf.needs_fw")}</span>
        </div>
        <div class="wf-row">
          <button data-cmd="conf read">${t("wf.motor.conf_read")}</button>
          <button data-cmd="conf write">${t("wf.motor.conf_write")}</button>
          <span class="wf-badge danger">${t("wf.motor.flash")}</span>
        </div>
        <p class="wf-note">${t("wf.motor.note")}</p>
        <div class="wf-sep"></div>
        <div class="wf-row">
          <button class="danger" data-cmd="calib full" data-confirm="calib full">${t("wf.calib.full")}</button>
          <button data-cmd="disable">${t("dash.ctrl.disable")}</button>
          <button data-cmd="fault clear">${t("wf.safety.clear")}</button>
        </div>
        <div class="wf-row">${ids}</div>
        <p class="wf-note">${t("wf.calib.note")}</p>
      </div>`;
  }

  _htmlPid() {
    const modes = MODES.map((m) => `<option value="${m.id}">${t(m.key)}</option>`).join("");
    return `
      <h3 class="wf-h">${t("wf.pid.h")}</h3>
      <p class="wf-p">${t("wf.pid.p")}</p>
      <div class="wf-card">
        <div class="wf-row">
          <label>${t("wf.pid.current_bw")}</label>
          <input type="number" id="wf-bw" min="100" max="5000" step="50" value="2000" style="width:90px" />
          <button class="ok" id="wf-bw-set">${t("wf.apply")}</button>
        </div>
        <div class="wf-row">
          <label>${t("wf.pid.vel_kp")}</label>
          <input type="number" id="wf-vkp" step="0.01" value="0.02" style="width:80px" />
          <label>${t("wf.pid.vel_ki")}</label>
          <input type="number" id="wf-vki" step="0.01" value="0.02" style="width:80px" />
          <button class="ok" id="wf-vel-set">${t("wf.apply")}</button>
        </div>
        <div class="wf-row">
          <label>${t("wf.pid.pos_kp")}</label>
          <input type="number" id="wf-pkp" step="0.5" value="10" style="width:80px" />
          <button class="ok" id="wf-pos-set">${t("wf.apply")}</button>
        </div>
        <div class="wf-row">
          <label>${t("dash.ctrl.mode")}</label>
          <select id="wf-mode">${modes}</select>
          <button id="wf-mode-set">${t("wf.apply")}</button>
          <span class="wf-badge">${t("wf.pid.watch_scope")}</span>
        </div>
        <p class="wf-note">${t("wf.pid.note")}</p>
      </div>`;
  }

  _htmlRun() {
    const modes = MODES.map((m) => `<option value="${m.id}">${t(m.key)}</option>`).join("");
    const obs = OBS_COMMANDS.map((c) => {
      const cls = c.danger ? "danger" : "";
      return `<button class="${cls}" data-cmd="${c.cmd}" title="${c.cmd}">${t(c.key)}</button>`;
    }).join(" ");
    return `
      <h3 class="wf-h">${t("wf.run.h")}</h3>
      <p class="wf-p">${t("wf.run.p")}</p>
      <div class="wf-card">
        <div class="wf-row">
          <label>${t("dash.ctrl.mode")}</label>
          <select id="wf-run-mode">${modes}</select>
          <button id="wf-run-mode-set">${t("wf.apply")}</button>
        </div>
        <div class="wf-row" id="wf-run-target-row">
          <label>${t("dash.ctrl.target")} <span class="dash-unit-tag" id="wf-run-unit">RPM</span></label>
          <input type="range" id="wf-run-range" min="-8000" max="8000" step="10" value="0" style="flex:1;min-width:120px" />
          <input type="number" id="wf-run-num" step="10" value="0" style="width:90px" />
          <button class="ok" id="wf-run-send">${t("dash.ctrl.send")}</button>
        </div>
        <div class="wf-row" id="wf-run-vf-row" hidden>
          <label>Vq (V)</label>
          <input type="number" id="wf-run-vq" step="0.1" value="0.5" style="width:80px" />
          <button class="ok" id="wf-run-vq-send">${t("dash.ctrl.send")}</button>
        </div>
        <div class="wf-row">
          <button class="ok" data-cmd="enable">${t("dash.ctrl.enable")}</button>
          <button data-cmd="disable">${t("dash.ctrl.disable")}</button>
          <button data-cmd="fault">${t("wf.safety.fault")}</button>
        </div>
        <div class="wf-sep"></div>
        <div class="wf-h" style="font-size:13px">${t("obs.title")}</div>
        <div class="wf-row">${obs}</div>
        <p class="wf-note">${t("obs.note")}</p>
        <p class="wf-note">${t("wf.run.note")}</p>
      </div>`;
  }

  _wire() {
    this.root.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cmd = btn.getAttribute("data-cmd");
        const conf = btn.getAttribute("data-confirm");
        if (conf && !confirm(conf)) return;
        this._cli(cmd);
      });
    });
    this.root.querySelector("#wf-read-info")?.addEventListener("click", () => this._readBoardInfo());

    this.root.querySelector("#wf-limit-set")?.addEventListener("click", () => {
      const v = Number(this.root.querySelector("#wf-limit")?.value);
      if (Number.isFinite(v)) this._cli(`limit ${v}`);
    });
    this.root.querySelector("#wf-bw-set")?.addEventListener("click", () => {
      const v = Number(this.root.querySelector("#wf-bw")?.value);
      if (Number.isFinite(v)) this._cli(`current bw ${v}`);
    });
    this.root.querySelector("#wf-vel-set")?.addEventListener("click", async () => {
      const kp = Number(this.root.querySelector("#wf-vkp")?.value);
      const ki = Number(this.root.querySelector("#wf-vki")?.value);
      if (Number.isFinite(kp)) await this._cli(`vel kp ${kp}`);
      if (Number.isFinite(ki)) await this._cli(`vel ki ${ki}`);
    });
    this.root.querySelector("#wf-pos-set")?.addEventListener("click", () => {
      const v = Number(this.root.querySelector("#wf-pkp")?.value);
      if (Number.isFinite(v)) this._cli(`pos kp ${v}`);
    });
    this.root.querySelector("#wf-mode-set")?.addEventListener("click", () => {
      const m = this.root.querySelector("#wf-mode")?.value;
      if (m) this._cli(`mode ${m}`);
    });
    this.root.querySelector("#wf-run-mode-set")?.addEventListener("click", () => {
      const m = this.root.querySelector("#wf-run-mode")?.value;
      if (m) {
        this._cli(`mode ${m}`);
        this._applyRunMeta(m);
      }
    });
    const applyRunMeta = () => {
      const m = this.root.querySelector("#wf-run-mode")?.value || "vel";
      this._applyRunMeta(m);
    };
    this.root.querySelector("#wf-run-mode")?.addEventListener("change", applyRunMeta);
    applyRunMeta();
    const range = this.root.querySelector("#wf-run-range");
    const num = this.root.querySelector("#wf-run-num");
    if (range && num) {
      range.addEventListener("input", () => {
        num.value = range.value;
      });
      num.addEventListener("change", () => {
        range.value = num.value;
      });
    }
    this.root.querySelector("#wf-run-send")?.addEventListener("click", () => {
      const v = Number(num?.value);
      if (!Number.isFinite(v)) return;
      const m = this.root.querySelector("#wf-run-mode")?.value || "vel";
      this._cli(m === "vf" ? `rpm ${v}` : `target ${v}`);
    });
    this.root.querySelector("#wf-run-vq-send")?.addEventListener("click", () => {
      const v = Number(this.root.querySelector("#wf-run-vq")?.value);
      if (Number.isFinite(v)) this._cli(`vq ${v}`);
    });
  }

  _applyRunMeta(mode) {
    const mc = MODE_CONTROLS[mode] || MODE_CONTROLS.vel;
    const useVf = mode === "vf";
    const meta = useVf ? { unit: "RPM", min: -8000, max: 8000, step: 10 } : mc.target || { unit: "RPM", min: -8000, max: 8000, step: 10 };
    const unit = this.root.querySelector("#wf-run-unit");
    if (unit) unit.textContent = meta.unit;
    const range = this.root.querySelector("#wf-run-range");
    const num = this.root.querySelector("#wf-run-num");
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
    const vfRow = this.root.querySelector("#wf-run-vf-row");
    if (vfRow) vfRow.hidden = !useVf;
  }
}

export { STEPS as WORKFLOW_STEPS };
