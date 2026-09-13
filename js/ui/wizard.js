/**
 * 六步调试工作流 UI — 超前于固件的能力也先做在上位机里。
 * 每步发既有 CLI；无固件命令时给出说明并禁用或标为「待固件」。
 */

import { t } from "../i18n.js";
import { MODES, MODE_CONTROLS, OBS_COMMANDS } from "./console.js";

const STEPS = [
  { id: "device", key: "wf.device" },
  { id: "motor", key: "wf.motor" },
  { id: "encoder", key: "wf.encoder" },
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
    if (this.onAfterRender) this.onAfterRender(this.step);
  }

  _pageHtml(id) {
    switch (id) {
      case "device":
        return this._htmlDevice();
      case "motor":
        return this._htmlMotor();
      case "encoder":
        return this._htmlEncoder();
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
    const field = (id, label, unit, step, val) => `
      <div class="wf-param">
        <label for="${id}">${label}${unit ? ` <span class="tune-unit">${unit}</span>` : ""}</label>
        <input type="number" id="${id}" step="${step}" value="${val}" />
      </div>`;
    return `
      <h3 class="wf-h">${t("wf.motor.h")}</h3>
      <p class="wf-p">${t("wf.motor.p")}</p>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.motor.params")}</h4>
        <div class="wf-params">
          ${field("wf-pp", t("wf.motor.pp"), "", "1", "7")}
          ${field("wf-rs", t("wf.motor.rs"), "Ω", "0.0001", "0.1")}
          ${field("wf-ls", t("wf.motor.ls"), "µH", "0.01", "20")}
          ${field("wf-ld", t("wf.motor.ld"), "µH", "0.01", "")}
          ${field("wf-lq", t("wf.motor.lq"), "µH", "0.01", "")}
          ${field("wf-flux", t("wf.motor.flux"), "Wb", "0.0001", "")}
          ${field("wf-maxrpm", t("wf.motor.maxrpm"), "rpm", "1", "12000")}
          ${field("wf-limit2", t("wf.motor.limit"), "A", "0.1", "5.2")}
        </div>
        <div class="wf-row">
          <button class="ok" id="wf-read-params">${t("wf.motor.read_params")}</button>
          <button class="ok" data-cmd="ident apply">${t("wf.apply")}</button>
          <button class="danger" data-cmd="conf write" data-confirm="conf write">${t("wf.motor.conf_write")}</button>
          <span class="wf-badge" id="wf-param-src">${t("wf.motor.manual")}</span>
        </div>
        <p class="wf-note">${t("wf.motor.params_note")}</p>
      </section>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.motor.auto")}</h4>
        <div class="wf-row">
          <button data-cmd="ident rs">${t("ident.rs")}</button>
          <button class="danger" data-cmd="ident full" data-confirm="ident full">${t("ident.full")}</button>
          <button data-cmd="ident show">${t("ident.show")}</button>
          <button class="danger" data-cmd="calib full" data-confirm="calib full">${t("wf.calib.full")}</button>
          <button data-cmd="disable">${t("dash.ctrl.disable")}</button>
        </div>
        <p class="wf-note">${t("wf.calib.note")}</p>
      </section>`;
  }

  /** 读取 conf read + ident show，填入参数表 */
  async _readMotorParams() {
    const badge = this.root.querySelector("#wf-param-src");
    if (!this.sendCapture) {
      await this._cli("conf read");
      await this._cli("ident show");
      return;
    }
    let text = "";
    try {
      text += await this.sendCapture("conf read", 450);
      text += "\n" + (await this.sendCapture("ident show", 350));
    } catch {
      /* ignore */
    }
    const pick = (re) => {
      const m = text.match(re);
      return m ? m[1] : null;
    };
    const set = (id, v, scale = 1) => {
      const el = this.root.querySelector(`#${id}`);
      if (el && v != null) el.value = (Number(v) * scale).toFixed(scale === 1 ? 0 : 4);
    };
    set("wf-pp", pick(/pp=([0-9.]+)/));
    // conf: Rs ohm, Ls uH
    const rsConf = pick(/Rs=([0-9.]+)/);
    const lsConf = pick(/Ls=([0-9.]+)/);
    set("wf-rs", rsConf);
    set("wf-ls", lsConf);
    set("wf-maxrpm", pick(/max_rpm=([0-9.]+)/));
    set("wf-limit2", pick(/limit=([0-9.]+)/));
    // ident show 优先覆盖 Rs/Ls
    const rsId = pick(/Rs=([0-9.]+)\s*ohm/i) || pick(/Rs=([0-9.]+)/);
    const lsId = pick(/Ls=([0-9.]+)\s*uH/i) || pick(/Ls=([0-9.]+)/i);
    const ld = pick(/Ld=([0-9.]+)/i);
    const lq = pick(/Lq=([0-9.]+)/i);
    const flux = pick(/flux[^\n=]*=([0-9.]+)/i) || pick(/Ke=([0-9.]+)/i);
    if (rsId) set("wf-rs", rsId);
    if (lsId) set("wf-ls", lsId);
    if (ld) set("wf-ld", ld);
    if (lq) set("wf-lq", lq);
    if (flux) set("wf-flux", flux);
    if (badge) badge.textContent = t("wf.motor.from_device");
  }

  _htmlEncoder() {
    return `
      <h3 class="wf-h">${t("wf.encoder.h")}</h3>
      <p class="wf-p">${t("wf.encoder.p")}</p>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.encoder.type")}</h4>
        <div class="wf-row">
          <label>${t("wf.encoder.kind")}</label>
          <select id="wf-enc-kind">
            <option value="abz">${t("wf.encoder.abz")}</option>
            <option value="sensorless">${t("wf.encoder.sensorless")}</option>
          </select>
          <span class="wf-badge">${t("wf.encoder.kind_note")}</span>
        </div>
        <div class="wf-row">
          <label>CPR</label>
          <input type="number" id="wf-enc-cpr" step="1" min="16" max="65536" value="2048" style="width:90px" />
          <button id="wf-enc-cpr-set">${t("wf.apply")}</button>
          <span class="wf-badge">${t("wf.needs_fw")}</span>
        </div>
        <p class="wf-note">${t("wf.encoder.note")}</p>
      </section>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.encoder.source")}</h4>
        <div class="wf-row">
          <button class="ok" data-cmd="angle enc">${t("obs.enc")}</button>
          <button data-cmd="angle ol">${t("obs.ol")}</button>
          <button data-cmd="angle">${t("wf.encoder.query")}</button>
        </div>
        <p class="wf-note">${t("wf.encoder.source_note")}</p>
      </section>

      <section class="wf-card">
        <h4 class="wf-section">${t("obs.title")}</h4>
        <div class="wf-row">
          <button data-cmd="feedback">${t("fb.status")}</button>
          <button data-cmd="feedback sensored">${t("fb.sensored")}</button>
          <button data-cmd="feedback sensorless">${t("fb.sensorless")}</button>
          <button data-cmd="feedback auto">${t("fb.auto")}</button>
        </div>
        <div class="wf-row">
          <button data-cmd="obs">${t("obs.query")}</button>
          <button data-cmd="obs 0">${t("obs.off")}</button>
          <button data-cmd="obs 1">${t("obs.on")}</button>
          <button class="danger" data-cmd="obs 2" data-confirm="obs 2">${t("obs.switch")}</button>
        </div>
        <p class="wf-note">${t("obs.note")}</p>
      </section>`;
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
        <div id="wf-dashboard-host" class="wf-dash-host"></div>
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
    this.root.querySelector("#wf-read-params")?.addEventListener("click", () => this._readMotorParams());

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
