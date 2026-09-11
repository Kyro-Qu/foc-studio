/**
 * Dashboard：读取与 Scope 同一 TelemetryStore 的 latest。
 */

import { formatValue } from "../channels.js";

const KEY_IDS = [
  { id: 2, label: "RPM" },
  { id: 3, label: "Ref" },
  { id: 5, label: "Iq" },
  { id: 6, label: "Iq*" },
  { id: 4, label: "Id" },
  { id: 15, label: "Vbus" },
  { id: 0, label: "θe" },
  { id: 13, label: "Fault" },
];

export class Dashboard {
  /**
   * @param {HTMLElement} root
   * @param {import('../data/telemetry-store.js').TelemetryStore} store
   * @param {Array} channels
   */
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
    this.grid = document.createElement("div");
    this.grid.className = "dash-grid";
    this.cells = [];
    for (const k of KEY_IDS) {
      const ch = this._ch(k.id);
      const card = document.createElement("div");
      card.className = "dash-card";
      card.innerHTML = `
        <div class="dash-label">${k.label}<span class="dash-ch">ch${k.id} ${ch.name}</span></div>
        <div class="dash-value" data-id="${k.id}">—</div>
      `;
      this.grid.appendChild(card);
      this.cells.push(card.querySelector(".dash-value"));
    }
    this.root.appendChild(this.grid);
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
      const v = latest[id];
      this.cells[i].textContent = formatValue(v, ch.unit);
      if (id === 13) {
        this.cells[i].classList.toggle("fault", Number.isFinite(v) && v !== 0);
      }
    }
  }
}
