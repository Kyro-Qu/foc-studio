/**
 * 调参面板：把常用 FOC 参数映射到现有 ASCII CLI（不改固件）。
 * 与 VESC Tool / SimpleFOC Studio 思路一致：滑条/数字框 → 发送 CLI。
 */

/**
 * 每项：{ id, label, group, cmdPrefix, min, max, step, unit, hint }
 * 发送时：`${cmdPrefix} ${value}`
 */
export const TUNING_PARAMS = [
  { id: "limit", label: "电流软限", group: "安全", cmdPrefix: "limit", min: 0.1, max: 40, step: 0.1, unit: "A" },
  { id: "current_bw", label: "电流环带宽", group: "电流", cmdPrefix: "current bw", min: 100, max: 5000, step: 50, unit: "rad/s" },
  { id: "vel_kp", label: "速度 Kp", group: "速度", cmdPrefix: "vel kp", min: 0, max: 2, step: 0.01, unit: "" },
  { id: "vel_ki", label: "速度 Ki", group: "速度", cmdPrefix: "vel ki", min: 0, max: 5, step: 0.01, unit: "" },
  { id: "vel_ramp", label: "速度斜坡", group: "速度", cmdPrefix: "vel ramp", min: 0, max: 20000, step: 100, unit: "RPM/s" },
  { id: "vel_filter", label: "速度滤波", group: "速度", cmdPrefix: "vel filter", min: 0, max: 200, step: 1, unit: "Hz" },
  { id: "pos_kp", label: "位置 Kp", group: "位置", cmdPrefix: "pos kp", min: 0, max: 200, step: 0.5, unit: "" },
  { id: "pos_vkp", label: "速度阻尼 vkp", group: "位置", cmdPrefix: "pos vkp", min: 0, max: 0.2, step: 0.001, unit: "A/RPM" },
  { id: "pos_accel", label: "规划加速度", group: "位置", cmdPrefix: "pos accel", min: 100, max: 50000, step: 100, unit: "RPM/s" },
  { id: "vf_slope", label: "V/F 斜率", group: "V/F", cmdPrefix: "vf slope", min: 0, max: 0.01, step: 0.0001, unit: "V/RPM" },
  { id: "fb_if_curr", label: "I/F 启动电流", group: "无感", cmdPrefix: "feedback if", min: 0.1, max: 0.8, step: 0.05, unit: "A" },
];

const LS_KEY = "foc-studio-tuning-values-v1";

export class TuningPanel {
  /**
   * @param {HTMLElement} root
   * @param {(cmd:string)=>Promise<void>|void} send
   */
  constructor(root, send) {
    this.root = root;
    this.send = send;
    this.values = this._load();
    this._build();
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  _save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.values));
    } catch {
      /* ignore */
    }
  }

  _build() {
    // 钳位损坏/越界的 localStorage 值
    for (const p of TUNING_PARAMS) {
      const v = this.values[p.id];
      if (!Number.isFinite(v) || v < p.min || v > p.max) {
        this.values[p.id] = p.min;
      }
    }
    this.root.innerHTML = "";
    const groups = new Map();
    for (const p of TUNING_PARAMS) {
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group).push(p);
    }
    for (const [group, params] of groups) {
      const sec = document.createElement("div");
      sec.className = "console-section";
      sec.innerHTML = `<div class="panel-title" style="font-size:11px">${group}</div>`;
      for (const p of params) {
        const row = document.createElement("div");
        row.className = "tune-row";
        const val = this.values[p.id] ?? p.min;
        row.innerHTML = `
          <label class="tune-label" title="${p.cmdPrefix}">${p.label}${p.unit ? ` <span class="tune-unit">${p.unit}</span>` : ""}</label>
          <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}" data-id="${p.id}" />
          <input type="number" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}" data-id="${p.id}" class="tune-num" />
          <button class="small" data-send="${p.id}">Set</button>
        `;
        sec.appendChild(row);
      }
      this.root.appendChild(sec);
    }

    const note = document.createElement("div");
    note.className = "tune-note";
    note.textContent =
      "Set 发送 CLI。数值为本地编辑值（非 MCU 回读）；写入 RAM，持久化请 Terminal 执行 conf write。";
    this.root.appendChild(note);

    this.root.querySelectorAll('input[type="range"]').forEach((el) => {
      el.addEventListener("input", () => {
        const num = this.root.querySelector(`input.tune-num[data-id="${el.dataset.id}"]`);
        if (num) num.value = el.value;
        this.values[el.dataset.id] = Number(el.value);
        this._save();
      });
    });
    this.root.querySelectorAll("input.tune-num").forEach((el) => {
      el.addEventListener("change", () => {
        const rng = this.root.querySelector(`input[type="range"][data-id="${el.dataset.id}"]`);
        if (rng) rng.value = el.value;
        this.values[el.dataset.id] = Number(el.value);
        this._save();
      });
    });
    this.root.querySelectorAll("[data-send]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const p = TUNING_PARAMS.find((x) => x.id === btn.dataset.send);
        if (!p) return;
        const v = this.values[p.id];
        if (!Number.isFinite(v)) return;
        const cmd = `${p.cmdPrefix} ${v}`;
        try {
          await this.send(cmd);
        } catch (e) {
          console.error(e);
        }
      });
    });
  }
}
