# FOC 上位机参考项目笔记

本地路径：`D:\code\mcu\stm32\FOC\References\`（**不进 foc-studio 仓库**，避免体积）。

| 目录 | 项目 | 对 foc-studio 的价值 |
|------|------|----------------------|
| `ODrive/` | ODrive | Native 协议 / endpoint / ASCII 双栈、Web GUI |
| `bldc/` + `vesc-tool/` | VESC | 命令协议 + 工具链、实时页面组织 |
| `SimpleFOCStudio/` | SimpleFOC Studio | Python GUI + Commander 会话模型 |
| `simplefoc-webcontroller/` | WebController | **Web Serial 行协议 / LineBreakTransformer / 绘图** |
| `hoverboard-web-serial/` / `EFeru-hoverboard-FOC/` | Hoverboard FOC | 工业板 Web 串口调参实践 |
| `moteus/` / `Tinymovr/` | 高性能驱动 | 配置/遥测产品化 |
| `Arduino-FOC/` | SimpleFOC lib | Commander ASCII 语义 |

## 已借鉴（相对 v0.3.3）

1. **双接口**：ASCII CLI 给人 + JustFloat/后续 Binary 给软件（ODrive/VESC 思路）  
2. **Web Serial**：`simplefoc-webcontroller` 的按行变换与连接 UX  
3. **工具页结构**：Dashboard / Scope / Console / Tuning / Terminal / Record（VESC Tool 分区）  
4. **表盘 + 滑条**：VESC 实时页常见控件  
5. **协议与 UI 解耦**：Adapter + Store，便于以后换 Decoder  

## 值得继续抄的细节

- WebController：`LineBreakTransformer`、端口枚举、断线重连提示  
- VESC Tool：参数分组树、故障页布局、固件/配置页  
- ODrive：设备发现、endpoint 描述（Phase 2 Binary）  
- Hoverboard：电流/速度双滑条 + 安全使能流程  

## 刻意不抄

- 完整 VESC 二进制协议（历史包袱）  
- Qt/Electron 壳（保持纯 Web）  

维护：浅克隆 `git clone --depth 1`；更新时 `git -C <dir> pull`。
