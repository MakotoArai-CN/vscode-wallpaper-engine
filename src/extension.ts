// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { type AppConfig, buildGlassCss, getConfiguration } from './config';
import { scanWallpapersAsync, getWallpaperById, type WallpaperItem } from './core/scanner';
import { performInjection, restoreWorkbench, isPatched } from './core/injector';
import { WallpaperServer } from './core/server';
import { WALLPAPER_SERVER_PORT } from './config/constants';
import { applyTransparencyPatch, removeTransparencyPatch } from './core/config-patcher';
import { SettingsPanel } from './panels/setting-panel';
import { detectWallpaperEngineWorkshopPath } from './core/workshop-detector';
import { createCustomWallpaperItem, getCustomWallpaperById, isCustomWallpaperId, scanCustomWallpapers } from './core/custom-wallpapers';
import { SystemAudioCapture } from './core/audio-capture';

// test
import { openTestPage } from './playground/page';

const SHOW_DEBUG_SIDEBAR = false; // [Dev] Toggle Debug Sidebar

let server: WallpaperServer | undefined;
let isSettingWallpaper = false;
const audioCapture = new SystemAudioCapture();

/**
 * Start/stop real system-loopback audio capture based on the configured audio source.
 * When 'system', captured spectra are streamed to the wallpaper as AUDIO_DATA over the WebSocket.
 * If the native module/loopback is unavailable, the wallpaper falls back to the simulated spectrum.
 */
function applyAudioSource(config: AppConfig) {
    if (config.audioSource === 'system') {
        const started = audioCapture.start((spectrum) => {
            server?.broadcast({ type: 'AUDIO_DATA', data: spectrum });
        });
        if (!started) {
            console.warn('[WP] System loopback capture unavailable; wallpaper will use the simulated spectrum.');
        }
    } else {
        audioCapture.stop();
    }
}

const GLASS_CONFIG_KEYS = [
    'vscode-wallpaper-engine.glassEnabled',
    'vscode-wallpaper-engine.glassPreset',
    'vscode-wallpaper-engine.glassTint',
    'vscode-wallpaper-engine.glassOpacity',
    'vscode-wallpaper-engine.glassBlur',
    'vscode-wallpaper-engine.glassSaturation',
    'vscode-wallpaper-engine.glassBorderOpacity',
    'vscode-wallpaper-engine.glassShadowOpacity'
];

function affectsAny(e: vscode.ConfigurationChangeEvent, keys: string[]): boolean {
    return keys.some(key => e.affectsConfiguration(key));
}

function updateRuntimeCss(config: AppConfig, triggerReload = false) {
    if (!server) { return; }

    server.updateCssConfig({
        customCss: config.customCss,
        glassCss: buildGlassCss(config.glass)
    });
    server.updateGeneralConfig({
        audioSource: config.audioSource,
        interactionEnabled: config.interactionEnabled
    });

    if (triggerReload) {
        server.triggerReload();
    }
}

function samePath(a: string, b: string): boolean {
    const normalizedA = path.normalize(a);
    const normalizedB = path.normalize(b);
    return process.platform === 'win32'
        ? normalizedA.toLowerCase() === normalizedB.toLowerCase()
        : normalizedA === normalizedB;
}

async function updateWorkshopPathSetting(workshopPath: string) {
    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
    const inspect = config.inspect('workshopPath');
    const target = inspect?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    await config.update('workshopPath', workshopPath, target);
}

function uniqueConfiguredPaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const configuredPath of paths) {
        const normalized = path.normalize(configuredPath);
        const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        if (seen.has(key)) { continue; }
        seen.add(key);
        result.push(normalized);
    }

    return result;
}

async function updateCustomWallpaperPathsSetting(paths: string[]) {
    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
    const inspect = config.inspect('customWallpaperPaths');
    const target = inspect?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    await config.update('customWallpaperPaths', uniqueConfiguredPaths(paths), target);
}

async function detectAndSaveWorkshopPath(currentPath: string, silent = false): Promise<string | undefined> {
    const result = await detectWallpaperEngineWorkshopPath({ configuredPath: currentPath });
    if (!result.path) {
        if (!silent) {
            vscode.window.showErrorMessage('未自动找到 Wallpaper Engine 创意工坊目录。请确认已通过 Steam 安装 Wallpaper Engine，或手动设置 vscode-wallpaper-engine.workshopPath。');
        }
        return undefined;
    }

    if (!currentPath || !samePath(currentPath, result.path)) {
        await updateWorkshopPathSetting(result.path);
    }

    if (!silent) {
        vscode.window.setStatusBarMessage(`Wallpaper Engine 目录: ${result.path}`, 5000);
    }

    return result.path;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-wallpaper-engine" is now active!');
    
    server = new WallpaperServer(context);
    const initialConfig = getConfiguration();
    const savedPath = context.globalState.get<string>('currentWallpaperPath');
    const savedEntry = context.globalState.get<string>('currentWallpaperEntry');
    const savedLocation = context.globalState.get<string>('currentWallpaperLocation');
    if (savedPath) {
        server.start(savedPath, initialConfig.serverPort, savedEntry, savedLocation);
    }

    const applyWallpaper = async (forceReload = false, silent = false) => {
        const config = getConfiguration();
        let item: WallpaperItem | undefined | null;

        if (isCustomWallpaperId(config.wallpaperId)) {
            item = getCustomWallpaperById(config.wallpaperId, config.customWallpaperPaths);
        } else {
            const workshopPath = config.workshopPath || await detectAndSaveWorkshopPath(config.workshopPath, true);
            if (config.wallpaperId && workshopPath) {
                item = getWallpaperById(workshopPath, config.wallpaperId, {
                    includeUnsupported: config.showUnsupportedWallpapers
                });
            }
        }

        if (!config.wallpaperId || !item) {
            if (!silent) {
                vscode.window.showWarningMessage('Please select a Wallpaper Engine item or custom background first.');
            }
            return; 
        }

        const { path: filePath, type } = item.getMediaPath();
        const fileName = path.basename(filePath);
        
        if (server) {
            await server.start(item.dirPath, config.serverPort, fileName, item.location);
            updateRuntimeCss(config);
            applyAudioSource(config);
        }

        await performInjection(filePath, type, config.opacity, config.serverPort, config.customJs, config.resizeDelay, config.startupCheckInterval, false, SHOW_DEBUG_SIDEBAR, config.wallpaperFit, config.interactionEnabled);
        
        // Apply transparency patch
        await applyTransparencyPatch();
        
        if (silent) { return; }

        if (forceReload) {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        } else {
            const action = await vscode.window.showInformationMessage('Wallpaper settings changed. Restart to apply?', 'Restart');
            if (action === 'Restart') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
    };

    if (isCustomWallpaperId(initialConfig.wallpaperId)) {
        void applyWallpaper(false, true);
    } else {
        void detectAndSaveWorkshopPath(initialConfig.workshopPath, true)
            .then(() => applyWallpaper(false, true));
    }

    // Watch for config changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
        if (isSettingWallpaper) { return; }
        
        const affectsId = e.affectsConfiguration('vscode-wallpaper-engine.wallpaperId');
        const affectsInjection =
            e.affectsConfiguration('vscode-wallpaper-engine.backgroundOpacity') ||
            e.affectsConfiguration('vscode-wallpaper-engine.serverPort') ||
            e.affectsConfiguration('vscode-wallpaper-engine.customJs') ||
            e.affectsConfiguration('vscode-wallpaper-engine.resizeDelay') ||
            e.affectsConfiguration('vscode-wallpaper-engine.startupCheckInterval') ||
            e.affectsConfiguration('vscode-wallpaper-engine.wallpaperFit');
        const affectsRuntimeCss =
            e.affectsConfiguration('vscode-wallpaper-engine.customCss') ||
            affectsAny(e, GLASS_CONFIG_KEYS);
        const affectsTransparency =
            e.affectsConfiguration('vscode-wallpaper-engine.transparencyEnabled') ||
            e.affectsConfiguration('vscode-wallpaper-engine.transparencyBaseColor') ||
            e.affectsConfiguration('vscode-wallpaper-engine.transparencyRules');
        const affectsAudio = e.affectsConfiguration('vscode-wallpaper-engine.audioSource');
        const affectsInteraction = e.affectsConfiguration('vscode-wallpaper-engine.interactionEnabled');
        const affectsGeneral = affectsAudio || affectsInteraction;

        if (!affectsId && !affectsInjection) {
            const config = getConfiguration();

            if (affectsRuntimeCss) {
                updateRuntimeCss(config, true);
            }

            if (affectsGeneral && server) {
                // Audio/interaction apply live (no window reload): audio switches inside the
                // iframe via WebSocket; interaction is relayed to the workbench mouse forwarder.
                server.updateGeneralConfig({ audioSource: config.audioSource, interactionEnabled: config.interactionEnabled });

                // Stop loopback BEFORE announcing a non-system source, so no late AUDIO_DATA frame
                // flips the wallpaper back to external.
                if (affectsAudio && config.audioSource !== 'system') {
                    audioCapture.stop();
                }

                const generalData: Record<string, unknown> = {};
                if (affectsAudio) { generalData.audioSource = config.audioSource; }
                if (affectsInteraction) { generalData.interaction = config.interactionEnabled; }
                server.broadcast({ type: 'UPDATE_GENERAL', data: generalData });

                // Start loopback AFTER the mock has been told to expect it (cancels its watchdog).
                if (affectsAudio && config.audioSource === 'system') {
                    applyAudioSource(config);
                }
            }

            if (affectsTransparency) {
                await applyTransparencyPatch();
            }

            if (affectsRuntimeCss || affectsTransparency || affectsGeneral) {
                return;
            }
        }

        if (affectsId && !affectsInjection && !affectsRuntimeCss && !affectsTransparency) {
             const config = getConfiguration();
             if (config.wallpaperId) {
                const item = isCustomWallpaperId(config.wallpaperId)
                    ? getCustomWallpaperById(config.wallpaperId, config.customWallpaperPaths)
                    : config.workshopPath
                        ? getWallpaperById(config.workshopPath, config.wallpaperId, {
                            includeUnsupported: config.showUnsupportedWallpapers
                        })
                        : undefined;
                if (item && server) {
                    await applyWallpaper(false, true);
                    return;
                }
             }
        }

        if (affectsId || affectsInjection || affectsRuntimeCss) {
            await applyWallpaper();
        }
    }));

    // Watch for theme changes to re-apply transparency patch with correct base color
    context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(async () => {
        // Wait a bit for the theme to fully apply
        setTimeout(async () => {
            await applyTransparencyPatch();
        }, 1000);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-wallpaper-engine.refreshWallpaper', async () => {
        if (server) {
            server.triggerReload();
            vscode.window.showInformationMessage('Refreshing wallpaper...');
        }
    }));

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('vscode-wallpaper-engine.helloWorld', () => {
		openTestPage();    
	});
	context.subscriptions.push(disposable);

	// command to set wallpaper
	const setWallPaperCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.setWallpaper', async () => {
        let config = getConfiguration();
        const workshopPath = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在检测 Wallpaper Engine 目录...',
            cancellable: false
        }, async () => detectAndSaveWorkshopPath(config.workshopPath, true));

        config = { ...getConfiguration(), workshopPath: workshopPath || config.workshopPath };
        const customItems = scanCustomWallpapers(config.customWallpaperPaths);

        let wallpaperEngineItems: WallpaperItem[] = [];
        if (config.workshopPath && fs.existsSync(config.workshopPath)) {
            try {
                wallpaperEngineItems = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "正在读取 Wallpaper Engine 库...",
                    cancellable: false
                }, async (progress) => {
                    return scanWallpapersAsync(config.workshopPath, {
                        includeUnsupported: config.showUnsupportedWallpapers,
                        onProgress: (scanned, total) => {
                            progress.report({ message: `${scanned}/${total}` });
                        }
                    });
                });
            } catch (error: any) {
                vscode.window.showWarningMessage(`读取 Wallpaper Engine 库失败，仅显示自定义背景: ${error.message || String(error)}`);
            }
        }

        const previewOnlyCount = wallpaperEngineItems.filter(item => item.unsupportedReason).length;
        const items = [...wallpaperEngineItems, ...customItems];
        if (items.length === 0) {
            const action = await vscode.window.showInformationMessage(
                '未找到 Wallpaper Engine 壁纸，也没有可用的自定义背景。',
                '添加自定义背景',
                '重新检测目录'
            );
            if (action === '添加自定义背景') {
                await vscode.commands.executeCommand('vscode-wallpaper-engine.addCustomWallpaper');
            } else if (action === '重新检测目录') {
                await vscode.commands.executeCommand('vscode-wallpaper-engine.detectWorkshopPath');
            }
            return;
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `选择背景：Wallpaper Engine ${wallpaperEngineItems.length} 个，自定义 ${customItems.length} 个${previewOnlyCount ? `，预览兜底 ${previewOnlyCount} 个` : ''}`,
            matchOnDescription: true
        });

        if (selected) {
            isSettingWallpaper = true;
            try {
                // Update config
                await vscode.workspace.getConfiguration('vscode-wallpaper-engine').update('wallpaperId', selected.id, vscode.ConfigurationTarget.Global);

                const { path: filePath, type } = selected.getMediaPath();
                const fileName = path.basename(filePath);
                
                if (server) {
                    await server.start(selected.dirPath, config.serverPort, fileName, selected.location);
                    updateRuntimeCss(config);
                    applyAudioSource(config);
                }
                
                // Pass autoRestart=false because we handle reload via ping
                await performInjection(filePath, type, config.opacity, config.serverPort, config.customJs, config.resizeDelay, config.startupCheckInterval, false, SHOW_DEBUG_SIDEBAR, config.wallpaperFit, config.interactionEnabled);
                await applyTransparencyPatch();
            } finally {
                setTimeout(() => { isSettingWallpaper = false; }, 2000);
            }
        }
    });
	context.subscriptions.push(setWallPaperCmd);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-wallpaper-engine.detectWorkshopPath', async () => {
        const config = getConfiguration();
        const workshopPath = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在自动检测 Wallpaper Engine 目录...',
            cancellable: false
        }, async () => detectAndSaveWorkshopPath(config.workshopPath));

        if (workshopPath) {
            vscode.window.showInformationMessage(`已设置 Wallpaper Engine 目录: ${workshopPath}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-wallpaper-engine.addCustomWallpaper', async () => {
        const selectedUris = await vscode.window.showOpenDialog({
            title: '选择自定义背景文件或目录',
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: true,
            filters: {
                'Backgrounds': ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'html', 'htm']
            }
        });

        if (!selectedUris || selectedUris.length === 0) {
            return;
        }

        const selectedPaths = selectedUris.map(uri => uri.fsPath);
        const validItems = selectedPaths
            .map(selectedPath => createCustomWallpaperItem(selectedPath))
            .filter((item): item is WallpaperItem => Boolean(item));

        if (validItems.length === 0) {
            vscode.window.showWarningMessage('未找到可用的自定义背景。请选择图片、视频、HTML 文件，或包含 index.html / 媒体文件的目录。');
            return;
        }

        const currentConfig = getConfiguration();
        await updateCustomWallpaperPathsSetting([
            ...currentConfig.customWallpaperPaths,
            ...selectedPaths
        ]);

        vscode.window.showInformationMessage(`已添加 ${validItems.length} 个自定义背景。`);
        await vscode.commands.executeCommand('vscode-wallpaper-engine.setWallpaper');
    }));

    const openInBrowserCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.openInBrowser', async () => {
        const config = getConfiguration();
        const url = `http://127.0.0.1:${config.serverPort}/api/get-entry`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    });
    context.subscriptions.push(openInBrowserCmd);

    const uninstallCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.uninstallWallpaper', async () => {
        const confirm = await vscode.window.showWarningMessage(
            '确定要卸载 Wallpaper Engine 插件吗？这将移除所有注入的代码和修改。',
            { modal: true },
            '卸载'
        );
        if (confirm === '卸载') {
            await restoreWorkbench();
            await removeTransparencyPatch();
            audioCapture.stop();
            server?.stop();
        }
    });
    context.subscriptions.push(uninstallCmd);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-wallpaper-engine.openSettings', () => {
        if (server) {
            SettingsPanel.createOrShow(context.extensionUri, server);
        } else {
            vscode.window.showErrorMessage('Wallpaper Server is not running.');
        }
    }));

    // Edit Custom CSS Command
    const cssStoragePath = path.join(context.globalStorageUri.fsPath, 'custom.css');
    const editCustomCssCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.editCustomCss', async () => {
        const config = getConfiguration();
        const cssContent = config.customCss || '/* Enter your custom CSS here */';
        
        if (!fs.existsSync(context.globalStorageUri.fsPath)) {
            fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
        }
        
        fs.writeFileSync(cssStoragePath, cssContent, 'utf-8');
        
        const doc = await vscode.workspace.openTextDocument(cssStoragePath);
        await vscode.window.showTextDocument(doc);
    });
    context.subscriptions.push(editCustomCssCmd);

    // Listen for CSS file save
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (path.normalize(doc.fileName) === path.normalize(cssStoragePath)) {
            const content = doc.getText();
            const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
            await config.update('customCss', content, vscode.ConfigurationTarget.Global);
            
            if (server) {
                const currentConfig = getConfiguration();
                server.updateCssConfig({
                    customCss: content,
                    glassCss: buildGlassCss(currentConfig.glass)
                });
                server.triggerReload();
                vscode.window.setStatusBarMessage('Wallpaper CSS Updated', 2000);
            }
        }
    }));
}

// This method is called when your extension is deactivated
export function deactivate() {
    audioCapture.stop();
    server?.stop();
}
