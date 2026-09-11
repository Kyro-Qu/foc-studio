# COM44 硬件实测记录

**日期**：2026-09-12  
**板卡**：Matchstick_HFOC_G431  
**端口**：COM44 @ **6500000** 8N1  
**固件**：FOC_G431 **v0.3.11** cli=2（Sep 9 2026）

## 结果

| 项 | 结果 |
|----|------|
| 端口打开 | PASS |
| `log 0` → `telem=0` | PASS |
| `version` | PASS — 见上 |
| `status` | PASS — IDLE / vf / vbus=14.44V / fault=0 / calib=0* / cpu=7.4% |
| `log 1` JustFloat | PASS — ~350ms 采到 **177** 个 `00 00 80 7F` tail，≈ 177×68=12036 B，与 12045 B 吻合 |

## CLI 功能矩阵（tools/test-all-cli.ps1）

**22 PASS / 0 FAIL**

| 命令 | 结果 |
|------|------|
| log 0 / log / log 1 | PASS |
| help / version / status | PASS |
| motor 0 / mode / mode vf | PASS |
| enable / disable | PASS（disable 回 IDLE） |
| fault / fault clear | PASS |
| rpm 0 / vq / vf slope | PASS |
| limit 5.2 | PASS |
| vel kp / current | PASS |
| conf read | PASS（conf params） |
| JustFloat 流 | PASS（181 tail / 12317 B） |
| 遥测中发 status | PASS（CLI 仍可用） |

## 全功能矩阵复测（demux 修复后）

**35 PASS / 0 FAIL** · `tools/test-hw-full.ps1` · COM44 空闲时

| 组 | 覆盖 |
|----|------|
| Terminal | help / version / status / log 0·1·query |
| Console | enable / disable / fault / fault clear |
| 模式 | iq / vel / pos / vf + target 0（IDLE） |
| Dashboard | rpm 0 / vq |
| Tuning | limit / current bw / vel kp·ki·ramp·filter / pos kp / vf slope |
| JustFloat | 密度校验 + 遥测中 status 混流 |
| 存储 | conf read；测后恢复 RAM 参数 |

**教训**：不要发裸 `calib`（会进校准态）；切 mode 前必须 IDLE。

未测：高速 target、conf write/erase。

## 电机控制套件（机械安全确认后）

| 项 | 结果 |
|----|------|
| `calib full` | PASS，`calib=1`，回 IDLE |
| VF 开环 180 rpm | PASS（实测 184） |
| Iq 0.2A | PASS（无 fault） |
| Position 0.5 rad | PASS |
| **Velocity 闭环** | **FAIL — 超调/振荡（目标 100~150，实测冲到 300~900）** |

**结论**：Host 的 CLI/JustFloat/使能链路正常；速度环不稳是 **固件 PID/斜坡** 问题，不是 FOC Studio 上位机 bug。需在 Tuning 里降 `vel kp/ki` 或调 `vel ramp`。

顺序注意：**必须先 `calib full`**，否则闭环报 `fault=6 NOT_CALIBRATED`。

## 注意

1. **先 `log 0` 再发 CLI**，否则遥测二进制会混进命令解析（实测 `version` 被污染成 `unknown`）。  
2. FOC Studio Web 在发 CLI 前不必手关 log：JustFloat 解复用会剥离帧；但 PowerShell 直连建议先 `log 0`。  
3. 斜坡默认 500 Hz 左右（`FOC_TELEMETRY_DIV`），非 1 kHz。  
4. 上电 `rst_flags` 含 BOR+PIN（正常上电复位）。  
5. 校准标志 `calib=0*`：Flash 有偏移，轴仍 IDLE。

## 脚本

```powershell
powershell -File tools\test-com44-b.ps1
```

结束后应执行 `log 0` 关遥测。
