# FOC Studio

网页版 FOC 上位机：兼容 G431B-FOC 的 **JustFloat 遥测 + ASCII CLI**，不依赖 VOFA+。

**不修改单片机固件。**

## 在线使用（GitHub Pages）

打开部署地址后：

1. 使用 **Chrome / Edge**（Web Serial）
2. Simulation 模式可直接看波形
3. 接真板：切换 **UART** → Baud **6500000** → Connect

> Web Serial 需要 HTTPS（Pages 已满足）或 localhost。

## 功能（v0.2）

| 模块 | 能力 |
|------|------|
| **Scope** | 16 通道、min/max 保峰绘制、双游标 Δt/Δy、触发（Auto/Normal、边沿/电平）、滚轮缩放、PNG/CSV 导出、数学通道 a±b / \|a\| / da/dt |
| **Dashboard** | 与 Scope 同一 TelemetryStore |
| **Console** | Enable/Disable/E-STOP、mode、target/rpm/vq、自定义 CLI 按钮 |
| **Terminal** | CLI + JustFloat 自动解复用、历史、Raw RX |
| **Record** | 录制、标记、CSV/JSON 导出、CSV 回放 |
| **Simulation** | 无板 1 kHz 自测 |

## 本地开发

```powershell
# 测试
npm test

# 预览
python -m http.server 8765
# http://localhost:8765
```

## 协议

JustFloat：`16 × float32-LE + 00 00 80 7F`（68 字节），通道与 `foc_telemetry.h` 对齐。

CLI 见固件 `help`（`foc_cmd.h`）。

## 架构

```
UI (Scope / Console / Terminal / Record)
        │
  Math + Trigger + Measure
        │
  TelemetryAdapter → Store
        │
  JustFloatDecoder / Sim / Replay / Serial
```

Phase 2+ 可在此挂 Binary Protocol Decoder，UI 不必重写。

## License

MIT
