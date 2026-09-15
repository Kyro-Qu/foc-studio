/**
 * FOC-STP v1.0 32 通道定义 — 与固件 extract_channel_value 对齐。
 * 显示名按语言本地化。
 */

export const CHANNEL_COUNT = 32;

export const DEFAULT_CHANNELS = [
  { id: 0,  name: "theta_e",     unit: "rad",  color: "#5b8def", visible: false },
  { id: 1,  name: "iq_raw",      unit: "A",    color: "#f07178", visible: true  },
  { id: 2,  name: "vel_ctrl",    unit: "rpm",  color: "#7fd962", visible: true  },
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
  { id: 13, name: "id_raw",      unit: "A",    color: "#e63946", visible: false },
  { id: 14, name: "id_ref",      unit: "A",    color: "#a8dadc", visible: false },
  { id: 15, name: "vel_raw",     unit: "rpm",  color: "#fcbf49", visible: false },
  { id: 16, name: "pos_ref",     unit: "rad",  color: "#3a86ff", visible: false },
  { id: 17, name: "position",    unit: "rad",  color: "#8338ec", visible: true  },
  { id: 18, name: "duty_b",      unit: "0-1",  color: "#ff006e", visible: false },
  { id: 19, name: "duty_c",      unit: "0-1",  color: "#fb5607", visible: false },
  { id: 20, name: "obs_theta",   unit: "rad",  color: "#ffbe0b", visible: false },
  { id: 21, name: "obs_speed",   unit: "rpm",  color: "#06d6a0", visible: false },
  { id: 22, name: "obs_err",     unit: "deg",  color: "#118ab2", visible: false },
  { id: 23, name: "obs_conf",    unit: "0-1",  color: "#073b4c", visible: false },
  { id: 24, name: "obs_flux",    unit: "Wb",   color: "#b5e2fa", visible: false },
  { id: 25, name: "power_est",   unit: "W",    color: "#edafb8", visible: false },
  { id: 26, name: "vbus_fast",   unit: "V",    color: "#f72585", visible: true  },
  { id: 27, name: "torque_est",  unit: "N·m",  color: "#7209b7", visible: false },
  { id: 28, name: "iq_err",      unit: "A",    color: "#3f37c9", visible: false },
  { id: 29, name: "id_err",      unit: "A",    color: "#4361ee", visible: false },
  { id: 30, name: "vel_err",     unit: "rpm",  color: "#4cc9f0", visible: false },
  { id: 31, name: "diag_aux",    unit: "",     color: "#a0c4ff", visible: false },
];

/** 显示名：中文友好名 / 英文技术名 */
export const CHANNEL_LABELS = {
  0:  { zh: "电角度",       en: "THETA_E" },
  1:  { zh: "Iq 原始",     en: "IQ_RAW" },
  2:  { zh: "控制转速",    en: "VEL_CTRL" },
  3:  { zh: "转速给定",    en: "VEL_REF" },
  4:  { zh: "Id 滤波",     en: "ID_FILT" },
  5:  { zh: "Iq 滤波",     en: "IQ_FILT" },
  6:  { zh: "Iq 给定",     en: "IQ_REF" },
  7:  { zh: "Vd 指令",     en: "VD" },
  8:  { zh: "Vq 指令",     en: "VQ" },
  9:  { zh: "相电流 Ia",   en: "IA" },
  10: { zh: "相电流 Ib",   en: "IB" },
  11: { zh: "相电流 Ic",   en: "IC" },
  12: { zh: "A 相占空比",   en: "DUTY_A" },
  13: { zh: "Id 原始",     en: "ID_RAW" },
  14: { zh: "Id 给定",     en: "ID_REF" },
  15: { zh: "编码器转速",  en: "VEL_RAW" },
  16: { zh: "位置给定",    en: "POS_REF" },
  17: { zh: "机械位置",    en: "POSITION" },
  18: { zh: "B 相占空比",   en: "DUTY_B" },
  19: { zh: "C 相占空比",   en: "DUTY_C" },
  20: { zh: "观测电角度",  en: "OBS_THETA" },
  21: { zh: "观测转速",    en: "OBS_SPEED" },
  22: { zh: "观测角差",    en: "OBS_ERR" },
  23: { zh: "观测置信度",  en: "OBS_CONF" },
  24: { zh: "观测磁链",    en: "OBS_FLUX" },
  25: { zh: "电功率估算",  en: "POWER_EST" },
  26: { zh: "母线电压",    en: "VBUS" },
  27: { zh: "估算转矩",    en: "TORQUE_EST" },
  28: { zh: "Iq 跟踪误差", en: "IQ_ERR" },
  29: { zh: "Id 跟踪误差", en: "ID_ERR" },
  30: { zh: "转速跟踪误差", en: "VEL_ERR" },
  31: { zh: "诊断辅助通道", en: "DIAG_AUX" },
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

const LS_KEY = "foc-studio-channels-v2";

export function loadChannels() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CHANNELS.map((c) => ({ ...c }));
    const saved = JSON.parse(raw);
    return DEFAULT_CHANNELS.map((def) => {
      const s = saved.find((x) => x.id === def.id);
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

/**
 * 格式化精简纯数值，用于通道侧边栏紧凑列显示
 * @param {number} v
 */
export function formatValueCompact(v) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs >= 10000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(3);
  return v.toFixed(3);
}
