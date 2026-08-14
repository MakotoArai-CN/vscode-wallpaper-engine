import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { toVsCodeResourceUrl } from '../utils'; 
import { saveFilePrivileged } from './admin-saver';
import { WALLPAPER_SERVER_PORT } from '../config/constants';
import { WallpaperType } from './types';

// --- 常量定义 ---
const JS_INJECTION_REGEX = /\s*\/\* \[VSCode-Wallpaper-Injection-Start\] \*\/[\s\S]*?\/\* \[VSCode-Wallpaper-Injection-End\] \*\//g;
const HTML_INJECTION_REGEX = /\s*<!-- VSCode-Wallpaper-Injection-Start -->[\s\S\n]*?<!-- VSCode-Wallpaper-Injection-End -->/g;
const INTEGRITY_BYPASS_MARKER = '/* [VSCode-Wallpaper-Integrity-Bypass] */';
const INTEGRITY_BYPASS_REGEX = /this\.storage=new ([\w$]+)\(([\w$]+)\),this\.isPurePromise=Promise\.resolve\(\{isPure:!0,proof:\[\]\}\)\/\* \[VSCode-Wallpaper-Integrity-Bypass\] \*\//g;
const INTEGRITY_CONSTRUCTOR_REGEX = /this\.storage=new ([\w$]+)\(([\w$]+)\),this\.isPurePromise=this\._isPure\(\),this\._compute\(\)/g;

// HTML 新 CSP 标记
const CSP_MARKER_START = '<!-- VSCode-Wallpaper-Injection-Start -->';
const CSP_MARKER_END = '<!-- VSCode-Wallpaper-Injection-End -->';

// 属性重命名策略
const CSP_HEADER_NAME = 'Content-Security-Policy';
const CSP_HEADER_RENAMED = 'Content-Security-Policy--replaced-by-wallpaper-engine-plugin';
const ORIGINAL_CSP_ATTR_REGEX = /http-equiv\s*=\s*(['"])Content-Security-Policy\1/i;
const RENAMED_CSP_ATTR_REGEX = /http-equiv\s*=\s*(['"])Content-Security-Policy--replaced-by-wallpaper-engine-plugin\1/gi;

// CSP abs content
const CSP_ABS_CONTENT = `
<meta charset="utf-8" />
		<meta
			http-equiv="Content-Security-Policy"
			content="
			default-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
			;
			img-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				data:
				blob:
				vscode-remote-resource:
				vscode-managed-remote-resource:
				https:
			;
			media-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
			;
			frame-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				vscode-webview:
			;
			script-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				'unsafe-eval'
				blob:
			;
			style-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				'unsafe-inline'
			;
			connect-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				https:
				ws:
			;
			font-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				vscode-remote-resource:
				vscode-managed-remote-resource:
				https://*.vscode-unpkg.net
			;
		"/>
`;

function uniqueExistingPaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const existing: string[] = [];
    for (const candidatePath of paths) {
        const normalized = path.normalize(candidatePath);
        const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        if (seen.has(key)) { continue; }
        seen.add(key);
        if (fs.existsSync(normalized)) {
            existing.push(normalized);
        }
    }
    return existing;
}

function findFilesByName(rootPath: string, fileNames: string[], maxDepth = 8): string[] {
    if (!fs.existsSync(rootPath)) {
        return [];
    }

    const names = new Set(fileNames);
    const result: string[] = [];
    const stack: Array<{ dirPath: string; depth: number }> = [{ dirPath: rootPath, depth: 0 }];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) { continue; }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current.dirPath, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const entryPath = path.join(current.dirPath, entry.name);
            if (entry.isDirectory()) {
                if (current.depth < maxDepth) {
                    stack.push({ dirPath: entryPath, depth: current.depth + 1 });
                }
                continue;
            }

            if (entry.isFile() && names.has(entry.name)) {
                result.push(entryPath);
            }
        }
    }

    return result;
}

export interface WorkbenchPathSet {
    htmlPaths: string[];
    mainJsPaths: string[];
    loaderJsPaths: string[];
    integrityPatchJsPaths: string[];
}

export function resolveWorkbenchPaths(appRoot: string): WorkbenchPathSet {
    const outVsRoot = path.join(appRoot, 'out', 'vs');
    const discoveredHtmlPaths = findFilesByName(outVsRoot, ['workbench.html']);
    const discoveredMainJsPaths = findFilesByName(outVsRoot, ['workbench.desktop.main.js']);
    const discoveredLoaderJsPaths = findFilesByName(outVsRoot, ['workbench.js']);
    const discoveredSessionJsPaths = findFilesByName(outVsRoot, ['sessions.desktop.main.js']);

    const htmlPaths = uniqueExistingPaths([
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.html'),
        ...discoveredHtmlPaths
    ]);

    const mainJsPaths = uniqueExistingPaths([
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.desktop.main.js'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.desktop.main.js'),
        ...discoveredMainJsPaths
    ]);

    const loaderJsPaths = uniqueExistingPaths([
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.js'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.js'),
        ...discoveredLoaderJsPaths
    ]);

    const integrityPatchJsPaths = uniqueExistingPaths([
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
        path.join(appRoot, 'out', 'vs', 'sessions', 'sessions.desktop.main.js'),
        ...discoveredMainJsPaths,
        ...discoveredSessionJsPaths
    ]);

    return { htmlPaths, mainJsPaths, loaderJsPaths, integrityPatchJsPaths };
}

function getWorkbenchHtmlPaths(): string[] {
    return resolveWorkbenchPaths(vscode.env.appRoot).htmlPaths;
}

function getWorkbenchMainJsPaths(): string[] {
    return resolveWorkbenchPaths(vscode.env.appRoot).mainJsPaths;
}

function getWorkbenchLoaderJsPaths(): string[] {
    return resolveWorkbenchPaths(vscode.env.appRoot).loaderJsPaths;
}

function getWorkbenchCleanupJsPaths(): string[] {
    return uniqueExistingPaths([
        ...getWorkbenchMainJsPaths(),
        ...getWorkbenchLoaderJsPaths()
    ]);
}

function getWorkbenchInjectionJsPaths(): string[] {
    const mainPaths = getWorkbenchMainJsPaths();
    return mainPaths.length > 0 ? mainPaths : getWorkbenchLoaderJsPaths();
}

function getIntegrityPatchJsPaths(): string[] {
    return resolveWorkbenchPaths(vscode.env.appRoot).integrityPatchJsPaths;
}

function getChecksumCandidatePaths(): string[] {
    return uniqueExistingPaths([
        ...getWorkbenchHtmlPaths(),
        ...getWorkbenchCleanupJsPaths(),
        ...getIntegrityPatchJsPaths()
    ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getProductChecksumKey(filePath: string): string | undefined {
    const outRoot = path.resolve(vscode.env.appRoot, 'out');
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(outRoot, absolutePath);

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return undefined;
    }

    return relativePath.split(path.sep).join('/');
}

function getVsCodeChecksum(filePath: string): string {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('base64')
        .replace(/=+$/, '');
}

async function syncProductChecksums(): Promise<string[]> {
    const productPath = path.join(vscode.env.appRoot, 'product.json');
    if (!fs.existsSync(productPath)) {
        return [];
    }

    let product: unknown;
    try {
        product = JSON.parse(fs.readFileSync(productPath, 'utf-8'));
    } catch (error) {
        throw new Error(`无法读取 VS Code product.json: ${error}`);
    }

    if (!isRecord(product) || !isRecord(product.checksums)) {
        return [];
    }

    const checksums = product.checksums as Record<string, unknown>;
    const changedKeys: string[] = [];

    for (const filePath of getChecksumCandidatePaths()) {
        const key = getProductChecksumKey(filePath);
        if (!key || typeof checksums[key] !== 'string') {
            continue;
        }

        const nextChecksum = getVsCodeChecksum(filePath);
        if (checksums[key] !== nextChecksum) {
            checksums[key] = nextChecksum;
            changedKeys.push(key);
        }
    }

    if (changedKeys.length > 0) {
        await saveFilePrivileged(productPath, JSON.stringify(product, null, '\t') + '\n');
        console.log('VS Code product checksums synchronized.');
    }

    return changedKeys;
}

async function showFullRestartMessage(reason: string) {
    const action = await vscode.window.showInformationMessage(
        `${reason}。请重新加载窗口使修改生效；如果重新加载后仍显示 [Unsupported] 或提示 Code 安装似乎损坏，再手动完全重启 VS Code。`,
        '重新加载窗口'
    );
    if (action === '重新加载窗口') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

async function patchIntegrityWarning() {
    for (const jsPath of getIntegrityPatchJsPaths()) {
        let js = fs.readFileSync(jsPath, 'utf-8');
        const restored = js.replace(INTEGRITY_BYPASS_REGEX, (_match, storageClass: string, storageArg: string) => {
            return `this.storage=new ${storageClass}(${storageArg}),this.isPurePromise=this._isPure(),this._compute()`;
        });
        INTEGRITY_BYPASS_REGEX.lastIndex = 0;

        let patchedCount = 0;
        const patched = restored.replace(INTEGRITY_CONSTRUCTOR_REGEX, (_match, storageClass: string, storageArg: string) => {
            patchedCount++;
            return `this.storage=new ${storageClass}(${storageArg}),this.isPurePromise=Promise.resolve({isPure:!0,proof:[]})${INTEGRITY_BYPASS_MARKER}`;
        });
        INTEGRITY_CONSTRUCTOR_REGEX.lastIndex = 0;

        if (patchedCount > 0 && patched !== js) {
            await saveFilePrivileged(jsPath, patched);
        }
    }
}

async function restoreIntegrityWarning() {
    for (const jsPath of getIntegrityPatchJsPaths()) {
        let js = fs.readFileSync(jsPath, 'utf-8');
        const restored = js.replace(INTEGRITY_BYPASS_REGEX, (_match, storageClass: string, storageArg: string) => {
            return `this.storage=new ${storageClass}(${storageArg}),this.isPurePromise=this._isPure(),this._compute()`;
        });
        INTEGRITY_BYPASS_REGEX.lastIndex = 0;

        if (restored !== js) {
            await saveFilePrivileged(jsPath, restored);
        }
    }
}

export function isPatched(): boolean {
    for (const jsPath of getWorkbenchCleanupJsPaths()) {
        try {
            const js = fs.readFileSync(jsPath, 'utf-8');
            if (js.includes('/* [VSCode-Wallpaper-Injection-Start] */')) {
                return true;
            }
        } catch {
            continue;
        }
    }
    return false;
}

/**
 * [还原/卸载功能]
 * 1. JS: 清除注入代码
 * 2. HTML: 删除新插入的 CSP 块，将重命名的属性改回原样
 */
export async function restoreWorkbench() {
    try {
        // 1. 还原 HTML
        for (const htmlPath of getWorkbenchHtmlPaths()) {
            let html = fs.readFileSync(htmlPath, 'utf-8');
            let changed = false;

            // A. 删除插入的新 CSP 块
            // 匹配 
            const blockRegex = new RegExp(`\\s*${escapeRegExp(CSP_MARKER_START)}[\\s\\S]*?${escapeRegExp(CSP_MARKER_END)}`, 'g');
            if (html.match(blockRegex)) {
                console.log("正在移除注入的 CSP...");
                html = html.replace(blockRegex, '');
                changed = true;
            }

            // B. 恢复原标签的属性名
            if (RENAMED_CSP_ATTR_REGEX.test(html)) {
                console.log("正在恢复原版 CSP 属性名...");
                html = html.replace(RENAMED_CSP_ATTR_REGEX, (_match, quote: string) => `http-equiv=${quote}${CSP_HEADER_NAME}${quote}`);
                changed = true;
            }
            RENAMED_CSP_ATTR_REGEX.lastIndex = 0;

            if (changed) {
                await saveFilePrivileged(htmlPath, html);
            }
        }

        // 2. 还原 JS
        for (const jsPath of getWorkbenchCleanupJsPaths()) {
            let js = fs.readFileSync(jsPath, 'utf-8');
            if (js.match(JS_INJECTION_REGEX)) {
                console.log("正在清理 JS 注入...");
                js = js.replace(JS_INJECTION_REGEX, '');
                await saveFilePrivileged(jsPath, js);
            }
        }

        await restoreIntegrityWarning();
        const syncedChecksumKeys = await syncProductChecksums();
        
        if (syncedChecksumKeys.length > 0) {
            await showFullRestartMessage('已还原并同步 VS Code 校验');
            return;
        }

        const action = await vscode.window.showInformationMessage('已还原。', '重新加载窗口');
        if (action === '重新加载窗口') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }

    } catch (e: any) {
        vscode.window.showErrorMessage('还原失败: ' + e.message);
    }
}

/**
 * [安装/Patch 功能]
 * 1. 找到原 CSP 标签，重命名其属性使其失效
 * 2. 在其下方插入修改后的新 CSP 标签
 */
async function patchWorkbenchHtml() {
    for (const targetHtml of getWorkbenchHtmlPaths()) {
        let html = fs.readFileSync(targetHtml, 'utf-8');
        const originalHtml = html;

        // 支持从旧版本插件的 patch 直接升级：先清掉旧注入块，再恢复被改名的 CSP 属性。
        html = html.replace(HTML_INJECTION_REGEX, '');
        html = html.replace(RENAMED_CSP_ATTR_REGEX, (_match, quote: string) => `http-equiv=${quote}${CSP_HEADER_NAME}${quote}`);
        RENAMED_CSP_ATTR_REGEX.lastIndex = 0;

        const cspMeta = findCspMetaTag(html);
        const injectionContent = `${CSP_MARKER_START}\n${CSP_ABS_CONTENT.trim()}\n${CSP_MARKER_END}`;

        if (cspMeta) {
            const disabledTag = cspMeta.tag.replace(ORIGINAL_CSP_ATTR_REGEX, (_match, quote: string) => `http-equiv=${quote}${CSP_HEADER_RENAMED}${quote}`);
            const injectionBlock = `${disabledTag}\n${injectionContent}`;
            html = html.slice(0, cspMeta.index) + injectionBlock + html.slice(cspMeta.index + cspMeta.tag.length);
        } else if (/<head[^>]*>/i.test(html)) {
            html = html.replace(/<head[^>]*>/i, (head) => `${head}\n${injectionContent}`);
        } else {
            vscode.window.showWarningMessage('未找到 workbench.html 的 CSP 或 head 标签，已跳过 CSP 补丁。');
            continue;
        }

        if (html !== originalHtml) {
            console.log("应用 CSP 补丁...");
            await saveFilePrivileged(targetHtml, html);
        }
    }
}

function findCspMetaTag(html: string): { tag: string; index: number } | undefined {
    const metaTagRegex = /<meta\b[\s\S]*?>/gi;
    let match: RegExpExecArray | null;
    while ((match = metaTagRegex.exec(html))) {
        if (ORIGINAL_CSP_ATTR_REGEX.test(match[0])) {
            return { tag: match[0], index: match.index };
        }
    }
    return undefined;
}

async function injectJs(mediaPath: string, type: WallpaperType, opacity: number, port: number, customJs: string, resizeDelay: number, startupCheckInterval: number, showDebugSidebar: boolean, wallpaperFit: 'contain' | 'cover' | 'fill', interactionEnabled: boolean) {
    let elementCreationCode = '';

    if (type === WallpaperType.Video) {
        const finalUrl = toVsCodeResourceUrl(mediaPath);
        elementCreationCode = `
            el = document.createElement('video');
            el.src = "${finalUrl}";
            el.autoplay = true;
            el.loop = true;
            el.muted = true;
            el.play();
            el.style.opacity = '${opacity}';
        `;
    } else if (type === WallpaperType.Image) {
        const finalUrl = toVsCodeResourceUrl(mediaPath);
        elementCreationCode = `
            el = document.createElement('img');
            el.src = "${finalUrl}";
            el.style.opacity = '${opacity}';
        `;
    } else if (type === WallpaperType.Web) {
        const pingUrl = `http://127.0.0.1:${port}/ping`;
        const entryUrl = `http://127.0.0.1:${port}/api/get-entry`;
        
        elementCreationCode = `
            const entryUrl = "${entryUrl}";
            const pingUrl = "${pingUrl}";

            // 1. 创建 Loading 元素
            const loader = document.createElement('div');
            loader.innerHTML = '<div style="width: 30px; height: 30px; border: 3px solid rgba(255,255,255,0.3); border-top: 3px solid #fff; border-radius: 50%; animation: vscode-wallpaper-spin 1s linear infinite;"></div>';
            loader.style.position = 'absolute';
            loader.style.top = '50%';
            loader.style.left = '50%';
            loader.style.transform = 'translate(-50%, -50%)';
            loader.style.zIndex = '100000';
            
            // 注入动画样式
            if (!document.getElementById('vscode-wallpaper-style')) {
                const style = document.createElement('style');
                style.id = 'vscode-wallpaper-style';
                style.textContent = '@keyframes vscode-wallpaper-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
                document.head.appendChild(style);
            }
            
            container.appendChild(loader);

            // 2. 创建 iframe
            el = document.createElement('iframe');
            el.className = 'vscode-wallpaper-iframe';
            el.frameBorder = '0';
            el.allow = "autoplay; fullscreen; microphone; display-capture";
            el.style.opacity = '0'; // 初始隐藏
            el.style.transition = 'opacity 0.5s ease-in-out';
            
            const srcdocContent = \`
            <!DOCTYPE html>
            <html>
            <head>
                <base href='http://127.0.0.1:${port}/' />
                <style>body, html { margin: 0; padding: 0; overflow: hidden; background: black; }</style>
            </head>
            <body>
                <script>
                    const entryUrl = '${entryUrl}';
                    async function loadWallpaper() {
                        let attempts = 0;
                        while(attempts < 200) {
                            try {
                                const resp = await fetch(entryUrl);
                                if(!resp.ok) throw new Error('Server not ready');
                                let html = await resp.text();
                                
                                // [Fix] Inject <base> tag to ensure relative paths work
                                if (!html.includes('<base')) {
                                    const baseTag = "<base href='http://127.0.0.1:${port}/' />";
                                    if (html.includes('<head>')) {
                                        html = html.replace('<head>', '<head>' + baseTag);
                                    } else if (html.includes('<html>')) {
                                        html = html.replace('<html>', '<html><head>' + baseTag + '</head>');
                                    } else {
                                        html = '<head>' + baseTag + '</head>' + html;
                                    }
                                }

                                // [Fix] Static HTML file:// replacement
                                html = html.replace(/(src|href)\\\\s*=\\\\s*(["'])file:\\\\/\\\\/\\\\//gi, '$1=$2/');
                                html = html.replace(/url\\\\(\\\\s*(["']?)file:\\\\/\\\\/\\\\//gi, 'url($1/');
                                
                                const interceptor =  
                                    "<script>" +
                                    "(function(){" +
                                    "    function r(u){" +
                                    "        if(!u||typeof u!=='string')return u;" +
                                    "        if(u.startsWith('file:///'))return u.replace('file:///','/');" +
                                    "        return u;" +
                                    "    }" +
                                    "    const f=window.fetch;" +
                                    "    window.fetch=function(i,n){" +
                                    "        if(typeof i==='string')i=r(i);" +
                                    "        return f(i,n);" +
                                    "    };" +
                                    "    const o=XMLHttpRequest.prototype.open;" +
                                    "    XMLHttpRequest.prototype.open=function(m,u,...a){" +
                                    "        u=r(u);" +
                                    "        return o.call(this,m,u,...a);" +
                                    "    };" +
                                    "    function s(p){" +
                                    "        const d=Object.getOwnPropertyDescriptor(p,'src');" +
                                    "        if(d&&d.set){" +
                                    "            const os=d.set;" +
                                    "            Object.defineProperty(p,'src',{" +
                                    "                set:function(v){" +
                                    "                    if(this.tagName==='IMG'||this.tagName==='VIDEO'||this.tagName==='AUDIO'){" +
                                    "                        this.crossOrigin='anonymous';" +
                                    "                    }" +
                                    "                    os.call(this,r(v));" +
                                    "                }," +
                                    "                get:d.get," +
                                    "                enumerable:d.enumerable," +
                                    "                configurable:d.configurable" +
                                    "            });" +
                                    "        }" +
                                    "    }" +
                                    "    if(window.HTMLImageElement)s(window.HTMLImageElement.prototype);" +
                                    "    if(window.HTMLAudioElement)s(window.HTMLAudioElement.prototype);" +
                                    "    if(window.HTMLVideoElement)s(window.HTMLVideoElement.prototype);" +
                                    "    if(window.HTMLScriptElement)s(window.HTMLScriptElement.prototype);" +
                                    "})();" +
                                    "<\\\\/script>";

                                if (html.includes('<head>')) {
                                    html = html.replace('<head>', '<head>' + interceptor);
                                } else {
                                    html = interceptor + html;
                                }
                                document.open();
                                document.write(html);
                                document.close();
                                return;
                            } catch(err) {
                                console.warn('Wallpaper Load Retry:', err);
                                attempts++;
                                await new Promise(r => setTimeout(r, 500));
                            }
                        }
                        document.body.innerHTML = '<h1 style=color:red>Connection Failed</h1>';
                    }
                    loadWallpaper();
                </script>
            </body>
            </html>
            \`;
            
            // Expose control functions to global scope
            window.reloadWallpaper = () => {
                el.srcdoc = srcdocContent;
            };
            
            window.showWallpaper = () => {
                el.style.opacity = '${opacity}';
                if (loader.parentNode) loader.remove();
            };
            
            window.hideWallpaper = () => {
                el.style.opacity = '0';
                container.appendChild(loader);
            };

            el.onload = () => {
                window.showWallpaper();
            };
        `;
    }

    const SIDEBAR_CSS = `
    #vscode-wallpaper-sidebar input[type="range"], #vscode-wallpaper-sidebar input[type="color"], #vscode-wallpaper-sidebar select { width: 100%; background: #3c3c3c; border: 1px solid #555; color: white; margin-top: 5px; }
    #vscode-wallpaper-sidebar .control-item { margin-bottom: 15px; }
    #vscode-wallpaper-sidebar label { display: block; font-size: 11px; color: #888; margin-bottom: 4px; }
    #vscode-wallpaper-sidebar span.val { float: right; font-size: 11px; color: #007acc; }
    ${(()=>{if (showDebugSidebar) {return "";} else {
        return "#vscode-wallpaper-sidebar { display: none !important; } #vscode-wallpaper-sidebar + #sidebar-open-btn { display: none !important; }";
    }})()}
    `;

const jsInjection = `
/* [VSCode-Wallpaper-Injection-Start] */
(function() {
    if (window.__vscodeWallpaperEngineActive) {
        return;
    }
    window.__vscodeWallpaperEngineActive = true;

    const startWallpaperEngine = function() {
    try {
        const oldContainer = document.getElementById('vscode-wallpaper-container');
        if (oldContainer) oldContainer.remove();

        const container = document.createElement('div');
        container.id = 'vscode-wallpaper-container';
        container.style.position = 'fixed'; 
        container.style.top = '0'; 
        container.style.left = '0'; 
        container.style.width = '100%'; 
        container.style.height = '100%';
        container.style.zIndex = '0';
        container.style.pointerEvents = 'none';
        container.style.opacity = '1';
        container.style.display = 'flex';

        const SERVER_ROOT = 'http://127.0.0.1:${port}';
        const PING_URL = SERVER_ROOT + '/ping';
        const CONFIG_URL = SERVER_ROOT + '/config';
        let weInteractionEnabled = ${interactionEnabled};

        // [Fix] Force transparent background for workbench container
        const baseStyle = document.createElement('style');
        baseStyle.id = 'vscode-wallpaper-base-style';
        baseStyle.textContent = [
            'html, body { background: transparent !important; background-color: transparent !important; }',
            'div[role="application"], .monaco-workbench { background: transparent !important; position: relative !important; z-index: 1 !important; }',
            '.monaco-workbench .part.editor, .monaco-workbench .part.sidebar, .monaco-workbench .part.panel, .monaco-workbench .part.auxiliarybar { background: transparent !important; }',
            '.monaco-workbench .editor-group-container, .monaco-workbench .active.empty { background: transparent !important; }'
        ].join('\\n');
        document.head.appendChild(baseStyle);

        // Inject Transparency CSS
        const transparencyStyle = document.createElement('style');
        transparencyStyle.id = 'vscode-wallpaper-transparency';
        document.head.appendChild(transparencyStyle);

        let lastRuntimeConfig = null;
        let adaptiveColorRequest = 0;

        function clampColor(value) {
            return Math.max(0, Math.min(255, Math.round(value)));
        }

        function getWeightedPalette(imageData) {
            const pixels = imageData.data;
            const bins = new Map();
            let totalWeight = 0;
            let weightedR = 0;
            let weightedG = 0;
            let weightedB = 0;

            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] < 160) { continue; }
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const saturation = max === 0 ? 0 : (max - min) / max;
                const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
                const edgePenalty = luminance < 0.035 || luminance > 0.965 ? 0.08 : 1;
                const weight = (0.18 + saturation * 1.82) * edgePenalty;
                if (weight <= 0.02) { continue; }

                totalWeight += weight;
                weightedR += r * weight;
                weightedG += g * weight;
                weightedB += b * weight;

                const key = (r >> 5) + ':' + (g >> 5) + ':' + (b >> 5);
                const bin = bins.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
                bin.weight += weight;
                bin.r += r * weight;
                bin.g += g * weight;
                bin.b += b * weight;
                bins.set(key, bin);
            }

            if (totalWeight === 0 || bins.size === 0) { return null; }
            let dominant = null;
            for (const bin of bins.values()) {
                if (!dominant || bin.weight > dominant.weight) { dominant = bin; }
            }
            if (!dominant) { return null; }

            const average = {
                r: weightedR / totalWeight,
                g: weightedG / totalWeight,
                b: weightedB / totalWeight
            };
            const dominantColor = {
                r: dominant.r / dominant.weight,
                g: dominant.g / dominant.weight,
                b: dominant.b / dominant.weight
            };
            return {
                r: clampColor(dominantColor.r * 0.68 + average.r * 0.32),
                g: clampColor(dominantColor.g * 0.68 + average.g * 0.32),
                b: clampColor(dominantColor.b * 0.68 + average.b * 0.32)
            };
        }

        function sampleVisual(source) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) { return null; }
                context.drawImage(source, 0, 0, canvas.width, canvas.height);
                return getWeightedPalette(context.getImageData(0, 0, canvas.width, canvas.height));
            } catch (error) {
                console.debug('[WP colors] Visual sampling unavailable:', error);
                return null;
            }
        }

        async function sampleWallpaperPreview() {
            const candidates = ['/preview.jpg', '/preview.png', '/preview.jpeg', '/preview.webp'];
            try {
                const projectResponse = await fetch(SERVER_ROOT + '/project.json', { cache: 'no-store' });
                if (projectResponse.ok) {
                    const project = await projectResponse.json();
                    if (project && typeof project.preview === 'string' && project.preview.trim()) {
                        candidates.unshift('/' + project.preview.replace(/^[/\\\\]+/, ''));
                    }
                }
            } catch (error) {
                // Custom wallpapers do not need a project.json file.
            }
            for (const candidate of candidates) {
                try {
                    const response = await fetch(SERVER_ROOT + candidate, { cache: 'no-store' });
                    if (!response.ok) { continue; }
                    const bitmap = await createImageBitmap(await response.blob());
                    const palette = sampleVisual(bitmap);
                    bitmap.close();
                    if (palette) { return palette; }
                } catch (error) {
                    // Try the next conventional preview name.
                }
            }
            return null;
        }

        function applyAdaptivePalette(palette, strength) {
            const root = document.documentElement;
            const rawLuminance = (0.2126 * palette.r + 0.7152 * palette.g + 0.0722 * palette.b) / 255;
            const scale = rawLuminance > 0.62 ? 0.58 : rawLuminance < 0.12 ? 1.32 : 0.82;
            const r = clampColor(palette.r * scale);
            const g = clampColor(palette.g * scale);
            const b = clampColor(palette.b * scale);
            const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            const mixTarget = luminance < 0.48 ? 255 : 0;
            const accentR = clampColor(r * 0.72 + mixTarget * 0.28);
            const accentG = clampColor(g * 0.72 + mixTarget * 0.28);
            const accentB = clampColor(b * 0.72 + mixTarget * 0.28);
            const foreground = luminance < 0.5 ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.94)';
            const amount = Math.max(0, Math.min(1, Number(strength)));

            root.dataset.vweAdaptiveColors = 'true';
            root.style.setProperty('--vwe-adaptive-nav-bg', 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (0.24 + amount * 0.46).toFixed(3) + ')');
            root.style.setProperty('--vwe-adaptive-top-bg', 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (0.18 + amount * 0.38).toFixed(3) + ')');
            root.style.setProperty('--vwe-adaptive-active-bg', 'rgba(' + accentR + ', ' + accentG + ', ' + accentB + ', ' + (0.18 + amount * 0.32).toFixed(3) + ')');
            root.style.setProperty('--vwe-adaptive-border', 'rgba(' + accentR + ', ' + accentG + ', ' + accentB + ', ' + (0.18 + amount * 0.26).toFixed(3) + ')');
            root.style.setProperty('--vwe-adaptive-fg', foreground);
        }

        function clearAdaptivePalette() {
            const root = document.documentElement;
            delete root.dataset.vweAdaptiveColors;
            for (const property of ['--vwe-adaptive-nav-bg', '--vwe-adaptive-top-bg', '--vwe-adaptive-active-bg', '--vwe-adaptive-border', '--vwe-adaptive-fg']) {
                root.style.removeProperty(property);
            }
        }

        async function refreshAdaptivePalette(config) {
            const request = ++adaptiveColorRequest;
            if (!config || !config.adaptiveColorsEnabled) {
                clearAdaptivePalette();
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 420));
            if (request !== adaptiveColorRequest) { return; }

            let palette = null;
            if (typeof el !== 'undefined' && el) {
                if (el.tagName === 'IMG' && el.complete && el.naturalWidth > 0) {
                    palette = sampleVisual(el);
                } else if (el.tagName === 'VIDEO' && el.readyState >= 2) {
                    palette = sampleVisual(el);
                }
            }
            if (!palette) { palette = await sampleWallpaperPreview(); }
            if (request !== adaptiveColorRequest) { return; }
            if (palette) {
                applyAdaptivePalette(palette, config.adaptiveColorsStrength);
            } else {
                clearAdaptivePalette();
            }
        }

        async function updateCss() {
            try {
                console.log("[WP style inj] Fetching config from " + CONFIG_URL);
                const res = await fetch(CONFIG_URL);
                if (res.ok) {
                    const config = await res.json();
                    lastRuntimeConfig = config;
                    console.log("[WP style inj] Got config:", config);
                    if (typeof config.interaction === 'boolean') {
                        weInteractionEnabled = config.interaction;
                    }
                    const css = [config.glassCss, config.customCss].filter(Boolean).join('\\n\\n');
                    
                    if (transparencyStyle.textContent !== css) {
                        console.log("[WP style inj] Updating style tag content...");
                        transparencyStyle.textContent = css;
                        console.log("[WP style inj] Update complete.");
                    } else {
                        console.log("[WP style inj] CSS is identical, skipping update.");
                    }
                    void refreshAdaptivePalette(config);
                } else {
                    console.error("[WP style inj] Fetch failed status:", res.status);
                }
            } catch (e) { console.error("[WP style inj] CSS Update Failed", e); }
        }

        async function mainLoop() {
            // 1. Wait for server
            const start = Date.now();
            while (true) {
                try {
                    const resp = await fetch(PING_URL, { method: 'GET', mode: 'cors' });
                    if (resp.ok || resp.status === 205) {
                        console.log("[WP] Server is ready!");
                        break;
                    }
                } catch (e) { }
                await new Promise(resolve => setTimeout(resolve, 200));
                if (Date.now() - start > 30000) { console.error("[WP] Server timeout"); return; }
            }

            // 2. Initialize
            await updateCss();
            if (typeof initSidebar === 'function') initSidebar();
            if (window.reloadWallpaper) window.reloadWallpaper();
            
            // 3. Monitor Loop
            while(true) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                try {
                    const resp = await fetch(PING_URL, { method: 'GET', mode: 'cors' });
                    if (resp.status === 205) {
                        console.log("[WP style inj] Reload signal received (205).");
                        await updateCss();
                        if (window.reloadWallpaper) window.reloadWallpaper();
                    }
                } catch(e) {
                    console.warn("[WP] Server disconnected...");
                    if (window.hideWallpaper) window.hideWallpaper();
                    // Re-enter wait loop
                    mainLoop(); 
                    return;
                }
            }
        }
        
        mainLoop();

        // Sidebar
        if (true) {
            // container.style.pointerEvents = 'auto';
            
            // Use insertAdjacentHTML to handle multiple root elements correctly
            container.insertAdjacentHTML('beforeend', \`${SIDEBAR_HTML}\`);
            
            const style = document.createElement('style');
            style.textContent = \`${SIDEBAR_CSS}\`;
            document.head.appendChild(style);
            
            var initSidebar = function() {
                console.log("[Sidebar] JS Injection Starting...");
                try {
                    // Ensure we search in the document, container should be appended by now
                    const panel = document.getElementById('propsPanel');
                    if (panel) panel.innerText = "Initializing...";
                    else console.error("[Sidebar] propsPanel not found!");
                    
                    ${SIDEBAR_JS_LOGIC}
                    
                    const SERVER_ROOT = 'http://127.0.0.1:${port}';
                    console.log("[Sidebar] Fetching project.json from " + SERVER_ROOT);
                    
                    if (panel) panel.innerText = "Fetching config from " + SERVER_ROOT + "...";

                    fetch(SERVER_ROOT + '/project.json')
                        .then(res => {
                            console.log("[Sidebar] Response status:", res.status);
                            if (!res.ok) throw new Error("Status " + res.status);
                            return res.json();
                        })
                        .then(json => {
                            console.log("[Sidebar] Got JSON:", json);
                            renderUI(json);
                        })
                        .catch(e => {
                            console.error("[Sidebar] Error:", e);
                            if (panel) panel.innerHTML = '<span style="color:orange">Failed to load project.json: ' + e.message + '</span>';
                        });

                    // Toggle Logic
                    const sidebar = document.getElementById('vscode-wallpaper-sidebar');
                    const closeBtn = document.getElementById('sidebar-close-btn');
                    const openBtn = document.getElementById('sidebar-open-btn');

                    function toggleSidebar(show) {
                        if (show) {
                            sidebar.style.width = '300px';
                            openBtn.style.display = 'none';
                        } else {
                            sidebar.style.width = '0px';
                            openBtn.style.display = 'block';
                        }
                    }

                    if (closeBtn) closeBtn.onclick = () => {toggleSidebar(false); console.log("Close clicked");}
                    if (openBtn) openBtn.onclick = () => {toggleSidebar(true); console.log("Open clicked"); }

                    // [New] Open Folder Logic
                    const openFolderBtn = document.getElementById('openFolderBtn');
                    if (openFolderBtn) {
                        openFolderBtn.onclick = () => {
                            fetch(SERVER_ROOT + '/open-folder')
                                .then(r => {
                                    if (!r.ok) console.error('Failed to open folder');
                                })
                                .catch(e => console.error('Error opening folder:', e));
                        };
                    }

                    function updateProp(key, val) {
                        const payload = {};
                        payload[key] = { value: val };
                        if (el && el.contentWindow) {
                            el.contentWindow.postMessage({ type: 'UPDATE_PROPERTIES', data: payload }, '*');
                            el.contentWindow.postMessage({ type: 'PROPERTIES', data: payload }, '*');
                        }
                    }
                    window.updateProp = updateProp;

                } catch (err) {
                    console.error("[Sidebar] Critical Error:", err);
                    const panel = document.getElementById('propsPanel');
                    if (panel) panel.innerHTML = '<span style="color:red">JS Error: ' + err.message + '</span>';
                }
            };
        }

        const wrapper = document.createElement('div');
        wrapper.style.flex = '1';
        wrapper.style.position = 'relative';
        wrapper.style.height = '100%';
        wrapper.style.pointerEvents = 'none';

        let el;
        ${elementCreationCode}

        if (el.tagName === 'IMG') {
            el.addEventListener('load', function() { if (lastRuntimeConfig) { void refreshAdaptivePalette(lastRuntimeConfig); } });
        } else if (el.tagName === 'VIDEO') {
            el.addEventListener('loadeddata', function() { if (lastRuntimeConfig) { void refreshAdaptivePalette(lastRuntimeConfig); } });
        }

        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = '${wallpaperFit}';
        
        if (el.tagName === 'IFRAME') {
             el.style.border = 'none';
             el.style.display = 'block';
             el.style.pointerEvents = 'none'; 
        }

        wrapper.appendChild(el);
        container.appendChild(wrapper);
        document.body.appendChild(container);

        // Resize handler: Reload iframe on window resize
        if (el.tagName === 'IFRAME') {
             let resizeTimeout;
             window.addEventListener('resize', () => {
                 clearTimeout(resizeTimeout);
                 resizeTimeout = setTimeout(() => {
                     el.srcdoc = srcdocContent;
                 }, ${resizeDelay});
             });
        }

        // [Interaction] Forward cursor input to the web wallpaper (WE-style native DOM events).
        // The iframe stays click-through (pointer-events:none), so real cursor input lands on the
        // editor; we capture it here at the workbench and post normalized coords into the iframe,
        // where the mock re-synthesizes DOM mouse/wheel events. Editor clicks/typing are untouched.
        if (el.tagName === 'IFRAME') {
            const postMouse = function(kind, ev, extra) {
                if (!weInteractionEnabled || !el.contentWindow) { return; }
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) { return; }
                const nx = (ev.clientX - rect.left) / rect.width;
                const ny = (ev.clientY - rect.top) / rect.height;
                if (nx < 0 || nx > 1 || ny < 0 || ny > 1) { return; }
                const payload = { kind: kind, nx: nx, ny: ny, button: ev.button || 0, buttons: ev.buttons || 0 };
                if (extra) { Object.assign(payload, extra); }
                el.contentWindow.postMessage({ type: 'WE_MOUSE', data: payload }, '*');
            };

            // Live toggle relayed from the iframe's WebSocket (see WE_INTERACTION in the mock).
            window.addEventListener('message', function(ev) {
                if (ev.data && ev.data.type === 'WE_INTERACTION') {
                    weInteractionEnabled = !!ev.data.enabled;
                }
            });

            let lastMove = null;
            let moveScheduled = false;
            window.addEventListener('mousemove', function(ev) {
                lastMove = ev;
                if (moveScheduled) { return; }
                moveScheduled = true;
                requestAnimationFrame(function() {
                    moveScheduled = false;
                    if (lastMove) { postMouse('mousemove', lastMove); }
                });
            }, { capture: true, passive: true });

            window.addEventListener('mousedown', function(ev) { postMouse('mousedown', ev); }, { capture: true, passive: true });
            window.addEventListener('mouseup', function(ev) { postMouse('mouseup', ev); }, { capture: true, passive: true });
            window.addEventListener('click', function(ev) { postMouse('click', ev); }, { capture: true, passive: true });
            window.addEventListener('wheel', function(ev) { postMouse('wheel', ev, { deltaX: ev.deltaX, deltaY: ev.deltaY }); }, { capture: true, passive: true });
        }

        try {
            ${customJs}
        } catch (e) { console.error("Custom JS Error:", e); }

    } catch (e) { console.error("Wallpaper Engine Error:", e); }
    };

    if (document.body) {
        startWallpaperEngine();
    } else {
        window.addEventListener('DOMContentLoaded', startWallpaperEngine, { once: true });
    }
})();
/* [VSCode-Wallpaper-Injection-End] */`;

    try {
        const cleanupJsPaths = getWorkbenchCleanupJsPaths();
        const injectionJsPaths = getWorkbenchInjectionJsPaths();
        if (cleanupJsPaths.length === 0 || injectionJsPaths.length === 0) {
            throw new Error('未找到 VS Code workbench JavaScript 文件。');
        }

        const injectionTargets = new Set(injectionJsPaths.map(p => path.normalize(p)));
        for (const jsPath of cleanupJsPaths) {
            let raw = fs.readFileSync(jsPath, 'utf-8');
            const cleaned = raw.replace(JS_INJECTION_REGEX, '');
            const normalized = path.normalize(jsPath);
            if (injectionTargets.has(normalized)) {
                await saveFilePrivileged(jsPath, cleaned + jsInjection);
            } else if (cleaned !== raw) {
                await saveFilePrivileged(jsPath, cleaned);
            }
        }
    } catch (e) {
        throw new Error(`JS 注入失败: ${e}`);
    }
}

export async function performInjection(mediaPath: string, type: WallpaperType, opacity: number, port: number, customJs: string, resizeDelay: number, startupCheckInterval: number, autoRestart = true, showDebugSidebar = false, wallpaperFit: 'contain' | 'cover' | 'fill' = 'contain', interactionEnabled = true) {
    try {
        await patchWorkbenchHtml();
        await patchIntegrityWarning();
        await injectJs(mediaPath, type, opacity, port, customJs, resizeDelay, startupCheckInterval, showDebugSidebar, wallpaperFit, interactionEnabled);
        const syncedChecksumKeys = await syncProductChecksums();
        if (syncedChecksumKeys.length > 0) {
            await showFullRestartMessage('已安装壁纸并同步 VS Code 校验');
            return;
        }
        
        if (autoRestart) {
            // 直接重启，无需用户确认
            vscode.window.setStatusBarMessage('Wallpaper installed. Restarting...', 5000);
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(error.message || String(error));
    }
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

const SIDEBAR_HTML = `
<div id="vscode-wallpaper-sidebar" style="width: 300px; min-width: 0; flex-shrink: 0; white-space: nowrap; background: #252526; border-right: 1px solid #333; display: flex; flex-direction: column; height: 100%; overflow: hidden; pointer-events: auto; z-index: 100001; transition: width 0.3s ease;">
    <div style="padding: 15px; background: #333; font-weight: bold; border-bottom: 1px solid #444; color: #ccc; display: flex; justify-content: space-between; align-items: center;">
        <span>WE Debugger</span>
        <button id="sidebar-close-btn" style="background:none; border:none; color:#ccc; cursor:pointer; font-weight:bold; padding: 0 5px; pointer-events: auto;">&lt;</button>
    </div>
    <div style="padding: 10px; border-bottom: 1px solid #444; background: #2d2d2d;">
        <label style="display: block; font-size: 11px; color: #888; margin-bottom: 5px;">Audio Source</label>
        <select id="audioSource" style="width:100%; background:#3c3c3c; color:white; border:1px solid #555; padding:2px; pointer-events: auto;">
            <option value="simulate">Simulate (Sine Wave)</option>
            <option value="mic">Microphone (Real Audio)</option>
            <option value="system">System Audio (Screen Share)</option>
            <option value="off">Off (Silence)</option>
        </select>
    </div>
    <div style="padding: 10px; border-bottom: 1px solid #444; background: #2d2d2d;">
        <button id="openFolderBtn" style="width:100%; background:#0e639c; color:white; border:none; padding:5px; cursor:pointer; pointer-events: auto;">Open Wallpaper Folder</button>
    </div>
    <div style="padding: 15px; overflow-y: auto; flex: 1; color: #ccc;" id="propsPanel">
        <div style="color:#666; text-align:center; margin-top:20px;">Loading config...</div>
    </div>
</div>
<button id="sidebar-open-btn" style="top: 10px; left: 10px; z-index: 100002; background: #333; color: #ccc; border: 1px solid #444; padding: 5px 10px; cursor: pointer; display: none; pointer-events: auto;">
    ☰
</button>
`;

const SIDEBAR_JS_LOGIC = `
    function getSafeValue(p) {
        if (p.value !== undefined && p.value !== null) return p.value;
        if (p.default !== undefined && p.default !== null) return p.default;
        if (p.type === 'color') return "1 1 1";
        if (p.type === 'slider') return p.min || 0;
        if (p.type === 'bool') return false;
        if (p.type === 'combo') return (p.options && p.options[0] && p.options[0].value) || "";
        return "";
    }

    function weColorToHex(str) {
        if (!str || typeof str !== 'string') return '#ffffff';
        const parts = str.split(' ').map(parseFloat);
        if (parts.length < 3) return '#ffffff';
        const toHex = (n) => {
            const hex = Math.floor(Math.min(1,Math.max(0,n)) * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return '#' + toHex(parts[0]) + toHex(parts[1]) + toHex(parts[2]);
    }

    function renderUI(json) {
        const panel = document.getElementById('propsPanel');
        panel.innerHTML = '';
        const props = json.properties || (json.general && json.general.properties) || {};
        
        Object.keys(props).forEach(key => {
            const p = props[key];
            const safeVal = getSafeValue(p);

            const div = document.createElement('div');
            div.className = 'control-item';
            const lbl = document.createElement('label');
            lbl.innerText = p.text || key;
            div.appendChild(lbl);

            let input;
            if (p.type === 'slider') {
                const valSpan = document.createElement('span');
                valSpan.className = 'val';
                valSpan.innerText = safeVal;
                lbl.appendChild(valSpan);
                input = document.createElement('input');
                input.type = 'range';
                input.min = p.min ?? 0; input.max = p.max ?? 100; input.step = p.step ?? 1;
                input.value = safeVal;
                input.oninput = (e) => {
                    let v = parseFloat(e.target.value);
                    if (p.step % 1 !== 0) v = parseFloat(v.toFixed(2));
                    valSpan.innerText = v;
                    updateProp(key, v);
                };
            } else if (p.type === 'color') {
                input = document.createElement('input');
                input.type = 'color';
                input.value = weColorToHex(safeVal);
                input.oninput = (e) => {
                    const h = e.target.value;
                    const r = parseInt(h.substr(1,2), 16)/255;
                    const g = parseInt(h.substr(3,2), 16)/255;
                    const b = parseInt(h.substr(5,2), 16)/255;
                    updateProp(key, \`\${r.toFixed(3)} \${g.toFixed(3)} \${b.toFixed(3)}\`);
                };
            } else if (p.type === 'bool') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.style.width = 'auto';
                input.checked = safeVal;
                input.onchange = (e) => updateProp(key, e.target.checked);
            } else if (p.type === 'combo') {
                input = document.createElement('select');
                (p.options || []).forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt.value;
                    o.innerText = opt.label;
                    if (opt.value == safeVal) o.selected = true;
                    input.appendChild(o);
                });
                input.onchange = (e) => updateProp(key, e.target.value);
            } else {
                input = document.createElement('input');
                input.type = 'text';
                input.value = safeVal;
                input.onchange = (e) => updateProp(key, e.target.value);
            }

            if (input) {
                div.appendChild(input);
                panel.appendChild(div);
            }
        });
    }

    // Audio Logic
    let audioContext;
    let analyser;
    let dataArray;
    let micStream;
    let audioSourceType = 'off';

    const audioSelect = document.getElementById('audioSource');
    
    function setAudioSource(val) {
        audioSourceType = val;
        if (audioSelect) audioSelect.value = val;
        if (audioSourceType === 'mic') initMic();
        else if (audioSourceType === 'system') initSystemAudio();
        else stopAudio();
    }

    if (audioSelect) {
        audioSelect.onchange = (e) => setAudioSource(e.target.value);
    }

    // Listen for requests from Iframe (forwarded from Settings Panel)
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'CHANGE_AUDIO_SOURCE') {
            console.log("[Sidebar] Received audio source change request:", e.data.source);
            setAudioSource(e.data.source);
        }
    });

    async function initMic() {
        stopAudio();
        if (audioContext) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream = stream;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 128; 
            source.connect(analyser);
            dataArray = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) {
            console.error("Mic Error:", e);
            if (audioSelect) audioSelect.value = 'simulate';
            audioSourceType = 'simulate';
        }
    }

    async function initSystemAudio() {
        stopAudio();
        if (audioContext) return;
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            micStream = stream;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 128; 
            source.connect(analyser);
            dataArray = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) {
            console.error("System Audio Error:", e);
            if (audioSelect) audioSelect.value = 'simulate';
            audioSourceType = 'simulate';
        }
    }

    function stopAudio() {
        if (micStream) {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        analyser = null;
    }

    function audioLoop() {
        let audioData = new Array(64).fill(0);
        
        if (audioSourceType === 'simulate') {
            const t = Date.now() / 1000;
            for(let i=0; i<64; i++) {
                let v = Math.max(0, Math.sin(i*0.1 + t*10) * 0.8);
                v *= (1 - i/64);
                v += Math.random() * 0.2; 
                audioData[i] = Math.min(1, v);
                audioData[i+64] = Math.min(1, v);
            }
        } else if ((audioSourceType === 'mic' || audioSourceType === 'system') && analyser) {
            analyser.getByteFrequencyData(dataArray);
            for (let i = 0; i < 64; i++) {
                if (i < dataArray.length) {
                    audioData[i] = dataArray[i] / 255.0;
                }
            }
        } else if (audioSourceType === 'off') {
            audioData.fill(0);
        }

        const finalData = new Array(128).fill(0);
        for (let i = 0; i < 64; i++) {
            finalData[i*2] = audioData[i];
            finalData[i*2+1] = audioData[i];
        }
        
        if (typeof el !== 'undefined' && el && el.contentWindow) {
            el.contentWindow.postMessage({ type: 'AUDIO_TICK', data: finalData }, '*');
        }

        requestAnimationFrame(audioLoop);
    }
    audioLoop();
`;
