/**
 * 电机参数多层状态管理内核 (MotorParamManager)
 * 严格遵从工业级状态机解耦：
 * Sources (来源池) -> Candidate (界面候选) -> Active (MCU RAM 正在运行) -> Persistent (Flash 已固化)
 * 具备单向 DAG 推导追踪、极对数硬门禁、会话级 Dirty 标志与辨识事务机制。
 */

import {
  MOTOR_SCHEMA,
  calcKvFromFlux,
  calcFluxFromKv,
  calcSaliency,
} from "./motor-schema.js";

export class MotorParamManager {
  constructor() {
    // 参数核心状态字典
    this.params = {};
    // 会话级 Flash 同步标志：当 RAM 被修改后为 true，conf write 后为 false
    this.flashDirty = false;
    // 极对数两级确认门禁标志
    this.ppConflict = false;
    this.ppConflictDetails = null;
    this.ppConfirmedByUser = false;
    // 辨识事务缓存 (Candidate Session)
    this.activeSession = null;

    this._initParams();
  }

  /** 初始化 12 项参数数据结构 */
  _initParams() {
    for (const [key, schema] of Object.entries(MOTOR_SCHEMA)) {
      const isIdent = schema.defaultSource === "identified";
      const hasDef = schema.defaultVal !== null && schema.defaultVal !== undefined;
      const initSource = hasDef ? (isIdent ? "identified" : "manual") : "unknown";

      this.params[key] = {
        key,
        schema,
        // 1. 多来源参考池：手填(manual) 与 系统辨识(identified)
        sources: {
          manual: hasDef && !isIdent && schema.sources.includes("manual") ? schema.defaultVal : null,
          identified: hasDef && isIdent && schema.sources.includes("identified") ? schema.defaultVal : null,
        },
        // 2. 界面当前准备采纳/编辑的候选值 (Candidate)
        // 来源统一为: "manual" (手填) | "identified" (辨识) | "active" (读取) | "unknown" (空)
        candidate: {
          value: hasDef ? schema.defaultVal : null,
          source: initSource,
          userModified: false, // 用户是否键盘修改
        },
        // 3. 单片机 RAM 真实当前运行值 (Active)
        active: {
          value: null,
          source: null,
          synced: false,
        },
        // 4. 单片机 Flash 固化持久化值 (Persistent)
        persistent: {
          value: null,
        },
        // 5. 分歧与偏差分析
        diff: {
          status: "none", // "none" | "info" | "warning" | "critical"
          ratio: 0,
          message: "",
        },
        // 6. 推导追溯记录 (用于展开公式和输入值)
        calculation: null,
      };
    }
    // 初始执行一次自动推导分析
    this.recomputeInferences();
  }

  /** 获取某一参数的完整状态包 */
  get(key) {
    return this.params[key] || null;
  }

  /** 获取所有参数字典 */
  getAll() {
    return this.params;
  }

  /**
   * 用户在界面上修改输入框 (明确写入 Manual/用户层)
   * @param {string} key
   * @param {number|string|null} rawVal
   */
  setUserInput(key, rawVal) {
    const p = this.params[key];
    if (!p) return;

    let val = null;
    if (rawVal !== "" && rawVal !== null && rawVal !== undefined) {
      if (key === "motor_name") {
        val = String(rawVal).trim();
      } else {
        const num = Number(rawVal);
        // 彻底杜绝 0 / -1 作为有效物理量，0 或 -1 视为 null 未知
        if (Number.isFinite(num) && (num > 0 || key === "motor_name")) {
          val = num;
        }
      }
    }

    // 记录进 manual 来源层
    p.sources.manual = val;
    // 设定 candidate
    p.candidate.value = val;
    p.candidate.source = val !== null ? "manual" : "unknown";
    p.candidate.userModified = true;

    if (key === "pp") {
      this.ppConfirmedByUser = false;
    }

    // 触发单向依赖推导
    this.recomputeInferences();
    // 刷新分歧判定
    this.updateDiffAnalysis();
  }

  /**
   * 单向 DAG 自动推导引擎 (带公式与输入溯源)
   * 严格遵循权威链：实测真值 > 手册反推估算，已有实测时绝不覆盖！
   */
  recomputeInferences() {
    const ppVal = this.getEffectiveValue("pp");
    const fluxVal = this.getEffectiveValue("flux");
    const manualKv = this.params.kv.sources.manual;

    // 1. 推导 KV：当且仅当有磁链且有极对数时，由公式计算 KV
    if (fluxVal && ppVal) {
      const calcKv = calcKvFromFlux(fluxVal, ppVal);
      if (calcKv) {
        this.params.kv.sources.identified = calcKv;
        this.params.kv.calculation = {
          formula: "KV = 60 / (√3 · 2π · pp · Ψf)",
          inputs: { flux: fluxVal, pp: ppVal },
          timestamp: Date.now(),
        };
        // 若用户未手动锁死 KV，Candidate 采用辨识值
        if (!this.params.kv.candidate.userModified || !this.params.kv.candidate.value) {
          this.params.kv.candidate.value = calcKv;
          this.params.kv.candidate.source = "identified";
        }
      }
    }

    // 2. 推导磁链 Flux：若没有硬件实测磁链，但手册已知 KV 和极对数，则反推估算磁链
    const hasIdentFlux = !!(this.params.flux.sources.identified);
    if (!hasIdentFlux && manualKv && ppVal) {
      const estimatedFlux = calcFluxFromKv(manualKv, ppVal);
      if (estimatedFlux) {
        this.params.flux.sources.identified = estimatedFlux;
        this.params.flux.calculation = {
          formula: "Ψf = 60 / (√3 · 2π · pp · KV_manual) [推导]",
          inputs: { kv: manualKv, pp: ppVal },
          timestamp: Date.now(),
        };
        // 仅在候选磁链为空或当前来自辨识推导时才自动更新候选
        if (!this.params.flux.candidate.value || this.params.flux.candidate.source === "identified") {
          this.params.flux.candidate.value = estimatedFlux;
          this.params.flux.candidate.source = "identified";
        }
      }
    }

    // 3. 推导 dq 轴电感：隐极表贴假设 (Ld = Ls, Lq = Ls)，若未单独覆写则由相电感测算同步
    const lsVal = this.getEffectiveValue("ls");
    if (lsVal) {
      if (!this.params.ld.candidate.userModified || !this.params.ld.candidate.value) {
        this.params.ld.sources.identified = lsVal;
        this.params.ld.calculation = {
          formula: "Ld = Ls [隐极假设]",
          inputs: { ls: lsVal },
          timestamp: Date.now(),
        };
        this.params.ld.candidate.value = lsVal;
        this.params.ld.candidate.source = "identified";
      }
      if (!this.params.lq.candidate.userModified || !this.params.lq.candidate.value) {
        this.params.lq.sources.identified = lsVal;
        this.params.lq.calculation = {
          formula: "Lq = Ls [隐极假设]",
          inputs: { ls: lsVal },
          timestamp: Date.now(),
        };
        this.params.lq.candidate.value = lsVal;
        this.params.lq.candidate.source = "identified";
      }
    }

    // 4. 推导凸极比 Saliency (Lq / Ld)
    const ldVal = this.getEffectiveValue("ld");
    const lqVal = this.getEffectiveValue("lq");
    if (ldVal && lqVal) {
      const sal = calcSaliency(lqVal, ldVal);
      if (sal) {
        this.params.saliency.sources.identified = sal;
        this.params.saliency.calculation = {
          formula: "凸极比 = Lq / Ld",
          inputs: { lq: lqVal, ld: ldVal },
          timestamp: Date.now(),
        };
        this.params.saliency.candidate.value = sal;
        this.params.saliency.candidate.source = "identified";
      }
    }
  }

  /** 获取某参数当前的有效值 (Candidate > Active > Manual) */
  getEffectiveValue(key) {
    const p = this.params[key];
    if (!p) return null;
    if (p.candidate.value !== null) return p.candidate.value;
    if (p.active.value !== null) return p.active.value;
    if (p.sources.manual !== null) return p.sources.manual;
    return null;
  }

  /**
   * 刷新所有参数的分歧/偏差分析 (Diff Analysis)
   */
  updateDiffAnalysis() {
    this.ppConflict = false;
    this.ppConflictDetails = null;

    for (const [key, p] of Object.entries(this.params)) {
      p.diff = { status: "none", ratio: 0, message: "" };
      const schema = p.schema;
      if (!schema.diffPolicy) continue;

      const manual = p.sources.manual;
      const identified = p.sources.identified;

      // 如果只有一种来源，不存在分歧
      if (manual === null || identified === null) continue;

      // 1. 极对数精确匹配门禁 (Exact 0% 容差)
      if (schema.diffPolicy.type === "exact") {
        if (Math.round(manual) !== Math.round(identified)) {
          if (this.ppConfirmedByUser) {
            p.diff = {
              status: "info",
              ratio: 0,
              message: `极对数分歧已由人工确认解除 (当前候选: ${p.candidate.value})`,
            };
            this.ppConflict = false;
          } else {
            p.diff = {
              status: "critical",
              ratio: 1.0,
              message: `极对数严重冲突：手册标称 ${manual}，辨识测得 ${identified}！禁止自动合流。`,
            };
            this.ppConflict = true;
            this.ppConflictDetails = { manual, identified };
          }
        }
        continue;
      }

      // 2. 相对偏差百分比比较
      if (schema.diffPolicy.type === "relative") {
        const diffAbs = Math.abs(identified - manual);
        const ref = Math.abs(manual) > 0.000001 ? Math.abs(manual) : Math.abs(identified);
        const ratio = ref > 0 ? diffAbs / ref : 0;
        p.diff.ratio = ratio;

        const warnThreshold = schema.diffPolicy.warning || 0.15;
        if (ratio > warnThreshold) {
          const pct = (ratio * 100).toFixed(1);
          p.diff.status = "warning";
          p.diff.message = `实测值与手册标称偏差达 ${pct}% (阈值 ${warnThreshold * 100}%)`;
        } else if (ratio > 0.03) {
          const pct = (ratio * 100).toFixed(1);
          p.diff.status = "info";
          p.diff.message = `微小偏差 ${pct}%，在工程容差范围内`;
        }
      }
    }
  }

  /**
   * 人工裁决解除极对数冲突门禁
   * @param {"manual"|"identified"} choice
   */
  confirmPpChoice(choice) {
    const pp = this.params.pp;
    if (!pp) return;
    const chosenVal = choice === "manual" ? pp.sources.manual : pp.sources.identified;
    if (chosenVal) {
      this.ppConfirmedByUser = true;
      pp.candidate.value = chosenVal;
      pp.candidate.source = choice;
      pp.diff = {
        status: "info",
        ratio: 0,
        message: `已由人工确认采纳 ${choice === "manual" ? "手册标称" : "实测辨识"} 值 (${chosenVal})`,
      };
      this.ppConflict = false;
      this.ppConflictDetails = null;
      this.recomputeInferences();
      this.updateDiffAnalysis();
    }
  }

  /**
   * 单项采纳指定来源的值
   * @param {string} key 参数名
   * @param {"manual"|"identified"|"active"} sourceName
   */
  selectSourceForCandidate(key, sourceName) {
    const p = this.params[key];
    if (!p) return false;

    // 若采纳手填但手填池尚未赋值，平滑继承当前候选值作为基准
    if (sourceName === "manual" && (p.sources.manual === null || p.sources.manual === undefined)) {
      if (p.candidate.value !== null) {
        p.sources.manual = p.candidate.value;
      }
    }

    let targetVal = null;
    if (sourceName === "active") {
      targetVal = p.active.value;
    } else {
      targetVal = p.sources[sourceName];
    }

    if (targetVal !== null && targetVal !== undefined) {
      p.candidate.value = targetVal;
      p.candidate.source = sourceName;
      p.candidate.userModified = false;
      this.recomputeInferences();
      this.updateDiffAnalysis();
      return true;
    }
    return false;
  }

  /**
   * 启动一次新的辨识会话 (Candidate Session)
   * @param {"full"|"rs"|"ls"|"flux"|"calib"} type
   */
  startIdentSession(type = "full") {
    this.activeSession = {
      id: "sess_" + Date.now(),
      type,
      startTime: Date.now(),
      status: "running",
      results: {},
      conflicts: [],
    };
    return this.activeSession;
  }

  /**
   * 将固件 CLI 捕获到的辨识结果灌入 Session
   * @param {object} parsedData { rs, ls, ld, lq, flux, pp }
   */
  feedIdentResult(parsedData = {}) {
    if (!this.activeSession) this.startIdentSession("adhoc");

    for (const [k, v] of Object.entries(parsedData)) {
      if (v !== null && v !== undefined && this.params[k]) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) {
          this.activeSession.results[k] = num;
          // 统一归入系统辨识池 (identified)
          this.params[k].sources.identified = num;
        }
      }
    }

    this.activeSession.status = "completed";
    this.recomputeInferences();
    this.updateDiffAnalysis();

    // 检查是否有硬冲突项 (如极对数)
    this.activeSession.conflicts = [];
    if (this.ppConflict) {
      this.activeSession.conflicts.push("pp");
    }

    return this.activeSession;
  }

  /**
   * 批量采纳 Session 中的结果
   * @param {boolean} skipConflicts 是否跳过冲突项 (默认 true，安全门禁)
   * @returns {{ appliedCount: number, skippedKeys: string[] }}
   */
  applyIdentSession(skipConflicts = true) {
    if (!this.activeSession || !this.activeSession.results) {
      return { appliedCount: 0, skippedKeys: [] };
    }

    let appliedCount = 0;
    const skippedKeys = [];

    for (const [k, val] of Object.entries(this.activeSession.results)) {
      // 若开启冲突保护且该项处于冲突状态，坚决跳过！
      if (skipConflicts && this.params[k]?.diff.status === "critical") {
        skippedKeys.push(k);
        continue;
      }

      const p = this.params[k];
      if (p) {
        p.candidate.value = val;
        p.candidate.source = "identified";
        p.candidate.userModified = false;
        appliedCount++;
      }
    }

    this.recomputeInferences();
    this.updateDiffAnalysis();
    return { appliedCount, skippedKeys };
  }

  /** 清理放弃当前 Session */
  discardIdentSession() {
    this.activeSession = null;
  }

  /**
   * 将单片机 conf read 读出的当前 RAM 配置存入 active 层
   * @param {object} ramData { pp, max_rpm, rs, ls, ld, lq, flux, kv }
   */
  syncFromMcuRam(ramData = {}) {
    for (const [k, v] of Object.entries(ramData)) {
      if (v !== null && v !== undefined && this.params[k]) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) {
          this.params[k].active.value = num;
          this.params[k].active.synced = true;
          // 若候选层尚为空，自动以当前设备 RAM 填入
          if (this.params[k].candidate.value === null) {
            this.params[k].candidate.value = num;
            this.params[k].candidate.source = "active";
          }
        }
      }
    }
    // 同步计算读取层 (Active) 的 KV 与凸极比
    if (this.params.flux.active.value && this.params.pp.active.value) {
      const actKv = calcKvFromFlux(this.params.flux.active.value, this.params.pp.active.value);
      if (actKv) {
        this.params.kv.active.value = actKv;
        this.params.kv.active.synced = true;
      }
    }
    if (this.params.ld.active.value && this.params.lq.active.value) {
      const actSal = calcSaliency(this.params.lq.active.value, this.params.ld.active.value);
      if (actSal) {
        this.params.saliency.active.value = actSal;
        this.params.saliency.active.synced = true;
      }
    }
    this.recomputeInferences();
    this.updateDiffAnalysis();
  }

  /**
   * 用户将候选参数应用到 MCU RAM 成功后标记
   */
  markAppliedToMcu() {
    for (const p of Object.values(this.params)) {
      if (p.candidate.value !== null) {
        p.active.value = p.candidate.value;
        p.active.source = p.candidate.source;
        p.active.synced = true;
      }
    }
    // RAM 已修改，尚未固化到 Flash
    this.flashDirty = true;
  }

  /**
   * 用户成功执行 conf write 固化到 Flash 后标记
   */
  markPersistedToFlash() {
    for (const p of Object.values(this.params)) {
      p.persistent.value = p.active.value;
    }
    this.flashDirty = false;
  }

  /**
   * 全参数就绪与闭环安全性诊断报告 (Readiness Engine)
   */
  getReadinessReport() {
    let readyCount = 0;
    const totalCount = Object.keys(this.params).length;
    const blockers = [];
    const warnings = [];

    // 检查核心阻抗与安全参数
    const ppVal = this.getEffectiveValue("pp");
    const rsVal = this.getEffectiveValue("rs");
    const lsVal = this.getEffectiveValue("ls");
    const fluxVal = this.getEffectiveValue("flux");
    const maxRpmVal = this.getEffectiveValue("max_rpm");

    if (!ppVal || ppVal < 1) blockers.push("极对数 (pp) 未确定或非法");
    if (this.ppConflict) blockers.push("极对数存在严重冲突，需人工裁决");
    if (!rsVal || rsVal <= 0.0001) blockers.push("相电阻 (Rs) 未测量");
    if (!lsVal || lsVal <= 0.01) blockers.push("相电感 (Ls) 未测量");
    if (!fluxVal || fluxVal <= 0.00001) blockers.push("磁链 (Flux) 未确定");
    if (!maxRpmVal || maxRpmVal <= 100) blockers.push("最大转速 (max_rpm) 未配置");

    for (const p of Object.values(this.params)) {
      if (p.candidate.value !== null && p.candidate.value !== undefined) {
        readyCount++;
      }
      if (p.diff.status === "warning") {
        warnings.push(`${p.schema.name}: ${p.diff.message}`);
      }
    }

    const canCloseLoop = blockers.length === 0;

    return {
      readyCount,
      totalCount,
      canCloseLoop,
      blockers,
      warnings,
      flashDirty: this.flashDirty,
    };
  }
}
