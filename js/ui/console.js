/**
 * 控制台：把 UI 控件映射到现有 ASCII CLI（不改固件）。
 */

export const PRESET_COMMANDS = [
  { id: "help", label: "Help", cmd: "help", kind: "normal" },
  { id: "version", label: "Version", cmd: "version", kind: "normal" },
  { id: "status", label: "Status", cmd: "status", kind: "normal" },
  { id: "enable", label: "Enable", cmd: "enable", kind: "ok" },
  { id: "disable", label: "Disable", cmd: "disable", kind: "warn" },
  { id: "fault", label: "Fault?", cmd: "fault", kind: "normal" },
  { id: "faultclear", label: "Fault Clear", cmd: "fault clear", kind: "warn" },
  { id: "calib", label: "Calib full", cmd: "calib full", kind: "normal" },
  { id: "logon", label: "Log ON", cmd: "log 1", kind: "normal" },
  { id: "logoff", label: "Log OFF", cmd: "log 0", kind: "normal" },
];

/** 无感闭环控制 — 映射固件 feedback [sensored|sensorless|auto|if|speed|blend] */
export const FEEDBACK_COMMANDS = [
  { id: "fb-status", key: "fb.status", cmd: "feedback", danger: false },
  { id: "fb-sensorless", key: "fb.sensorless", cmd: "feedback sensorless", danger: false },
  { id: "fb-sensored", key: "fb.sensored", cmd: "feedback sensored", danger: false },
  { id: "fb-auto", key: "fb.auto", cmd: "feedback auto", danger: false },
  { id: "fb-if-def", key: "fb.if_def", cmd: "feedback if 0.6 500 300", danger: false },
];

/** 无感观测器在线 — 映射固件 obs [0|1|2 [off]] / angle enc|ol */
export const OBS_COMMANDS = [
  { id: "obs-q", key: "obs.query", cmd: "obs", danger: false },
  { id: "obs-off", key: "obs.off", cmd: "obs 0", danger: false },
  { id: "obs-on", key: "obs.on", cmd: "obs 1", danger: false },
  { id: "obs-switch", key: "obs.switch", cmd: "obs 2", danger: true },
  { id: "ang-enc", key: "obs.enc", cmd: "angle enc", danger: false },
  { id: "ang-ol", key: "obs.ol", cmd: "angle ol", danger: false },
];

/** 参数辨识 — 映射固件 ident [full|rs|ldq|pp|flux|show|apply] */
export const IDENT_COMMANDS = [
  { id: "ident-rs", key: "ident.rs", cmd: "ident rs", danger: false },
  { id: "ident-ldq", key: "ident.ldq", cmd: "ident ldq", danger: false },
  { id: "ident-pp", key: "ident.pp", cmd: "ident pp", danger: true },
  { id: "ident-flux", key: "ident.flux", cmd: "ident flux", danger: true },
  { id: "ident-full", key: "ident.full", cmd: "ident full", danger: true },
  { id: "ident-show", key: "ident.show", cmd: "ident show", danger: false },
  { id: "ident-apply", key: "ident.apply", cmd: "ident apply", danger: false },
];

export const MODES = [
  { id: "vf", key: "mode.vf" },
  { id: "iq", key: "mode.iq" },
  { id: "vel", key: "mode.vel" },
  { id: "pos", key: "mode.pos" },
];

/** 各闭环模式下可用的设定量（与固件 CLI 对齐） */
export const MODE_CONTROLS = {
  // V/F 开环：rpm + vq，无 target
  vf: { target: null, rpm: true, vq: true },
  iq: { target: { unit: "A", min: -20, max: 20, step: 0.1 }, rpm: false, vq: false },
  vel: { target: { unit: "RPM", min: -8000, max: 8000, step: 10 }, rpm: false, vq: false },
  pos: { target: { unit: "rad", min: -50, max: 50, step: 0.01 }, rpm: false, vq: false },
};

const LS_KEY = "foc-studio-console-v1";

export class ControlConsole {
  /**
   * @param {object} opts
   * @param {(cmd:string)=>Promise<void>|void} opts.send
   */
  constructor(opts) {
    this.send = opts.send;
    this.custom = this._loadCustom();
  }

  _loadCustom() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
      return [];
    }
  }

  _saveCustom() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.custom));
    } catch {
      /* ignore */
    }
  }

  addCustom(label, cmd) {
    const item = { id: `c${Date.now()}`, label: label || cmd, cmd, kind: "custom" };
    this.custom.push(item);
    this._saveCustom();
    return item;
  }

  removeCustom(id) {
    this.custom = this.custom.filter((x) => x.id !== id);
    this._saveCustom();
  }

  async run(cmd) {
    const line = String(cmd || "").trim();
    if (!line) return;
    await this.send(line);
  }

  async setMode(mode) {
    await this.run(`mode ${mode}`);
  }

  async setTarget(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("target must be a number");
    await this.run(`target ${n}`);
  }

  async setRpm(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("rpm must be a number");
    await this.run(`rpm ${n}`);
  }

  async setVq(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("vq must be a number");
    await this.run(`vq ${n}`);
  }

  async estop() {
    await this.run("disable");
  }

  allPresets() {
    return [...PRESET_COMMANDS, ...this.custom];
  }
}
