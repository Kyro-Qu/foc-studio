/**
 * 回显捕获串行化回归测试
 *
 * 复现 2026-09-18 排查出的“上位机时好时坏”根因：
 * 多个面板并发 sendCapture 时，旧实现用 prev/restore 嵌套，
 * 先结束者把 state.capture 恢复成 null，后来者的回显全部丢失。
 *
 * 这里把 main.js 里的串行队列逻辑抽成同构实现验证其行为契约：
 *   1. 并发发起的捕获必须按序执行、互不串扰；
 *   2. 每个捕获只收到属于自己命令窗口内的文本；
 *   3. 某个捕获抛错不能阻塞队列。
 */
import assert from "node:assert/strict";

let passed = 0;
const check = (label, cond) => {
  if (!cond) throw new Error("FAIL " + label);
  passed++;
  console.log("  PASS  " + label);
};

// ---- 与 main.js 等价的实现 ----
function makeCaptureRig() {
  const state = { capture: null };
  const sent = [];
  let captureChain = Promise.resolve();
  const feedText = (s) => {
    if (state.capture) state.capture(s);
  };
  // 模拟下位机：收到命令后 5ms 回显 "<cmd> ok\r\n"
  const run = async (cmd) => {
    sent.push(cmd);
    if (cmd === "boom") throw new Error("write failed");
    setTimeout(() => feedText(`${cmd} ok\r\n`), 5);
  };
  function sendCapture(cmd, ms = 30) {
    const job = captureChain.then(async () => {
      let buf = "";
      state.capture = (s) => {
        buf += s;
      };
      try {
        await run(cmd);
        await new Promise((r) => setTimeout(r, ms));
      } finally {
        state.capture = null;
      }
      return buf;
    });
    captureChain = job.catch(() => {});
    return job;
  }
  return { sendCapture, sent, state };
}

console.log("\n[capture 串行化：并发 4 命令互不串扰]");
{
  const rig = makeCaptureRig();
  const results = await Promise.all([
    rig.sendCapture("version"),
    rig.sendCapture("status"),
    rig.sendCapture("limit"),
    rig.sendCapture("vbus"),
  ]);
  check("version 只收到自己的回显", results[0] === "version ok\r\n");
  check("status 只收到自己的回显", results[1] === "status ok\r\n");
  check("limit 只收到自己的回显", results[2] === "limit ok\r\n");
  check("vbus 只收到自己的回显", results[3] === "vbus ok\r\n");
  check("命令按发起顺序串行下发", rig.sent.join(",") === "version,status,limit,vbus");
  check("队列排空后 capture 归零", rig.state.capture === null);
}

console.log("\n[capture 串行化：某条失败不阻塞后续]");
{
  const rig = makeCaptureRig();
  const a = rig.sendCapture("boom").catch((e) => "ERR:" + e.message);
  const b = rig.sendCapture("status");
  const [ra, rb] = await Promise.all([a, b]);
  check("失败的捕获正确抛错", ra === "ERR:write failed");
  check("后续捕获照常拿到回显", rb === "status ok\r\n");
}

console.log("\n[对照：旧嵌套实现在并发下确实丢回显（证明修复必要）]");
{
  // 手工控制回显时刻，构造“先起的捕获先结束、后起的捕获回显晚到”这一真实时序：
  //   t=0   a 起（窗口 20ms）
  //   t=5   b 起（窗口 60ms）
  //   t=20  a 结束 -> 旧实现把 state.capture 恢复为 a 之前的值（null），b 被踢掉
  //   t=30  b 的回显才到达 -> 旧实现丢失；新实现因串行执行，b 直到 a 完成后才发命令，不会丢
  const buildRig = (impl) => {
    const state = { capture: null };
    const feed = (s) => {
      if (state.capture) state.capture(s);
    };
    const run = async () => {};
    let chain = Promise.resolve();
    const legacy = async (cmd, ms) => {
      let buf = "";
      const prev = state.capture;
      state.capture = (s) => {
        buf += s;
        if (prev) prev(s);
      };
      await run(cmd);
      await new Promise((r) => setTimeout(r, ms));
      state.capture = prev;
      return buf;
    };
    const serial = (cmd, ms) => {
      const job = chain.then(async () => {
        let buf = "";
        state.capture = (s) => {
          buf += s;
        };
        try {
          await run(cmd);
          // 命令真正下发的那一刻才安排回显（新实现里 b 的命令在 a 结束后才发）
          setTimeout(() => feed(`${cmd} ok\r\n`), 25);
          await new Promise((r) => setTimeout(r, ms));
        } finally {
          state.capture = null;
        }
        return buf;
      });
      chain = job.catch(() => {});
      return job;
    };
    return { state, feed, sendCapture: impl === "legacy" ? legacy : serial };
  };

  // 旧实现：回显时刻由外部固定安排（模拟真实串口异步到达）
  const L = buildRig("legacy");
  const la = L.sendCapture("a", 20);
  setTimeout(() => L.feed("a ok\r\n"), 5);
  await new Promise((r) => setTimeout(r, 5));
  const lb = L.sendCapture("b", 60);
  setTimeout(() => L.feed("b ok\r\n"), 30); // a 已在 t=20 结束并把 capture 清空
  const [lra, lrb] = await Promise.all([la, lb]);
  check("旧实现：a 正常收到", lra === "a ok\r\n");
  check("旧实现：b 的回显丢失（复现缺陷）", lrb === "");

  // 新实现：同样并发发起，b 不会丢
  const S = buildRig("serial");
  const [sra, srb] = await Promise.all([S.sendCapture("a", 40), S.sendCapture("b", 40)]);
  check("新实现：a 正常收到", sra === "a ok\r\n");
  check("新实现：b 正常收到（缺陷已修复）", srb === "b ok\r\n");
}

console.log("\n[长任务支持：ident/calib 不被 25ms 空闲截断，直到收到 DONE 才完成]");
{
  function makeSmartCaptureRig() {
    const state = { capture: null };
    let captureChain = Promise.resolve();
    const feed = (s) => {
      if (state.capture) state.capture(s);
    };

    function sendCapture(cmd, opts = 400) {
      const timeoutMs = typeof opts === "number" ? opts : (opts?.timeout || 400);
      const customMatcher = typeof opts === "object" ? opts?.endMatcher : null;
      const trimmed = cmd.trim();
      const isLongTask = trimmed.startsWith("ident") ||
                         (trimmed.startsWith("calib") && !trimmed.startsWith("calib offset")) ||
                         trimmed.startsWith("blackbox");
      const idleMs = (typeof opts === "object" && opts?.idleMs !== undefined)
        ? opts.idleMs
        : (isLongTask ? 0 : 25);

      const job = captureChain.then(() => {
        return new Promise((resolve) => {
          let buf = "";
          let resolved = false;
          let idleTimer = null;
          let hardTimer = null;

          const finish = () => {
            if (resolved) return;
            resolved = true;
            if (idleTimer) clearTimeout(idleTimer);
            if (hardTimer) clearTimeout(hardTimer);
            state.capture = null;
            resolve(buf);
          };

          const checkEnd = (str) => {
            if (customMatcher) {
              if (typeof customMatcher === "function") return customMatcher(str);
              if (customMatcher instanceof RegExp) return customMatcher.test(str);
              if (typeof customMatcher === "string") return str.includes(customMatcher);
            }
            if (trimmed.startsWith("ident")) {
              return str.includes("ident DONE:") || str.includes("ident FAIL:") ||
                     str.includes("err: ident") || str.includes("err: no valid result");
            }
            if (trimmed.startsWith("calib") && !trimmed.startsWith("calib offset")) {
              return str.includes("calib DONE") || str.includes("calib FAIL") ||
                     str.includes("err: calib");
            }
            if (trimmed === "status") return str.includes("cpu=");
            return false;
          };

          state.capture = (s) => {
            buf += s;
            if (checkEnd(buf)) {
              finish();
              return;
            }
            if (idleMs > 0 && !isLongTask) {
              if (idleTimer) clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                if (buf.length > 0) finish();
              }, idleMs);
            }
          };

          hardTimer = setTimeout(finish, timeoutMs);
        });
      });

      captureChain = job.catch(() => {});
      return job;
    }

    return { state, feed, sendCapture };
  }

  const rig = makeSmartCaptureRig();

  // 1. 验证短命令 status 在 25ms 空闲后快速返回
  const t0 = Date.now();
  const pStatus = rig.sendCapture("status", 500);
  setTimeout(() => rig.feed("status line 1\r\n"), 5);
  const rStatus = await pStatus;
  const dtStatus = Date.now() - t0;
  check("短命令 status 正常返回", rStatus.includes("status line 1"));
  check("短命令 status 靠 25ms 空闲快速结束 (<80ms)", dtStatus < 80);

  // 2. 验证长任务 ident full 在首行后哪怕静止 60ms（>25ms）也不截断，直到收到 ident DONE:
  const t1 = Date.now();
  const pIdent = rig.sendCapture("ident full", 2000);
  // t=5ms 输出启动声明
  setTimeout(() => rig.feed("ident start: Full Suite\r\n"), 5);
  // t=45ms 依然处于静止期（距离首行已过 40ms > 25ms，旧实现会在这里死掉并返回）
  // t=70ms 输出最终结果
  setTimeout(() => rig.feed("ident: Rs=0.1000\r\nident DONE: complete!\r\n"), 70);
  const rIdent = await pIdent;
  const dtIdent = Date.now() - t1;
  check("长任务 ident 未被 25ms 静默提前截断", rIdent.includes("ident: Rs=0.1000"));
  check("长任务 ident 完整包含 ident DONE:", rIdent.includes("ident DONE: complete!"));
  check("长任务在收到 ident DONE: 后立即完成 (~70ms)", dtIdent >= 65 && dtIdent < 150);

  // 3. 验证长任务 calib full 在收到 calib DONE 后立即返回
  const pCalib = rig.sendCapture("calib full", 2000);
  setTimeout(() => rig.feed("M0 calib start (full)\r\n"), 5);
  setTimeout(() => rig.feed("M0 calib DONE offset=1.0186rad dir=1\r\n"), 60);
  const rCalib = await pCalib;
  check("长任务 calib 完整包含 calib DONE", rCalib.includes("M0 calib DONE"));
}

console.log(`\nResult: ${passed} passed, 0 failed`);
