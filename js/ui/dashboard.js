/**
 * Dashboard：状态条 + 关键量卡片 + 故障解码。与 Scope 同一 TelemetryStore。
 */

import { formatValue, channelLabel } from "../channels.js";
import { faultText, decodeFault } from "./fault.js";
import { getLang } from "../i18n.js";

const KEY_IDS = [
  { id: 2, label: "RPM" },
  { id: 3, label: "Ref" },
  { id: 5, label: "Iq" },
  { id: 6, label: "Iq*" },
  { id: 4, label: "Id" },
  { id: 15, label: "Vbus" },
  { id: 0, label: "θe" },
  { id: 12, label: "Duty" },
  { id: 8, label: "Vq" },
  { id: 7, label: "Vd" },
];

export class Dashboard {
  constructor(root, store, channels) {
    this.root = root;
    this.store = store;
    this.channels = channels;
    this._timer = null;
    this._build();
  }

  setChannels(channels) {
    this.channels = channels;
    this._build();
  }

  _ch(id) {
    return this.channels.find((c) => c.id === id) || { name: `ch${id}`, unit: "" };
  }

  _build() {
    this.root.innerHTML = "";

    this.strip = document.createElement("div");
    this.strip.className = "dash-strip";
    this.strip.innerHTML = `
      <div class="dash-state"><span class="dash-state-label">FAULT</span><strong id="dash-fault">—</strong></div>
      <div class="dash-state"><span class="dash-state-label">RPM</span><strong id="dash-rpm">—</strong></div>
      <div class="dash-state"><span class="dash-state-label">Iq</span><strong id="dash-iq">—</strong></div>
      <div class="dash-state"><span class="dash-state-label">Vbus</span><strong id="dash-vbus">—</strong></div>
      <div class="dash-state"><span class="dash-state-label">跟踪</span><strong id="dash-err">—</strong></div>
    `;
    this.root.appendChild(this.strip);

    this.grid = document.createElement("div");
    this.grid.className = "dash-grid";
    this.cells = [];
    for (const k of KEY_IDS) {
      const ch = this._ch(k.id);
      const label = channelLabel(k.id, getLang());
      const card = document.createElement("div");
      card.className = "dash-card";
      card.innerHTML = `
        <div class="dash-label">${k.label}<span class="dash-ch">ch${k.id} ${label}</span></div>
        <div class="dash-value" data-id="${k.id}">—</div>
      `;
      this.grid.appendChild(card);
      this.cells.push(card.querySelector(".dash-value"));
    }
    this.root.appendChild(this.grid);

    this.hint = document.createElement("div");
    this.hint.className = "dash-hint";
    this.hint.textContent = "数据与 Scope 同源。故障位仅供参考，以固件 status/fault 命令为准。";
    this.root.appendChild(this.hint);
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
    for (let i = 0; i < this.cells.length; i++) {
      const id = Number(this.cells[i].dataset.id);
      const ch = this._ch(id);
      this.cells[i].textContent = formatValue(latest[id], ch.unit);
    }

    const faultEl = this.root.querySelector("#dash-fault");
    if (faultEl) {
      const f = decodeFault(latest[13]);
      faultEl.textContent = f.ok ? "OK" : faultText(latest[13]);
      faultEl.classList.toggle("bad", !f.ok);
    }
    const rpm = this.root.querySelector("#dash-rpm");
    if (rpm) rpm.textContent = formatValue(latest[2], "rpm");
    const iq = this.root.querySelector("#dash-iq");
    if (iq) iq.textContent = formatValue(latest[5], "A");
    const vbus = this.root.querySelector("#dash-vbus");
    if (vbus) vbus.textContent = formatValue(latest[15], "V");
    const err = this.root.querySelector("#dash-err");
    if (err) {
      const e = latest[2] - latest[3];
      err.textContent = Number.isFinite(e) ? `${e.toFixed(1)} rpm` : "—";
    }
  }
}
