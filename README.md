<div align="center">
  <img src="assets/icon.png" width="96" alt="Live Wallpaper 图标">
  <h1>Live Wallpaper</h1>
  <p>让 Wallpaper Engine 与本地动态背景自然融入 VS Code。</p>

  [![Build](https://github.com/MakotoArai-CN/vscode-wallpaper-engine/actions/workflows/package.yml/badge.svg)](https://github.com/MakotoArai-CN/vscode-wallpaper-engine/actions/workflows/package.yml)
  [![VS Code](https://img.shields.io/badge/VS%20Code-1.106.1%20%E2%86%92%20latest-007ACC?logo=visualstudiocode)](https://code.visualstudio.com/updates)
  [![Release](https://img.shields.io/github/v/release/MakotoArai-CN/vscode-wallpaper-engine?display_name=tag&sort=semver)](https://github.com/MakotoArai-CN/vscode-wallpaper-engine/releases)
  [![License](https://img.shields.io/github/license/MakotoArai-CN/vscode-wallpaper-engine)](LICENSE)
  [![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=14151a)](https://bun.sh/)
</div>

<div align="center">
  <img src="assets/preview.gif" width="820" alt="Live Wallpaper 在 VS Code 中的效果预览">
</div>

Live Wallpaper 可以在 VS Code 中使用 Wallpaper Engine 创意工坊项目，以及本地图片、视频和网页背景。它不仅负责显示壁纸，还提供界面透明化、玻璃浮层、音频响应和鼠标交互转发，让动态网页壁纸更接近在 Wallpaper Engine 中的体验。

> [!IMPORTANT]
> 扩展需要修改 VS Code 安装目录中的 workbench 文件。VS Code 更新可能覆盖这些修改，更新后重新执行一次 **Set Wallpaper: 设置壁纸** 即可。

## 功能亮点

| 壁纸与交互 | 外观与体验 | 管理与兼容 |
| --- | --- | --- |
| Wallpaper Engine 图片、视频和 Web 项目 | 编辑器、侧边栏、终端和面板透明化 | 自动发现 Steam 库与创意工坊目录 |
| 本地图片、视频、HTML 文件及目录 | `subtle`、`liquid`、`solid` 玻璃预设 | 设置面板集中管理壁纸与状态 |
| 系统音频、麦克风或模拟频谱响应 | `contain`、`cover`、`fill` 显示模式 | 大型壁纸库异步扫描与兼容性过滤 |
| 网页壁纸鼠标移动、点击和滚轮转发 | 自定义 CSS 与 JavaScript 注入 | VS Code workbench 路径自动适配 |

## 安装

### 从 GitHub Actions 下载

每次推送都会构建三个 x64 平台产物。打开最新一次 [Actions 构建](https://github.com/MakotoArai-CN/vscode-wallpaper-engine/actions/workflows/package.yml)，在 **Artifacts** 中选择当前系统：

| 系统 | Artifact | VS Code target |
| --- | --- | --- |
| Windows x64 | `vsix-win32-x64` | `win32-x64` |
| Linux x64 | `vsix-linux-x64` | `linux-x64` |
| macOS Intel | `vsix-darwin-x64` | `darwin-x64` |

下载并解压 Artifact，然后在 VS Code 中运行 **Extensions: Install from VSIX...**，选择其中的 `.vsix` 文件。

带有 `v*` 标签或手动触发的发布构建会把三个平台的 VSIX、自动生成的更新说明和 SHA-256 校验文件一并发布到 [Releases](https://github.com/MakotoArai-CN/vscode-wallpaper-engine/releases)。

### 本地构建

需要先安装 [Bun](https://bun.sh/)：

```powershell
bun install --frozen-lockfile
bun run output
```

当前平台的 VSIX 会移动到 `artifacts/` 目录。

## 快速上手

1. 打开命令面板，运行 **Open Wallpaper Settings: 打开壁纸设置**。
2. 点击 **Auto Detect** 查找 Wallpaper Engine 创意工坊，或手动填写创意工坊目录。
3. 运行 **Set Wallpaper: 设置壁纸** 并选择一个背景。
4. 按提示重新加载 VS Code 窗口，使 workbench 修改生效。

也可以通过 **Add Custom Background** 添加本地图片、视频、HTML 文件，或包含 `index.html` / 媒体文件的目录。

常见的 Windows 创意工坊路径：

```text
D:/Steam/steamapps/workshop/content/431960
```

## 壁纸兼容性

扩展在 VS Code 的 Electron / workbench 环境中渲染内容，因此最适合浏览器可以直接加载的资源。

CI 会同时在最低支持版本 `1.106.1` 和最新稳定版 VS Code 上运行扩展测试。当前已针对 VS Code `1.132.1` 的 workbench 发布目录布局完成验证；递归路径发现机制也会兼容后续版本中常见的文件位置调整。

| Wallpaper Engine 类型 | 支持情况 | 说明 |
| --- | --- | --- |
| `image` | 支持 | 加载常见图片文件 |
| `video` | 支持 | 加载常见视频文件 |
| `web` | 支持 | 加载 HTML 入口并提供部分 Wallpaper Engine Web API |
| `scene` / `scene.pkg` | 仅预览 | 无法运行 Wallpaper Engine 原生 scene 渲染器 |

`scene` 项目默认不会出现在选择列表。需要查看预览图时，可在设置面板开启 **Show preview-only wallpapers**；此模式只显示项目的 `preview.jpg` 或 `preview.png`，并不代表完整渲染 `scene.pkg`。

## 音频与交互

网页壁纸可以通过 `wallpaperRegisterAudioListener` 接收频谱数据。可选来源包括：

- **System**：采集系统播放音频；Windows 使用 WASAPI loopback，不可用时回退到模拟频谱。
- **Simulate**：生成模拟频谱，无需录音权限。
- **Microphone**：使用麦克风输入，需要系统授权。
- **Off**：关闭音频响应。

启用 **Interaction (mouse)** 后，扩展会把编辑器区域中的鼠标移动、点击和滚轮事件转发给网页壁纸，同时保留编辑器本身的输入行为。

## 常用设置

| 设置 | 用途 |
| --- | --- |
| `vscode-wallpaper-engine.workshopPath` | Wallpaper Engine 创意工坊目录；留空时自动检测 |
| `vscode-wallpaper-engine.customWallpaperPaths` | 本地背景文件或目录列表 |
| `vscode-wallpaper-engine.wallpaperFit` | `contain`、`cover` 或 `fill` |
| `vscode-wallpaper-engine.audioSource` | `off`、`simulate`、`mic` 或 `system` |
| `vscode-wallpaper-engine.interactionEnabled` | 是否向网页壁纸转发鼠标事件 |
| `vscode-wallpaper-engine.backgroundOpacity` | 编辑器背景透明度 |
| `vscode-wallpaper-engine.glassPreset` | `subtle`、`liquid` 或 `solid` 玻璃预设 |
| `vscode-wallpaper-engine.transparencyRules` | 按 VS Code 界面区域设置透明度 |
| `vscode-wallpaper-engine.customCss` | 注入额外的运行时 CSS |
| `vscode-wallpaper-engine.customJs` | 注入额外的运行时 JavaScript |

完整选项及实时预览可以在 **Open Wallpaper Settings: 打开壁纸设置** 中查看。

## 故障恢复

### 更新 VS Code 后壁纸消失

VS Code 更新会替换 workbench 文件。重新运行 **Set Wallpaper: 设置壁纸**，然后重新加载窗口。

### 出现 `[Unsupported]` 或“安装似乎损坏”

扩展会在修改或还原后同步 product checksum，以减少此类提示。如果问题仍然存在：

1. 运行 **Uninstall Wallpaper Engine: 卸载插件** 还原 workbench。
2. 重新加载 VS Code。
3. 再次设置壁纸；仍无法恢复时，重新安装 VS Code。

### 找不到创意工坊目录

确认已通过 Steam 安装 Wallpaper Engine，并用 **Auto Detect** 重新扫描。使用多个 Steam 库时，也可以直接把 `workshop/content/431960` 目录填入 `workshopPath`。

## 开发

```powershell
bun install --frozen-lockfile
bun run check-types
bun run lint
bun run test
bun run output
```

项目的主要模块：

- `src/core/scanner.ts`：创意工坊扫描和兼容性过滤。
- `src/core/workshop-detector.ts`：Steam 库与创意工坊路径检测。
- `src/core/injector.ts`：workbench 修改和壁纸注入。
- `src/core/server.ts`：本地资源服务与 Wallpaper Engine API 兼容层。
- `src/core/audio-capture.ts`：原生系统音频采集。
- `media/`：扩展设置面板。

更完整的运行时通信流程见 [通信架构](docs/COMMUNICATION.md)。

## 鸣谢

本项目延续并改造自 [vakesamahere/vscode-wallpaper-engine](https://github.com/vakesamahere/vscode-wallpaper-engine) 的思路和基础实现。感谢原作者与贡献者的开源工作。

## 许可证

本项目采用 [MIT License](LICENSE)。
