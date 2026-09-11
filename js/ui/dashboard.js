/**
 * Dashboard：状态条 + 分组关键量。与 Scope 同一 TelemetryStore。
 */

import { formatValue, channelLabel } from "../channels.js";
import { faultText, decodeFault } from "./fault.js";
import { getLang, t } from "../i18n.js";

/** 分组：每组标题 + 通道行 */
const GROUPS = [
  {
    id: "speed",
    titleKey: "dash.grp.speed",
    items: [
      { id: 2, short: "RPM" },
      { id: 3, short: "REF" },
    ],
  },
  {
    id: "current",
    titleKey: "dash.grp.current",
    items: [
      { id: 5, short: "Iq" },
      { id: 6, short: "Iq*" },
      { id: 4, short: "Id" },
      { id: 1, short: "Iq_raw" },
    ],
  },
  {
    id: "voltage",
    titleKey: "dash.grp.voltage",
    items: [
      { id: 15, short: "Vbus" },
      { id: 8, short: "Vq" },
      { id: 7, short: "Vd" },
      { id: 12, short: "Duty" },
    ],
  },
  {
    id: "angle",
    titleKey: "dash.grp.angle",
    items: [
      { id: 0, short: "θe" },
      { id: 14, short: "OBS" },
      { id: 13, short: "FAULT" },
    ],
  },
];

export class Dashboard {
  constructor(root, store, channels) {
    this.root = root;
    this.store = store;
    this.channels = channels;
    this._timer = null;
    this._cells = new Map();
    this._build();
  }

  setChannels(channels) {
    this.channels = channels;
    this._build();
  }

  _build() {
    this.root.innerHTML = "";
    this._cells.clear();
    const lang = getLang();

    // 顶部状态条
    this.strip = document.createElement("div");
    this.strip.className = "dash-strip";
    const stripDefs = [
      { id: "fault", key: "dash.fault", unit: "" },
      { id: "rpm", key: "dash.rpm", unit: "rpm" },
      { id: "iq", key: "dash.iq", unit: "A" },
      { id: "vbus", key: "dash.vbus", unit: "V" },
      { id: "track", key: "dash.track", unit: "rpm" },
    ];
    for (const s of stripDefs) {
      const cell = document.createElement("div");
      cell.className = `dash-state dash-state-${s.id}`;
      cell.innerHTML = `
        <div class="dash-state-label">${t(s.key)}${s.unit ? ` <span class="dash-state-unit">${s.unit}</span>` : ""}</div>
        <div class="dash-state-val" data-strip="${s.id}">—</div>
      `;
      this.strip.appendChild(cell);
    }
    this.root.appendChild(this.strip);

    // 分组网格
    this.grid = document.createElement("div");
    this.grid.className = "dash-groups";
    for (const g of GROUPS) {
      const sec = document.createElement("section");
      sec.className = "dash-group";
      const title = document.createElement("h3");
      title.className = "dash-group-title";
      title.textContent = t(g.titleKey);
      sec.appendChild(title);
      const list = document.createElement("div");
      list.className = "dash-list";
      for (const item of g.items) {
        const label = channelLabel(item.id, lang);
        const ch = this.channels.find((c) => c.id === item.id);
        const unit = ch ? ch.unit : "";
        const row = document.createElement("div");
        row.className = "dash-row";
        row.innerHTML = `
          <span class="dash-row-name" title="ch${item.id}">${label}</span>
          <span class="dash-row-val" data-id="${item.id}">—</span>
          <span class="dash-row-unit">${unit}</span>
        `;
        list.appendChild(row);
        this._cells.set(item.id, row.querySelector(".dash-row-val"));
      }
      sec.appendChild(list);
      this.grid.appendChild(sec);
    }
    this.root.appendChild(this.grid);

    this.hint = document.createElement("p");
    this.hint.className = "dash-hint";
    this.hint.textContent = t("dash.hint");
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
    const fmt = (id) => {
      const ch = this.channels.find((c) => c.id === id);
      return formatValue(latest[id], ch ? ch.unit : "");
    };

    // 简化数值（条上不带单位重复）
    const raw = (id, digits = 2) => {
      const v = latest[id];
      return Number.isFinite(v) ? v.toFixed(digits) : "—";
    };

    const setStrip = (id, text, bad) => {
      const el = this.root.querySelector(`[data-strip="${id}"]`);
      if (!el) return;
      el.textContent = text;
      el.classList.toggle("bad", !!bad);
    };

    const fd = decodeFault(latest[13]);
    setStrip("fault", fd.ok ? "OK" : faultText(latest[13]), !fd.ok);
    setStrip("rpm", `${raw(2, 1)}`);
    setStrip("iq", `${raw(5, 3)}`);
    setStrip("vbus", `${raw(15, 2)}`);
    const track = latest[2] - latest[3];
    setStrip("track", Number.isFinite(track) ? `${track.toFixed(1)}` : "—");

    for (const [id, el] of this._cells) {
      el.textContent = fmt(id);
      if (id === 13) {
        const f = decodeFault(latest[13]);
        el.classList.toggle("bad", !f.ok);
      }
    }
  }
}
