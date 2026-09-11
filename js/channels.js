/**
 * JustFloat 16 通道 — 与 foc_telemetry.h 对齐。
 * 显示名按语言本地化，不再提供可编辑输入框。
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

/** 显示名：中文友好名 / 英文技术名 */
export const CHANNEL_LABELS = {
  0:  { zh: "电角度 θe", en: "THETA_E" },
  1:  { zh: "Iq 原始",   en: "IQ_RAW" },
  2:  { zh: "转速",      en: "RPM" },
  3:  { zh: "转速给定",  en: "RPM_REF" },
  4:  { zh: "Id 滤波",   en: "ID_FILT" },
  5:  { zh: "Iq 滤波",   en: "IQ_FILT" },
  6:  { zh: "Iq 给定",   en: "IQ_REF" },
  7:  { zh: "Vd",        en: "VD" },
  8:  { zh: "Vq",        en: "VQ" },
  9:  { zh: "Ia",        en: "IA" },
  10: { zh: "Ib",        en: "IB" },
  11: { zh: "Ic",        en: "IC" },
  12: { zh: "A 相占空比", en: "DUTY_A" },
  13: { zh: "故障码",    en: "FAULT" },
  14: { zh: "观测误差",  en: "OBS_ERR" },
  15: { zh: "母线电压",  en: "VBUS" },
};

/**
 * @param {number} id
 * @param {'zh'|'en'} lang
 */
export function channelLabel(id, lang = "zh") {
  const c = CHANNEL_LABELS[id];
  if (!c) return `ch${id}`;
  return lang === "en" ? c.en : c.zh;
}

const LS_KEY = "foc-studio-channels-v1";

export function loadChannels() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CHANNELS.map((c) => ({ ...c }));
    const saved = JSON.parse(raw);
    return DEFAULT_CHANNELS.map((def) => {
      const s = saved.find((x) => x.id === def.id);
      // 只恢复可见性；显示名始终用本地化标签
      return s ? { ...def, visible: s.visible ?? def.visible } : { ...def };
    });
  } catch {
    return DEFAULT_CHANNELS.map((c) => ({ ...c }));
  }
}

export function saveChannels(channels) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify(channels.map((c) => ({ id: c.id, visible: c.visible })))
    );
  } catch {
    /* ignore */
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