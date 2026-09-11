/**
 * JustFloat 16 通道默认定义 — 与 foc_telemetry.h 对齐。
 * ch15 单轴=vbus / 双轴=轴1电角度，允许用户改名。
 */

export const CHANNEL_COUNT = 16;

export const DEFAULT_CHANNELS = [
  { id: 0,  name: "theta_e",     unit: "rad",  color: "#5b8def", visible: false },
  { id: 1,  name: "iq_raw",      unit: "A",    color: "#f07178", visible: true  },
  { id: 2,  name: "velocity",    unit: "rpm",  color: "#7fd962", visible: true  },
  { id: 3,  name: "vel_ref",     unit: "rpm",  color: "#c3a6ff", visible: true  },
  { id: 4,  name: "id_filt",     unit: "A",    color: "#62d9e8", visible: false },
  { id: 5,  name: "iq_filt",     unit: "A",    color: "#ff9f43", visible: true  },
  { id: 6,  name: "iq_ref",      unit: "A",    color: "#ffd166", visible: true  },
  { id: 7,  name: "vd",          unit: "V",    color: "#8d99ae", visible: false },
  { id: 8,  name: "vq",          unit: "V",    color: "#ef476f", visible: false },
  { id: 9,  name: "ia",          unit: "A",    color: "#06d6a0", visible: false },
  { id: 10, name: "ib",          unit: "A",    color: "#118ab2", visible: false },
  { id: 11, name: "ic",          unit: "A",    color: "#9b5de5", visible: false },
  { id: 12, name: "duty_a",      unit: "0-1",  color: "#f4a261", visible: false },
  { id: 13, name: "fault",       unit: "",     color: "#e63946", visible: false },
  { id: 14, name: "obs_err",     unit: "rad",  color: "#a8dadc", visible: false },
  { id: 15, name: "vbus",        unit: "V",    color: "#fcbf49", visible: true  },
];

const LS_KEY = "foc-studio-channels-v1";

export function loadChannels() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CHANNELS.map((c) => ({ ...c }));
    const saved = JSON.parse(raw);
    return DEFAULT_CHANNELS.map((def) => {
      const s = saved.find((x) => x.id === def.id);
      return s ? { ...def, name: s.name ?? def.name, unit: s.unit ?? def.unit, visible: s.visible ?? def.visible } : { ...def };
    });
  } catch {
    return DEFAULT_CHANNELS.map((c) => ({ ...c }));
  }
}

export function saveChannels(channels) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify(channels.map((c) => ({ id: c.id, name: c.name, unit: c.unit, visible: c.visible })))
    );
  } catch {
    /* ignore quota errors */
  }
}

export function formatValue(v, unit) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  let s;
  if (abs >= 1000) s = v.toFixed(1);
  else if (abs >= 10) s = v.toFixed(2);
  else if (abs >= 1) s = v.toFixed(3);
  else s = v.toFixed(4);
  return unit ? `${s} ${unit}` : s;
}
