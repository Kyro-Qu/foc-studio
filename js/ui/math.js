/**
 * 数学通道（纯前端，不改固件）：
 *   sub: a-b, add: a+b, abs: |a|, dt: d(a)/dt （按 sampleRate 差分）
 */

export const MATH_OPS = [
  { id: "sub", label: "a − b", arity: 2 },
  { id: "add", label: "a + b", arity: 2 },
  { id: "abs", label: "|a|", arity: 1 },
  { id: "dt", label: "d a/dt", arity: 1 },
];

export class MathChannels {
  constructor() {
    /** @type {Array<{id:number, op:string, a:number, b:number, name:string, color:string, visible:boolean}>} */
    this.items = [];
    this.sampleRate = 1000;
    this._nextId = 0;
  }

  /**
   * @param {string} op
   * @param {number} a channel id
   * @param {number} [b]
   */
  add(op, a, b = 0) {
    const meta = MATH_OPS.find((m) => m.id === op);
    if (!meta) throw new Error(`unknown math op ${op}`);
    const item = {
      id: this._nextId++,
      op,
      a,
      b,
      name: this._defaultName(op, a, b),
      color: ["#ff6b6b", "#ffd93d", "#6bcBff", "#c77dff"][this.items.length % 4],
      visible: true,
    };
    this.items.push(item);
    return item;
  }

  remove(id) {
    this.items = this.items.filter((x) => x.id !== id);
  }

  clear() {
    this.items = [];
  }

  _defaultName(op, a, b) {
    switch (op) {
      case "sub":
        return `ch${a}-ch${b}`;
      case "add":
        return `ch${a}+ch${b}`;
      case "abs":
        return `|ch${a}|`;
      case "dt":
        return `d(ch${a})/dt`;
      default:
        return `M${this._nextId}`;
    }
  }

  /**
   * 计算某数学通道在给定原始序列上的输出
   * @param {Float32Array} ya
   * @param {Float32Array} [yb]
   * @returns {Float32Array}
   */
  compute(item, ya, yb) {
    const n = ya.length;
    const out = new Float32Array(n);
    switch (item.op) {
      case "sub":
        for (let i = 0; i < n; i++) out[i] = ya[i] - (yb ? yb[i] : 0);
        break;
      case "add":
        for (let i = 0; i < n; i++) out[i] = ya[i] + (yb ? yb[i] : 0);
        break;
      case "abs":
        for (let i = 0; i < n; i++) out[i] = Math.abs(ya[i]);
        break;
      case "dt": {
        const dt = 1 / this.sampleRate;
        out[0] = 0;
        for (let i = 1; i < n; i++) out[i] = (ya[i] - ya[i - 1]) / dt;
        break;
      }
      default:
        break;
    }
    return out;
  }
}
