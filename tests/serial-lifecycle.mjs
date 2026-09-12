/**
 * SerialTransport 生命周期 + 写队列（无真实串口，用 mock port）
 */

import { SerialTransport, SerialState } from "../js/transport/serial.js";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

function mockPort(opts = {}) {
  let readChunks = (opts.chunks || []).slice();
  let closed = false;
  let writerLog = [];
  let failWrite = opts.failWrite || false;
  const port = {
    readable: {
      getReader() {
        return {
          async read() {
            if (closed) return { done: true };
            if (readChunks.length) {
              const value = readChunks.shift();
              return { value, done: false };
            }
            // 阻塞直到 cancel/close
            return new Promise((resolve) => {
              port._pendingRead = () => resolve({ done: true });
            });
          },
          releaseLock() {},
          async cancel() {
            closed = true;
            if (port._pendingRead) {
              port._pendingRead();
              port._pendingRead = null;
            }
          },
        };
      },
    },
    writable: {
      getWriter() {
        return {
          async write(bytes) {
            if (failWrite) throw new Error("write fail");
            writerLog.push(Array.from(bytes));
          },
          releaseLock() {},
        };
      },
    },
    async open() {},
    async close() {
      closed = true;
      if (port._pendingRead) {
        port._pendingRead();
        port._pendingRead = null;
      }
    },
    get writerLog() {
      return writerLog;
    },
  };
  return port;
}

// stub navigator.serial
const ports = [];
Object.defineProperty(globalThis, "navigator", {
  value: {
    serial: {
      async requestPort() {
        if (!ports.length) throw new Error("no port");
        return ports.shift();
      },
    },
  },
  configurable: true,
});

console.log("\n[serial lifecycle]");
{
  const t = new SerialTransport();
  const port = mockPort({ chunks: [new Uint8Array([1, 2, 3])] });
  ports.push(port);
  const got = [];
  t.onData = (b) => got.push(b);
  await t.connect(115200);
  await new Promise((r) => setTimeout(r, 10));
  assert(t.state === SerialState.READING || t.state === SerialState.CONNECTED, `state=${t.state}`);
  assert(got.length === 1 && got[0].length === 3, "data received");
  await t.disconnect();
  assert(t.state === SerialState.DISCONNECTED, "disconnect → DISCONNECTED");
}

console.log("\n[write queue order A B C]");
{
  const t = new SerialTransport();
  const port = mockPort();
  ports.push(port);
  await t.connect(115200);
  const p = Promise.all([t.write("A\r\n"), t.write("B\r\n"), t.write("C\r\n")]);
  await p;
  await new Promise((r) => setTimeout(r, 5));
  const texts = port.writerLog.map((a) => String.fromCharCode(...a));
  assert(texts.join("|") === "A\r\n|B\r\n|C\r\n", `order ${texts.join("|")}`);
  await t.disconnect();
}

console.log("\n[E-STOP priority]");
{
  const t = new SerialTransport();
  const port = mockPort();
  // 第一笔慢写：期间队列里 normal2，再插 disable
  let n = 0;
  const origGetWriter = port.writable.getWriter.bind(port.writable);
  port.writable.getWriter = () => {
    const w = origGetWriter();
    const ow = w.write.bind(w);
    w.write = async (b) => {
      n += 1;
      if (n === 1) await new Promise((r) => setTimeout(r, 15));
      return ow(b);
    };
    return w;
  };
  ports.push(port);
  await t.connect(115200);
  const first = t.write("first\r\n");
  const normal2 = t.write("normal2\r\n");
  // 稍等 first 已开写
  await new Promise((r) => setTimeout(r, 1));
  const estop = t.writePriority("disable\r\n");
  const normal2Res = await normal2.then(() => "ok", (e) => e.message);
  await Promise.all([first, estop]);
  const texts = port.writerLog.map((a) => String.fromCharCode(...a));
  assert(texts[0] === "first\r\n", "first completed");
  assert(texts.includes("disable\r\n"), "estop sent");
  assert(!texts.includes("normal2\r\n"), `queued command cancelled: ${texts.join("|")}`);
  assert(normal2Res.includes("E-STOP"), `normal2 rejected with estop notice: ${normal2Res}`);
  await t.disconnect();
}

console.log("\n[disconnect rejects pending writes]");
{
  const t = new SerialTransport();
  const port = mockPort();
  let blockWrite = true;
  const origGetWriter = port.writable.getWriter.bind(port.writable);
  port.writable.getWriter = () => {
    const w = origGetWriter();
    const ow = w.write.bind(w);
    w.write = async (b) => {
      if (blockWrite) await new Promise((r) => setTimeout(r, 30));
      return ow(b);
    };
    return w;
  };
  ports.push(port);
  await t.connect(115200);
  const p1 = t.write("x\r\n").then(
    () => "resolved",
    (e) => e.message
  );
  const p2 = t.write("y\r\n").then(
    () => "resolved",
    (e) => e.message
  );
  await t.disconnect();
  blockWrite = false;
  const r1 = await p1;
  const r2 = await p2;
  assert(r1 !== "resolved" || r2 !== "resolved", `at least one pending rejected: ${r1}/${r2}`);
  assert(t.state === SerialState.DISCONNECTED, "clean disconnect");
}

console.log("\n[duplicate connect / disconnect]");
{
  const t = new SerialTransport();
  ports.push(mockPort());
  await t.connect(115200);
  await t.connect(115200); // 幂等
  assert(t.state === SerialState.READING || t.state === SerialState.CONNECTED, "double connect ok");
  await t.disconnect();
  await t.disconnect();
  assert(t.state === SerialState.DISCONNECTED, "double disconnect ok");
}

console.log("\n[reconnect after disconnect]");
{
  const t = new SerialTransport();
  ports.push(mockPort());
  ports.push(mockPort());
  await t.connect(115200);
  await t.disconnect();
  await t.connect(115200);
  assert(t.state === SerialState.READING || t.state === SerialState.CONNECTED, "reconnect");
  await t.disconnect();
}

console.log("\n[20x connect/disconnect cycles]");
{
  const t = new SerialTransport();
  for (let i = 0; i < 20; i++) {
    ports.push(mockPort());
    await t.connect(115200);
    await t.write(`ping${i}\r\n`);
    await t.disconnect();
  }
  assert(t.state === SerialState.DISCONNECTED, "20 cycles end DISCONNECTED");
}

console.log("\n[in-flight write settles on disconnect]");
{
  const t = new SerialTransport();
  const port = mockPort();
  let releaseWrite;
  const gate = new Promise((r) => {
    releaseWrite = r;
  });
  const origGetWriter = port.writable.getWriter.bind(port.writable);
  port.writable.getWriter = () => {
    const w = origGetWriter();
    const ow = w.write.bind(w);
    w.write = async (b) => {
      await gate;
      return ow(b);
    };
    return w;
  };
  ports.push(port);
  await t.connect(115200);
  const p = t.write("inflight\r\n").then(
    () => "resolved",
    (e) => e.message
  );
  // 等 write 进入 in-flight
  await new Promise((r) => setTimeout(r, 5));
  const pd = t.disconnect();
  releaseWrite();
  await pd;
  const r = await p;
  assert(r === "resolved" || r === "串口已断开", `in-flight settled: ${r}`);
  assert(t.state === SerialState.DISCONNECTED, "state clean");
}

console.log("\n[100x connect/disconnect cycles]");
{
  const t = new SerialTransport();
  for (let i = 0; i < 100; i++) {
    ports.push(mockPort());
    await t.connect(115200);
    await t.write(`p${i}\r\n`);
    await t.disconnect();
  }
  assert(t.state === SerialState.DISCONNECTED, "100 cycles end DISCONNECTED");
  assert(t.reader === null, "no leftover reader");
  assert(t.port === null, "no leftover port");
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
