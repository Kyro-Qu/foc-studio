/**
 * ch13 编码：motor_fault * 100 + current_sense_fault
 * 仅解码已知位，未知保留数字。
 */

export const MOTOR_FAULTS = [
  { bit: 0, name: "OVERCURRENT" },
  { bit: 1, name: "OVERVOLTAGE" },
  { bit: 2, name: "UNDERVOLTAGE" },
  { bit: 3, name: "OVERTEMP" },
  { bit: 4, name: "SENSOR" },
  { bit: 5, name: "STARTUP" },
  { bit: 6, name: "WATCHDOG" },
  { bit: 7, name: "SOFTWARE" },
];

export function decodeFault(value) {
  if (!Number.isFinite(value) || value === 0) {
    return { code: 0, motor: 0, sense: 0, names: [], ok: true };
  }
  const code = Math.trunc(value);
  const motor = Math.trunc(code / 100);
  const sense = code % 100;
  const names = [];
  for (const f of MOTOR_FAULTS) {
    if (motor & (1 << f.bit)) names.push(f.name);
  }
  if (sense) names.push(`CS_${sense}`);
  return { code, motor, sense, names, ok: false };
}

export function faultText(value) {
  const d = decodeFault(value);
  if (d.ok) return "OK";
  return d.names.length ? d.names.join(" | ") : `FAULT ${d.code}`;
}
