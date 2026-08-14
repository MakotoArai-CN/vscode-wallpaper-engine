import * as vscode from 'vscode';
import * as fs from 'fs';

export interface AppConfig {
    workshopPath: string;
    opacity: number;
    serverPort: number;
    customJs: string;
    wallpaperId: string;
    resizeDelay: number;
    startupCheckInterval: number;
    customCss: string;
    customWallpaperPaths: string[];
    wallpaperFit: WallpaperFit;
    showUnsupportedWallpapers: boolean;
    audioSource: AudioSource;
    interactionEnabled: boolean;
    glass: GlassConfig;
    adaptiveColors: AdaptiveColorConfig;
}

export type GlassPreset = 'subtle' | 'liquid' | 'solid';
export type WallpaperFit = 'contain' | 'cover' | 'fill';
export type AudioSource = 'off' | 'simulate' | 'mic' | 'system';

export interface GlassConfig {
    enabled: boolean;
    preset: GlassPreset;
    tint: string;
    opacity: number;
    blur: number;
    saturation: number;
    borderOpacity: number;
    shadowOpacity: number;
}

export interface AdaptiveColorConfig {
    enabled: boolean;
    strength: number;
}

const GLASS_PRESETS: Record<GlassPreset, GlassConfig> = {
    subtle: {
        enabled: true,
        preset: 'subtle',
        tint: '#171A21',
        opacity: 0.82,
        blur: 12,
        saturation: 1.15,
        borderOpacity: 0.18,
        shadowOpacity: 0.18
    },
    liquid: {
        enabled: true,
        preset: 'liquid',
        tint: '#111827',
        opacity: 0.52,
        blur: 28,
        saturation: 1.85,
        borderOpacity: 0.46,
        shadowOpacity: 0.36
    },
    solid: {
        enabled: true,
        preset: 'solid',
        tint: '#111318',
        opacity: 0.92,
        blur: 6,
        saturation: 1,
        borderOpacity: 0.2,
        shadowOpacity: 0.22
    }
};

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) { return min; }
    return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string, fallback: string): string {
    return /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : fallback;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const value = hex.replace('#', '');
    return {
        r: parseInt(value.substring(0, 2), 16),
        g: parseInt(value.substring(2, 4), 16),
        b: parseInt(value.substring(4, 6), 16)
    };
}

export function getGlassConfiguration(config = vscode.workspace.getConfiguration('vscode-wallpaper-engine')): GlassConfig {
    const preset = (config.get<GlassPreset>('glassPreset') || 'liquid');
    const base = GLASS_PRESETS[preset] || GLASS_PRESETS.liquid;

    return {
        enabled: config.get<boolean>('glassEnabled') ?? base.enabled,
        preset,
        tint: normalizeHexColor(config.get<string>('glassTint') || base.tint, base.tint),
        opacity: clamp(config.get<number>('glassOpacity') ?? base.opacity, 0.2, 1),
        blur: clamp(config.get<number>('glassBlur') ?? base.blur, 0, 60),
        saturation: clamp(config.get<number>('glassSaturation') ?? base.saturation, 1, 2.5),
        borderOpacity: clamp(config.get<number>('glassBorderOpacity') ?? base.borderOpacity, 0, 1),
        shadowOpacity: clamp(config.get<number>('glassShadowOpacity') ?? base.shadowOpacity, 0, 1)
    };
}

export function buildGlassCss(glass: GlassConfig): string {
    if (!glass.enabled) {
        return '/* VSCode Wallpaper Glass disabled */';
    }

    const { r, g, b } = hexToRgb(glass.tint);
    const highlightOpacity = glass.preset === 'liquid' ? Math.min(0.34, glass.borderOpacity + 0.12) : Math.min(0.18, glass.borderOpacity + 0.04);
    const menuRowHover = glass.preset === 'solid' ? 0.14 : 0.22;
    const menuRowFocus = glass.preset === 'liquid' ? 0.28 : menuRowHover;
    const radius = glass.preset === 'liquid' ? 10 : 8;

    return `
/* [VSCode-Wallpaper-Glass] */
:root {
    --vwe-glass-bg: rgba(${r}, ${g}, ${b}, ${glass.opacity});
    --vwe-glass-bg-strong: rgba(${r}, ${g}, ${b}, ${Math.min(1, glass.opacity + 0.12)});
    --vwe-glass-bg-static: rgba(${r}, ${g}, ${b}, ${Math.min(0.78, glass.opacity + 0.16)});
    --vwe-glass-border: rgba(255, 255, 255, ${glass.borderOpacity});
    --vwe-glass-highlight: rgba(255, 255, 255, ${highlightOpacity});
    --vwe-glass-hover: rgba(255, 255, 255, ${menuRowHover});
    --vwe-glass-focus: rgba(255, 255, 255, ${menuRowFocus});
    --vwe-glass-shadow: rgba(0, 0, 0, ${glass.shadowOpacity});
    --vwe-glass-blur: ${glass.blur}px;
    --vwe-glass-saturation: ${glass.saturation};
    --vwe-glass-radius: ${radius}px;
    --vwe-glass-filter: blur(var(--vwe-glass-blur)) contrast(1.14) brightness(1.04) saturate(var(--vwe-glass-saturation));
    --vwe-adaptive-nav-bg: var(--vwe-glass-bg);
    --vwe-adaptive-top-bg: var(--vwe-glass-bg);
    --vwe-adaptive-active-bg: var(--vwe-glass-focus);
    --vwe-adaptive-border: var(--vwe-glass-border);
    --vwe-adaptive-fg: var(--vscode-foreground);
}

/* VS Code 1.133 Agent/Chat surfaces */
.monaco-workbench .chat-viewpane,
.monaco-workbench .chat-viewpane-container,
.monaco-workbench .chat-widget,
.monaco-workbench .interactive-session,
.monaco-workbench .agent-host-chat,
.monaco-workbench .agent-sessions,
.monaco-workbench .agent-sessions-container,
.monaco-workbench .agent-sessions-viewer,
.monaco-workbench .chat-editor-container,
.monaco-workbench .chat-editing-session-container,
.monaco-workbench .chat-viewpane .monaco-list,
.monaco-workbench .chat-widget .monaco-list,
.monaco-workbench .agent-sessions .monaco-list {
    background: transparent !important;
    background-color: transparent !important;
}

.monaco-workbench .chat-widget .monaco-inputbox,
.monaco-workbench .interactive-session .monaco-inputbox,
.monaco-workbench .agent-host-chat .monaco-inputbox,
.monaco-workbench .agent-sessions-control-container,
.monaco-workbench .agent-sessions-new-button-container,
.monaco-workbench .chat-editing-session-overview,
.monaco-workbench .chat-input-container,
.monaco-workbench .chat-input-window {
    background: var(--vwe-glass-bg-static) !important;
    background-color: var(--vwe-glass-bg-static) !important;
    border-color: var(--vwe-glass-border) !important;
    -webkit-backdrop-filter: var(--vwe-glass-filter) !important;
    backdrop-filter: var(--vwe-glass-filter) !important;
}

/* Wallpaper-weighted navigation and top chrome */
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .part.activitybar,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .part.sidebar,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .part.auxiliarybar {
    background: var(--vwe-adaptive-nav-bg) !important;
    background-color: var(--vwe-adaptive-nav-bg) !important;
    border-color: var(--vwe-adaptive-border) !important;
    -webkit-backdrop-filter: var(--vwe-glass-filter) !important;
    backdrop-filter: var(--vwe-glass-filter) !important;
}

:root[data-vwe-adaptive-colors="true"] .monaco-workbench .part.titlebar,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .titlebar-container,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .menubar {
    background: var(--vwe-adaptive-top-bg) !important;
    background-color: var(--vwe-adaptive-top-bg) !important;
    border-color: var(--vwe-adaptive-border) !important;
    -webkit-backdrop-filter: var(--vwe-glass-filter) !important;
    backdrop-filter: var(--vwe-glass-filter) !important;
}

:root[data-vwe-adaptive-colors="true"] .monaco-workbench .part.activitybar .action-item.checked,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .part.activitybar .action-item:hover,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .menubar .menubar-menu-button:hover,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .menubar .menubar-menu-button.open {
    background: var(--vwe-adaptive-active-bg) !important;
}

:root[data-vwe-adaptive-colors="true"] .monaco-workbench .part.activitybar,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .part.titlebar,
:root[data-vwe-adaptive-colors="true"] .monaco-workbench .menubar {
    color: var(--vwe-adaptive-fg) !important;
}

.quick-input-widget,
.monaco-hover,
.monaco-hover-content,
.suggest-widget,
.editor-widget.suggest-widget,
.parameter-hints-widget,
.monaco-dialog-box,
.notifications-center,
.notifications-toasts .notification-toast {
    background: var(--vwe-glass-bg) !important;
    background-color: var(--vwe-glass-bg) !important;
    -webkit-backdrop-filter: var(--vwe-glass-filter) !important;
    backdrop-filter: var(--vwe-glass-filter) !important;
    border: 1px solid var(--vwe-glass-border) !important;
    box-shadow: 0 20px 56px var(--vwe-glass-shadow), inset 0 1px 0 var(--vwe-glass-highlight), inset 0 -1px 0 rgba(255, 255, 255, 0.08) !important;
    border-radius: var(--vwe-glass-radius) !important;
    background-clip: padding-box !important;
    isolation: isolate !important;
}

.settings-editor .settings-header,
.settings-editor .settings-toc-container,
.settings-editor .settings-tree-container,
.settings-editor .settings-group,
.settings-editor .settings-row,
.settings-editor .settings-search-container,
.settings-editor .settings-tabs-widget,
.settings-editor .setting-item-contents,
.monaco-workbench .monaco-button,
.monaco-workbench .monaco-text-button,
.monaco-workbench .monaco-inputbox,
.monaco-workbench .monaco-select-box,
.monaco-workbench .monaco-list .monaco-list-row .monaco-action-bar .action-label,
.monaco-workbench .action-widget,
.monaco-workbench .find-widget,
.monaco-workbench .debug-toolbar {
    background: var(--vwe-glass-bg-static) !important;
    background-color: var(--vwe-glass-bg-static) !important;
    -webkit-backdrop-filter: var(--vwe-glass-filter) !important;
    backdrop-filter: var(--vwe-glass-filter) !important;
    border-color: var(--vwe-glass-border) !important;
    box-shadow: 0 10px 28px rgba(0, 0, 0, ${Math.min(0.28, glass.shadowOpacity)}), inset 0 1px 0 var(--vwe-glass-highlight) !important;
}

.settings-editor .settings-group,
.settings-editor .settings-row,
.settings-editor .settings-search-container,
.settings-editor .settings-tabs-widget,
.monaco-workbench .monaco-button,
.monaco-workbench .monaco-text-button,
.monaco-workbench .monaco-inputbox,
.monaco-workbench .monaco-select-box,
.monaco-workbench .action-widget,
.monaco-workbench .find-widget,
.monaco-workbench .debug-toolbar {
    border: 1px solid var(--vwe-glass-border) !important;
    border-radius: var(--vwe-glass-radius) !important;
}

.settings-editor .settings-row,
.settings-editor .setting-item-contents {
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.28) !important;
}

.quick-input-widget .quick-input-list,
.quick-input-widget .monaco-list,
.suggest-widget .monaco-list,
.parameter-hints-widget .wrapper {
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
}

.quick-input-list .monaco-list-row,
.suggest-widget .monaco-list-row {
    background-color: transparent !important;
}

.quick-input-list .monaco-list-row.focused,
.quick-input-list .monaco-list-row:hover,
.suggest-widget .monaco-list-row.focused,
.suggest-widget .monaco-list-row:hover {
    background: var(--vwe-glass-focus) !important;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14) !important;
}

.quick-input-list .monaco-list-row,
.suggest-widget .monaco-list-row,
.parameter-hints-widget,
.monaco-hover {
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.42) !important;
}

.quick-input-widget .quick-input-header,
.quick-input-widget .quick-input-list {
    background: transparent !important;
}

.quick-input-widget input,
.quick-input-widget .monaco-inputbox {
    background: var(--vwe-glass-bg-strong) !important;
    border-color: var(--vwe-glass-border) !important;
}
`.trim();
}

export function buildRuntimeCss(config: AppConfig): string {
    return [buildGlassCss(config.glass), config.customCss].filter(Boolean).join('\n\n');
}

export function getConfiguration(): AppConfig {
    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
    const workshopPath = config.get<string>('workshopPath') || '';
    const opacity = config.get<number>('backgroundOpacity') || 0.3;
    const serverPort = config.get<number>('serverPort') || 23333;
    const customJs = config.get<string>('customJs') || '';
    const wallpaperId = config.get<string>('wallpaperId') || '';
    const resizeDelay = config.get<number>('resizeDelay') || 500;
    const startupCheckInterval = config.get<number>('startupCheckInterval') || 300;
    const customCss = config.get<string>('customCss') || '';
    const customWallpaperPaths = config.get<string[]>('customWallpaperPaths') || [];
    const wallpaperFit = config.get<WallpaperFit>('wallpaperFit') || 'contain';
    const showUnsupportedWallpapers = config.get<boolean>('showUnsupportedWallpapers') ?? false;
    const audioSource = config.get<AudioSource>('audioSource') || 'system';
    const interactionEnabled = config.get<boolean>('interactionEnabled') ?? true;
    const glass = getGlassConfiguration(config);
    const adaptiveColors: AdaptiveColorConfig = {
        enabled: config.get<boolean>('adaptiveColorsEnabled') ?? true,
        strength: clamp(config.get<number>('adaptiveColorsStrength') ?? 0.68, 0, 1)
    };

    return { workshopPath, opacity, serverPort, customJs, wallpaperId, resizeDelay, startupCheckInterval, customCss, customWallpaperPaths, wallpaperFit, showUnsupportedWallpapers, audioSource, interactionEnabled, glass, adaptiveColors };
}

export function validateConfig(config: AppConfig): boolean {
    if (!config.workshopPath || !fs.existsSync(config.workshopPath)) {
        vscode.window.showErrorMessage('请先在设置中配置正确的 Wallpaper Engine 创意工坊目录！');
        return false;
    }
    return true;
}
