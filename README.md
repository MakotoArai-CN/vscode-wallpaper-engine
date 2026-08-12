# Live Wallpaper

[![Version](https://img.shields.io/visual-studio-marketplace/v/vakesamahere.vscode-live-wallpaper)](https://marketplace.visualstudio.com/items?itemName=vakesamahere.vscode-live-wallpaper)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/vakesamahere.vscode-live-wallpaper)](https://marketplace.visualstudio.com/items?itemName=vakesamahere.vscode-live-wallpaper)

Live Wallpaper 可以把 Wallpaper Engine 创意工坊壁纸和本地自定义背景带入 VS Code。它支持图片、视频、网页背景，提供可调节的编辑器透明化，并带有液态玻璃风格的设置面板，用于调整模糊、透明度和浮层可读性。

<img src="assets/preview.gif" width="600" alt="Live Wallpaper 预览">

## 功能

- 自动检测 Steam 中的 Wallpaper Engine 创意工坊目录。
- 支持本地图片、视频、HTML 文件，或包含 `index.html` / 媒体文件的目录。
- 支持命令面板、补全框、悬浮提示、弹窗和设置页的液态玻璃效果。
- 支持编辑器、侧边栏、终端、面板等 VS Code 区域的透明化规则。
- 图片和视频支持 `contain`、`cover`、`fill` 三种显示方式。
- 设置面板提供服务器状态检查、自动检测目录、添加自定义背景、透明化控制和玻璃效果预览。
- 使用 Bun 进行依赖管理、测试和打包。

## 兼容性

本扩展运行在 VS Code 的 Electron / workbench 环境里，因此只能直接渲染浏览器友好的壁纸资源。

扩展声明支持 VS Code `1.106.1` 及以上版本。注入逻辑会优先使用已知 workbench 路径，并提供递归文件发现兜底，以兼容旧版和 1.123+ 的安装目录差异。

默认支持：

- Wallpaper Engine `image` 项目中的常见图片文件。
- Wallpaper Engine `video` 项目中的常见视频文件。
- Wallpaper Engine `web` 项目中的 HTML 入口文件。
- 本地自定义图片、视频和 HTML 背景。

默认隐藏：

- Wallpaper Engine `scene` / `scene.pkg` 项目。
- 入口文件依赖 Wallpaper Engine 原生 scene 渲染器的项目。

如果需要在选择列表里看到这些不完整兼容的项目，可以在设置面板开启 **Show preview-only wallpapers**，或手动设置：

```json
"vscode-wallpaper-engine.showUnsupportedWallpapers": true
```

开启后，这些项目只会以 `preview.jpg` / `preview.png` 等作为壁纸，并会标记为 `preview only`。这不代表已经完整渲染 `scene.pkg`。

## 安装

可以从 VS Code 插件市场安装。也可以在本地构建 VSIX：

```powershell
bun install
bun run output
```

打包产物会生成到：

```text
artifacts/vscode-live-wallpaper-0.0.6.vsix
```

在 VS Code 中执行 **Extensions: Install from VSIX** 后选择该文件即可安装。

## 使用

1. 执行 **Open Wallpaper Settings: 打开壁纸设置**。
2. 使用 **Auto Detect** 自动检测 Wallpaper Engine 创意工坊目录，或手动设置 `vscode-wallpaper-engine.workshopPath`。
3. 使用 **Add Custom Background** 添加本地图片、视频或 HTML 背景。
4. 执行 **Set Wallpaper: 设置壁纸**，选择一个可用背景。
5. 首次注入或更新补丁后，按提示选择 **Reload Window**。

常见创意工坊路径：

```text
D:/Steam/steamapps/workshop/content/431960
```

## 设置项

- `vscode-wallpaper-engine.workshopPath`：Wallpaper Engine 创意工坊目录。留空时会自动检测 Steam 库。
- `vscode-wallpaper-engine.customWallpaperPaths`：本地自定义背景文件或目录。
- `vscode-wallpaper-engine.wallpaperId`：当前选中的壁纸 ID。
- `vscode-wallpaper-engine.wallpaperFit`：图片和视频显示方式，默认 `contain`。
- `vscode-wallpaper-engine.showUnsupportedWallpapers`：是否显示 preview-only 的不完整兼容 Wallpaper Engine 项目。
- `vscode-wallpaper-engine.backgroundOpacity`：编辑器背景透明度。
- `vscode-wallpaper-engine.serverPort`：本地壁纸服务器端口。
- `vscode-wallpaper-engine.glassEnabled`：启用支持浮层的玻璃效果。
- `vscode-wallpaper-engine.glassPreset`：玻璃预设，可选 `subtle`、`liquid`、`solid`。
- `vscode-wallpaper-engine.glassTint`、`glassOpacity`、`glassBlur`、`glassSaturation`、`glassBorderOpacity`、`glassShadowOpacity`：玻璃效果细节参数。
- `vscode-wallpaper-engine.transparencyEnabled`：启用 VS Code 颜色自定义透明化。
- `vscode-wallpaper-engine.transparencyRules`：按界面区域设置透明度规则。
- `vscode-wallpaper-engine.customCss`：额外注入的运行时 CSS。
- `vscode-wallpaper-engine.customJs`：额外注入的运行时 JavaScript。

## 注意事项

本扩展需要修改 VS Code 安装目录下的 workbench 文件，才能让背景显示在编辑器 UI 后面。

- VS Code 更新可能会覆盖补丁。更新 VS Code 后，重新执行 **Set Wallpaper: 设置壁纸**。
- 扩展会在补丁或还原后尝试同步 VS Code 的 product checksum，减少 `[Unsupported]` 或“安装似乎损坏”的提示。
- 如果仍然出现安装损坏提示，先执行 **Uninstall Wallpaper Engine: 卸载插件** 还原补丁，再重新加载窗口；必要时重新安装 VS Code。

## 开发

```powershell
bun install
bun run check-types
bun run lint
bun run test
bun run output
```

关键文件：

- `src/core/scanner.ts`：Wallpaper Engine 创意工坊扫描和兼容性过滤。
- `src/core/workshop-detector.ts`：Steam 库和创意工坊路径检测。
- `src/core/injector.ts`：VS Code workbench 补丁与壁纸注入。
- `src/core/server.ts`：本地壁纸服务器和 Wallpaper Engine API 兼容层。
- `media/settings.html`、`media/settings.css`、`media/settings.js`：设置面板界面。

## 鸣谢

本项目延续并改造自 [vakesamahere/vscode-wallpaper-engine](https://github.com/vakesamahere/vscode-wallpaper-engine) 的思路和基础实现。感谢原作者和贡献者为 VS Code Wallpaper Engine 方向做出的开源工作。

## 许可证

请查看 [LICENSE](LICENSE)。
