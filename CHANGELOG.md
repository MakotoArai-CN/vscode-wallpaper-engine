# 更新日志

这里记录 `vscode-live-wallpaper` 扩展的重要变更。

## [0.0.6] - 2026-06-03

### 新增

- 支持本地自定义背景：图片、视频、HTML 文件，以及包含 `index.html` 或媒体文件的目录。
- 新增 `Add Custom Wallpaper: 添加自定义背景` 命令和设置面板入口。
- 新增 Wallpaper Engine 创意工坊目录自动检测，支持 Steam 库、Windows 注册表和常见 SteamLibrary 路径。
- 新增命令和设置面板按钮，用于重新检测 Wallpaper Engine 目录。
- 新增兼容性过滤：默认隐藏不完整兼容的 Wallpaper Engine `scene/pkg` 壁纸。
- 新增设置面板开关，可按需显示 preview-only 的不完整兼容壁纸。
- 新增 VS Code 扩展图标。

### 调整

- 扩展显示名称改为 `Live Wallpaper`。
- 仓库元数据改为 `https://github.com/MakotoArai-CN/vscode-live-wallpaper.git`。
- 壁纸选择列表现在会合并 Wallpaper Engine 项目和本地自定义背景。
- 项目文档改为中文，并补充兼容性说明、Bun 打包步骤和原项目鸣谢。
- VS Code 兼容目标调整为 `1.106.1` 及以上，尽量保留旧版 VS Code 安装能力。
- 项目脚本、CI 和锁文件从 npm 切换到 Bun。
- 扩展打包从废弃的 `vsce` 迁移到 `@vscode/vsce`。

### 修复

- 改进大型壁纸库扫描流程，减少扩展宿主卡死，并显示扫描进度。
- 改进当前 VS Code workbench 文件布局下的注入兼容性。
- 新增递归 workbench 文件发现逻辑，兼容旧版和 VS Code 1.123+ 的 workbench 目录差异。
- 重写 CSP 补丁逻辑，使旧注入块可以被干净升级。
- 在补丁和还原后同步 VS Code product checksum，减少 “Code 安装似乎损坏” 或 `[Unsupported]` 提示。

## [0.0.5] - 2025-12-31

### 修复

- 修复没有打开编辑器时出现黑色背景的问题。

## [0.0.4] - 2025-12-06

### 新增

- 扩展 UI 透明化支持范围，包含标题栏、通知、菜单、Quick Input 和状态栏项。

### 修复

- 修复设置面板重新打开后透明化设置看起来被重置的问题。
- 修复 workbench 背景透明规则，新增对 `div[role="application"]` 的注入规则。

## [0.0.3] - 2025-11-23

### 新增

- 设置面板新增 “Open Wallpaper Folder” 按钮，可快速打开当前壁纸目录。
- 设置面板新增壁纸信息区域，显示名称、类型、入口文件和路径。
- 调试侧栏新增打开壁纸目录按钮。

### 修复

- 修复相对路径壁纸可能触发 `net::ERR_FILE_NOT_FOUND` 的问题。
- 修复部分 WebGL 壁纸的 `SecurityError: Tainted canvases` 问题。
- 修复注入脚本中反斜杠转义导致的正则语法错误。
- 修复设置面板滑块和开关颜色与 VS Code 主题按钮颜色不一致的问题。

## [0.0.2] - 2025-11-23

### 修复

- 修复重新加载后壁纸服务器端口 `23333` 被残留进程占用的问题。
- 修复带依赖的网页壁纸可能出现 `/api/get-entry` 404 的问题。
- 修复 VS Code 重启后壁纸类型丢失的问题。

## [0.0.1] - 初始版本

- 基础 Wallpaper Engine 支持：Video、Image、Web。
- 基础透明化补丁。
