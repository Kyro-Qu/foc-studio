/**
 * 电机参数 Schema 定义与换算标准 (Motor Parameter Schema)
 * 严格对应 STM32G431 固件物理算法定义与三相正弦 SVPWM 线电压峰值换算基准：
 * Ke (V/krpm) = sqrt(3) * psi_f * (2 * pi * pp * 1000 / 60)
 * KV (rpm/V)  = 60 / (sqrt(3) * 2 * pi * pp * psi_f)
 */

export const SQRT3 = Math.sqrt(3);
export const TWO_PI = 2 * Math.PI;

/**
 * 由磁链与极对数计算真实理论 KV 值
 * @param {number} flux 磁链 (Wb)
 * @param {number} pp 极对数
 * @returns {number|null}
 */
export function calcKvFromFlux(flux, pp) {
  if (!flux || flux <= 0.000001 || !pp || pp < 1) return null;
  const kv = 60.0 / (SQRT3 * TWO_PI * pp * flux);
  return Number.isFinite(kv) && kv > 5 && kv < 50000 ? Math.round(kv) : null;
}

/**
 * 由标称 KV 值与极对数反推磁链估算值
 * @param {number} kv 电机 KV (rpm/V)
 * @param {number} pp 极对数
 * @returns {number|null}
 */
export function calcFluxFromKv(kv, pp) {
  if (!kv || kv <= 5 || !pp || pp < 1) return null;
  const flux = 60.0 / (SQRT3 * TWO_PI * pp * kv);
  return Number.isFinite(flux) && flux > 0.00001 && flux < 0.5 ? Number(flux.toFixed(6)) : null;
}

/**
 * 计算凸极比 (Lq / Ld)
 * @param {number} lq q 轴电感 (µH)
 * @param {number} ld d 轴电感 (µH)
 * @returns {number|null}
 */
export function calcSaliency(lq, ld) {
  if (!lq || !ld || ld <= 0.001 || lq <= 0.001) return null;
  const ratio = lq / ld;
  return Number.isFinite(ratio) && ratio > 0.1 && ratio < 10.0 ? Number(ratio.toFixed(3)) : null;
}

/**
 * 12 项电机参数规范字典
 */
export const MOTOR_SCHEMA = {
  // --- 铭牌与基本规格组 (Specs) ---
  motor_name: {
    id: "wf-motor-name",
    key: "motor_name",
    name: "电机型号",
    unit: "",
    decimals: null,
    group: "specs",
    sources: ["manual"],
    required: false,
    safetyCritical: false,
    isFixedManual: true, // 固定手填，无多源/重测/推导弹窗
    diffPolicy: null,
    identCmd: null,
    spinsRotor: false,
    defaultVal: "DJI_2312S",
  },
  max_rpm: {
    id: "wf-maxrpm",
    key: "max_rpm",
    name: "最大转速",
    unit: "rpm",
    decimals: 0,
    group: "specs",
    sources: ["manual", "active"],
    required: true,
    safetyCritical: true,
    isFixedManual: false, // 支持手填与 MCU 硬件读取对比及采纳
    diffPolicy: { type: "relative", warning: 0.2 },
    identCmd: null,
    spinsRotor: false,
    defaultVal: 8000,
  },
  v_rated: {
    id: "wf-v-rated",
    key: "v_rated",
    name: "额定电压",
    unit: "V",
    decimals: 1,
    group: "specs",
    sources: ["manual", "active"],
    required: false,
    safetyCritical: false,
    isFixedManual: false, // 支持手填与硬件母线/配置读取对比及采纳
    diffPolicy: { type: "relative", warning: 0.2 },
    identCmd: null,
    spinsRotor: false,
    defaultVal: 14.8,
  },
  i_rated: {
    id: "wf-i-rated",
    key: "i_rated",
    name: "额定电流",
    unit: "A",
    decimals: 1,
    group: "specs",
    sources: ["manual", "active"],
    required: false,
    safetyCritical: false,
    isFixedManual: false, // 支持手填与硬件电流软限(limit)读取对比及采纳
    diffPolicy: { type: "relative", warning: 0.2 },
    identCmd: null,
    spinsRotor: false,
    defaultVal: 3.5,
  },
  pp: {
    id: "wf-pp",
    key: "pp",
    name: "极对数",
    unit: "",
    decimals: 0,
    group: "specs",
    sources: ["manual", "identified", "active"],
    required: true,
    safetyCritical: true,
    isFixedManual: false,
    // 极对数必须 100% 精确，差 1 都不允许自动覆盖，必须硬阻断！
    diffPolicy: { type: "exact" },
    identCmd: "calib full",
    spinsRotor: true,
    defaultVal: 7,
  },
  kv: {
    id: "wf-kv",
    key: "kv",
    name: "电机 KV 值",
    unit: "rpm/V",
    decimals: 0,
    group: "specs",
    sources: ["manual", "identified", "active"],
    required: false,
    safetyCritical: false,
    isFixedManual: false,
    // 标称 KV 值离散度较大，放宽至 10%
    diffPolicy: { type: "relative", warning: 0.1 },
    identCmd: null,
    spinsRotor: false,
    defaultVal: 960,
  },

  // --- 高阶阻抗与测量特性组 (Impedance & Identification) ---
  rs: {
    id: "wf-rs",
    key: "rs",
    name: "相电阻",
    unit: "Ω",
    decimals: 4,
    group: "impedance",
    sources: ["identified", "manual", "active"],
    required: true,
    safetyCritical: true,
    isFixedManual: false,
    defaultSource: "identified", // 核心电气辨识量
    diffPolicy: { type: "relative", warning: 0.15 },
    identCmd: "ident rs",
    spinsRotor: false,
    defaultVal: 0.1,
  },
  ls: {
    id: "wf-ls",
    key: "ls",
    name: "相电感",
    unit: "µH",
    decimals: 2,
    group: "impedance",
    sources: ["identified", "manual", "active"],
    required: true,
    safetyCritical: true,
    isFixedManual: false,
    defaultSource: "identified", // 核心电气辨识量
    diffPolicy: { type: "relative", warning: 0.2 },
    identCmd: "ident ls",
    spinsRotor: false,
    defaultVal: 20.0,
  },
  ld: {
    id: "wf-ld",
    key: "ld",
    name: "d 轴电感",
    unit: "µH",
    decimals: 2,
    group: "impedance",
    sources: ["identified", "manual", "active"],
    required: false,
    safetyCritical: false,
    isFixedManual: false,
    defaultSource: "identified",
    diffPolicy: { type: "relative", warning: 0.2 },
    identCmd: "ident ls",
    spinsRotor: false,
    defaultVal: null,
  },
  lq: {
    id: "wf-lq",
    key: "lq",
    name: "q 轴电感",
    unit: "µH",
    decimals: 2,
    group: "impedance",
    sources: ["identified", "manual", "active"],
    required: false,
    safetyCritical: false,
    isFixedManual: false,
    defaultSource: "identified",
    diffPolicy: { type: "relative", warning: 0.2 },
    identCmd: "ident ls",
    spinsRotor: false,
    defaultVal: null,
  },
  flux: {
    id: "wf-flux",
    key: "flux",
    name: "磁链",
    unit: "Wb",
    decimals: 5,
    group: "impedance",
    sources: ["identified", "manual", "active"],
    required: true,
    safetyCritical: true,
    isFixedManual: false,
    defaultSource: "identified",
    diffPolicy: { type: "relative", warning: 0.15 },
    identCmd: "ident flux",
    spinsRotor: true,
    defaultVal: null,
  },
  saliency: {
    id: "wf-saliency",
    key: "saliency",
    name: "凸极比 (Lq/Ld)",
    unit: "比值",
    decimals: 3,
    group: "impedance",
    sources: ["identified", "manual", "active"],
    required: false,
    safetyCritical: false,
    isFixedManual: false,
    defaultSource: "identified",
    diffPolicy: null,
    identCmd: null,
    spinsRotor: false,
    defaultVal: null,
  },
};
