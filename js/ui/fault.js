/**
 * 故障解码 — 与 G431 固件 foc_types.h / current_shunt.h 枚举对齐。
 * ch13 = motor_fault_code * 100 + current_shunt_fault_code
 * 未知名只显示数字，不编造。
 */

/** foc_types.h foc_fault_t */
export const MOTOR_FAULTS = {
  0: "NONE",
  1: "CURRENT_SENSE",
  2: "CALIB_OVERCURRENT",
  3: "RUN_OVERCURRENT",
  4: "CALIB_TIMEOUT",
  5: "CALIB_STATE",
  6: "NOT_CALIBRATED",
  7: "CONTROL_NAN",
  8: "STALL",
  9: "OBSERVER",
  10: "BAD_CONFIG",
  11: "UNDERVOLTAGE",
  12: "OVERVOLTAGE",
  13: "OVERTEMP",
};

/** current_shunt.h CURRENT_SHUNT_FAULT_* */
export const SENSE_FAULTS = {
  0: "NONE",
  1: "OPAMP1_START",
  2: "OPAMP2_START",
  3: "OPAMP3_START",
  4: "ADC1_CALIBRATION",
  5: "ADC2_CALIBRATION",
  6: "ADC1_READY_TIMEOUT",
  7: "ADC2_READY_TIMEOUT",
  8: "ADC1_STOP_TIMEOUT",
  9: "ADC2_STOP_TIMEOUT",
  10: "ADC1_CONTEXT_FLUSH",
  11: "ADC2_CONTEXT_FLUSH",
  12: "CALIBRATION_TIMEOUT",
  13: "CONTEXT_NOT_ARMED",
  14: "ADC1_JEOS_MISSING",
  15: "QUEUE_OVERFLOW",
  16: "CAL_UV_PAIR",
  17: "CAL_W_PAIR",
  18: "CONTEXT_NOT_CONSUMED",
  19: "INVALID_PAIR",
  20: "OFFSET_RANGE",
  21: "INVALID_WINDOW",
  22: "ADC_RESULT_TIMEOUT",
  23: "CURRENT_DISCONTINUITY",
};

export function decodeFault(value) {
  if (!Number.isFinite(value) || value === 0) {
    return { code: 0, motor: 0, sense: 0, motorName: "NONE", senseName: "NONE", ok: true };
  }
  const code = Math.trunc(Math.abs(value));

  // 新增：支持单字节统一故障码 (0x01..0x0F 为 motor，0x10..0x2F 为 sense)
  if (code < 100) {
    if (code >= 0x10) {
      const sense = code - 0x10;
      const senseName = SENSE_FAULTS[sense] != null ? SENSE_FAULTS[sense] : `S${sense}`;
      return { code, motor: 1, sense, motorName: "CURRENT_SENSE", senseName, ok: false };
    }
    const motorName = MOTOR_FAULTS[code] != null ? MOTOR_FAULTS[code] : `M${code}`;
    return { code, motor: code, sense: 0, motorName, senseName: "NONE", ok: false };
  }

  const motor = Math.trunc(code / 100);
  const sense = code % 100;
  const motorName = MOTOR_FAULTS[motor] != null ? MOTOR_FAULTS[motor] : `M${motor}`;
  const senseName = SENSE_FAULTS[sense] != null ? SENSE_FAULTS[sense] : `S${sense}`;
  return { code, motor, sense, motorName, senseName, ok: false };
}

export function faultText(value) {
  const d = decodeFault(value);
  if (d.ok) return "OK";
  if (d.motor === 0 && d.sense === 0) return "OK";
  const parts = [];
  if (d.motor !== 0) parts.push(d.motorName);
  if (d.sense !== 0) parts.push(d.senseName);
  return `${parts.join("+") || "FAULT"} (${d.code})`;
}
