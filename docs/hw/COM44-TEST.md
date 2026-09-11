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
