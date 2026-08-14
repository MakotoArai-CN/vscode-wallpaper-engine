import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WallpaperServer } from '../core/server';
import { TRANSPARENT_COLOR_KEYS, applyTransparencyPatch } from '../core/config-patcher';
import { buildGlassCss, getConfiguration } from '../config';
import { detectWallpaperEngineWorkshopPath } from '../core/workshop-detector';

export class SettingsPanel {
    public static currentPanel: SettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private server: WallpaperServer) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, extensionUri);
        this._setWebviewMessageListener(this._panel.webview);
    }

    public static createOrShow(extensionUri: vscode.Uri, server: WallpaperServer) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (SettingsPanel.currentPanel) {
            SettingsPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'wallpaperSettings',
            'Wallpaper Settings',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri, server);
    }

    public dispose() {
        SettingsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message: any) => {
                if (message.command === 'updateProp') {
                    this.server.broadcast({
                        type: 'UPDATE_PROPERTIES',
                        data: { [message.key]: { value: message.value } }
                    });
                } else if (message.command === 'updateGeneral') {
                    // audio/interaction persist to settings; the config watcher then applies them
                    // live (broadcast over WS + relay to the mouse forwarder). Unknown keys keep
                    // the legacy direct broadcast.
                    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
                    if (message.key === 'audioSource') {
                        await config.update('audioSource', message.value, vscode.ConfigurationTarget.Global);
                    } else if (message.key === 'interactionEnabled') {
                        await config.update('interactionEnabled', Boolean(message.value), vscode.ConfigurationTarget.Global);
                    } else {
                        this.server.broadcast({
                            type: 'UPDATE_GENERAL',
                            data: { [message.key]: message.value }
                        });
                    }
                } else if (message.command === 'refresh') {
                    vscode.commands.executeCommand('vscode-wallpaper-engine.refreshWallpaper');
                } else if (message.command === 'switch') {
                    vscode.commands.executeCommand('vscode-wallpaper-engine.setWallpaper');
                } else if (message.command === 'addCustomWallpaper') {
                    vscode.commands.executeCommand('vscode-wallpaper-engine.addCustomWallpaper');
                } else if (message.command === 'detectWorkshopPath') {
                    await webview.postMessage({ type: 'workshopDetection', state: 'checking' });
                    try {
                        const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
                        const currentPath = config.get<string>('workshopPath') || '';
                        const result = await detectWallpaperEngineWorkshopPath({ configuredPath: currentPath });

                        if (!result.path) {
                            await webview.postMessage({
                                type: 'workshopDetection',
                                state: 'missing',
                                candidates: []
                            });
                            vscode.window.showWarningMessage('未自动找到 Wallpaper Engine 创意工坊目录。');
                            return;
                        }

                        const inspect = config.inspect('workshopPath');
                        const target = inspect?.workspaceValue !== undefined
                            ? vscode.ConfigurationTarget.Workspace
                            : vscode.ConfigurationTarget.Global;
                        await config.update('workshopPath', result.path, target);

                        await webview.postMessage({
                            type: 'workshopDetection',
                            state: 'found',
                            path: result.path,
                            candidates: result.candidates.map(candidate => ({
                                path: candidate.workshopPath,
                                source: candidate.source,
                                hasWallpapers: candidate.hasWallpapers
                            }))
                        });
                        vscode.window.setStatusBarMessage(`Wallpaper Engine 目录: ${result.path}`, 5000);
                    } catch (e: any) {
                        await webview.postMessage({
                            type: 'workshopDetection',
                            state: 'error',
                            message: e.message || String(e)
                        });
                    }
                } else if (message.command === 'openBrowser') {
                    vscode.commands.executeCommand('vscode-wallpaper-engine.openInBrowser');
                } else if (message.command === 'openFolder') {
                    const root = this.server.getCurrentRoot();
                    if (root) {
                        vscode.env.openExternal(vscode.Uri.file(root));
                    } else {
                        vscode.window.showErrorMessage('No wallpaper loaded.');
                    }
                } else if (message.command === 'stopServer') {
                    this.server.stop();
                    vscode.window.showWarningMessage('Wallpaper Server stopped.');
                } else if (message.command === 'editCustomCss') {
                    vscode.commands.executeCommand('vscode-wallpaper-engine.editCustomCss');
                } else if (message.command === 'updateCss') {
                    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
                    
                    try {
                        // 1. Update VS Code Config
                        await config.update('customCss', message.customCss, vscode.ConfigurationTarget.Global);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`[CSS] Config Update Failed: ${e.message}`);
                        console.error('[CSS] Config Update Failed:', e);
                    }

                    // 2. Update Server Config (Hot-Swap)
                    const nextConfig = getConfiguration();
                    this.server.updateCssConfig({
                        customCss: message.customCss,
                        glassCss: buildGlassCss(nextConfig.glass),
                        adaptiveColorsEnabled: nextConfig.adaptiveColors.enabled,
                        adaptiveColorsStrength: nextConfig.adaptiveColors.strength
                    });
                    
                    console.log('[Panel] Triggering server reload...');
                    this.server.triggerReload();

                    vscode.window.setStatusBarMessage('Wallpaper styles updated', 2000);
                } else if (message.command === 'updateGlassConfig') {
                    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
                    const glass = message.glass || {};

                    try {
                        const updates: Array<[string, unknown]> = [
                            ['glassEnabled', Boolean(glass.enabled)],
                            ['glassPreset', glass.preset || 'liquid'],
                            ['glassTint', glass.tint || '#111827'],
                            ['glassOpacity', glass.opacity],
                            ['glassBlur', glass.blur],
                            ['glassSaturation', glass.saturation],
                            ['glassBorderOpacity', glass.borderOpacity],
                            ['glassShadowOpacity', glass.shadowOpacity],
                            ['adaptiveColorsEnabled', Boolean(message.adaptiveColors?.enabled)],
                            ['adaptiveColorsStrength', message.adaptiveColors?.strength]
                        ];

                        for (const [key, value] of updates) {
                            await config.update(key, value, vscode.ConfigurationTarget.Global);
                        }

                        const nextConfig = getConfiguration();
                        this.server.updateCssConfig({
                            customCss: nextConfig.customCss,
                            glassCss: buildGlassCss(nextConfig.glass),
                            adaptiveColorsEnabled: nextConfig.adaptiveColors.enabled,
                            adaptiveColorsStrength: nextConfig.adaptiveColors.strength
                        });
                        this.server.triggerReload();
                        vscode.window.setStatusBarMessage('Glass effect updated', 2000);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to update glass effect: ${e.message}`);
                    }
                } else if (message.command === 'updateTransparencyRules') {
                    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
                    try {
                        const inspect = config.inspect('transparencyRules');
                        const target = (inspect && inspect.workspaceValue !== undefined) ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
                        
                        await config.update('transparencyRules', message.rules, target);
                        await applyTransparencyPatch(target);
                        vscode.window.showInformationMessage('Transparency rules updated.');
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to update transparency rules: ${e.message}`);
                    }
                } else if (message.command === 'toggleTransparency') {
                    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
                    try {
                        const inspect = config.inspect('transparencyEnabled');
                        const target = (inspect && inspect.workspaceValue !== undefined) ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;

                        await config.update('transparencyEnabled', message.enabled, target);
                        await applyTransparencyPatch(target);
                        vscode.window.showInformationMessage(`Transparency ${message.enabled ? 'Enabled' : 'Disabled'}.`);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to toggle transparency: ${e.message}`);
                    }
                } else if (message.command === 'updateTransparencyBaseColor') {
                    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
                    try {
                        const inspect = config.inspect('transparencyBaseColor');
                        const target = (inspect && inspect.workspaceValue !== undefined) ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;

                        await config.update('transparencyBaseColor', message.color, target);
                        await applyTransparencyPatch(target);
                        vscode.window.showInformationMessage('Transparency base color updated.');
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to update base color: ${e.message}`);
                    }
                } else if (message.command === 'toggleUnsupportedWallpapers') {
                    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
                    try {
                        const inspect = config.inspect('showUnsupportedWallpapers');
                        const target = (inspect && inspect.workspaceValue !== undefined) ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;

                        await config.update('showUnsupportedWallpapers', Boolean(message.enabled), target);
                        vscode.window.setStatusBarMessage(`Preview-only wallpapers ${message.enabled ? 'shown' : 'hidden'}`, 2500);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to update wallpaper compatibility filter: ${e.message}`);
                    }
                }
            },
            undefined,
            this._disposables
        );
    }

    private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri) {
        const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
        const port = config.get<number>('serverPort') || 23333;
        const appConfig = getConfiguration();
        const customCss = appConfig.customCss;
        const glassConfig = appConfig.glass;
        const adaptiveColorConfig = appConfig.adaptiveColors;
        const transparencyRules = config.get<any>('transparencyRules') || {};
        const transparencyEnabled = config.get<boolean>('transparencyEnabled') ?? true;
        const transparencyBaseColor = config.get<string>('transparencyBaseColor') || '';
        const showUnsupportedWallpapers = config.get<boolean>('showUnsupportedWallpapers') ?? false;
        const workshopPath = config.get<string>('workshopPath') || '';
        const customWallpaperCount = appConfig.customWallpaperPaths.length;
        const audioSource = appConfig.audioSource;
        const interactionEnabled = appConfig.interactionEnabled;
        const micEnabled = config.get<boolean>('micEnabled') ?? false;

        const info = this.server.getCurrentInfo();
        const infoPath = info.root || 'None';
        const infoEntry = info.entry || 'None';
        const infoName = infoPath !== 'None' ? path.basename(infoPath) : 'None';
        const infoType = infoEntry !== 'None' ? path.extname(infoEntry).toUpperCase().replace('.', '') : 'None';

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'settings.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'settings.css'));
        const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'settings.html');
        
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');

        // Escape special characters for HTML attribute
        const escapeHtml = (unsafe: string) => {
            return unsafe
                 .replace(/&/g, "&amp;")
                 .replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;")
                 .replace(/"/g, "&quot;")
                 .replace(/'/g, "&#039;");
         };

        htmlContent = htmlContent
            .replace(/{{infoName}}/g, escapeHtml(infoName))
            .replace(/{{infoType}}/g, escapeHtml(infoType))
            .replace(/{{infoEntry}}/g, escapeHtml(infoEntry))
            .replace(/{{infoPath}}/g, escapeHtml(infoPath))
            .replace(/{{cspSource}}/g, webview.cspSource)
            .replace(/{{styleUri}}/g, styleUri.toString())
            .replace(/{{scriptUri}}/g, scriptUri.toString())
            .replace(/{{serverPort}}/g, port.toString())
            .replace(/{{customCss}}/g, escapeHtml(customCss))
            .replace(/{{glassConfig}}/g, JSON.stringify(glassConfig))
            .replace(/{{adaptiveColorConfig}}/g, JSON.stringify(adaptiveColorConfig))
            .replace(/{{workshopPath}}/g, escapeHtml(workshopPath || 'Not detected'))
            .replace(/{{customWallpaperCount}}/g, customWallpaperCount.toString())
            .replace(/{{transparencyKeys}}/g, JSON.stringify(TRANSPARENT_COLOR_KEYS))
            .replace(/{{transparencyRules}}/g, JSON.stringify(transparencyRules))
            .replace(/{{transparencyEnabled}}/g, JSON.stringify(transparencyEnabled))
            .replace(/{{showUnsupportedWallpapers}}/g, JSON.stringify(showUnsupportedWallpapers))
            .replace(/{{audioSource}}/g, JSON.stringify(audioSource))
            .replace(/{{interactionEnabled}}/g, JSON.stringify(interactionEnabled))
            .replace(/{{micEnabled}}/g, JSON.stringify(micEnabled))
            .replace(/{{transparencyBaseColor}}/g, escapeHtml(transparencyBaseColor));

        return htmlContent;
    }
}
