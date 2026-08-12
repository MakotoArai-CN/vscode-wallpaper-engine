import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WallpaperType } from './types';

const IMAGE_FILE_REGEX = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
const VIDEO_FILE_REGEX = /\.(mp4|webm|mkv|avi|mov|m4v)$/i;
const WEB_FILE_REGEX = /\.(html|htm)$/i;

export interface ScanWallpapersOptions {
    onProgress?: (scanned: number, total: number) => void;
    signal?: AbortSignal;
    includeUnsupported?: boolean;
}

interface ResolvedWallpaperInfo {
    type: WallpaperType;
    file: string;
    location: string;
    sourceType: string;
    unsupportedReason?: string;
}

function findPreviewFile(dirPath: string, previewFile?: unknown): string | undefined {
    const candidates = [
        typeof previewFile === 'string' ? previewFile : undefined,
        'preview.jpg',
        'preview.jpeg',
        'preview.png',
        'preview.webp'
    ].filter((file): file is string => !!file && IMAGE_FILE_REGEX.test(file));

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(dirPath, candidate))) {
            return candidate;
        }
    }

    return undefined;
}

// 定义壁纸数据模型
export class WallpaperItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail: string;
    dirPath: string;
    type: WallpaperType;
    id: string;
    location: string;
    sourceType: string;
    unsupportedReason?: string;
    
    constructor(title: string, id: string, file: string, dirPath: string, type: WallpaperType, location?: string, sourceType?: string, unsupportedReason?: string) {
        this.label = `${unsupportedReason ? '$(warning)' : '$(device-camera-video)'} ${title}`;
        this.description = unsupportedReason ? `ID: ${id} [preview only]` : `ID: ${id} [${type}]`;
        this.detail = file;
        this.dirPath = dirPath;
        this.type = type;
        this.id = id;
        this.location = location || dirPath;
        this.sourceType = sourceType || type;
        this.unsupportedReason = unsupportedReason;
    }

    getMediaPath(): { path: string, type: WallpaperType } {
        let mainFile = this.detail || 'index.html'; // Fallback
        let finalPath = path.join(this.location, mainFile); // Use location instead of dirPath

        // Wallpaper Engine 的 scene.pkg 无法直接在浏览器里渲染，图片类型优先用可见预览图兜底。
        if (this.type === WallpaperType.Image && !IMAGE_FILE_REGEX.test(mainFile)) {
            const preview = findPreviewFile(this.location);
            if (preview) {
                finalPath = path.join(this.location, preview);
            }
        }
        return { path: finalPath, type: this.type };
    }
}

function createUnsupportedPreview(dirPath: string, previewFile: string | undefined, sourceType: string, includeUnsupported: boolean): ResolvedWallpaperInfo | null {
    if (!includeUnsupported || !previewFile) {
        return null;
    }

    return {
        type: WallpaperType.Image,
        file: previewFile,
        location: dirPath,
        sourceType,
        unsupportedReason: `${sourceType} wallpapers require Wallpaper Engine's native scene renderer; Live Wallpaper can only show the preview image.`
    };
}

function isDirectlyRenderable(type: WallpaperType, file: string): boolean {
    if (type === WallpaperType.Image) {
        return IMAGE_FILE_REGEX.test(file);
    }

    if (type === WallpaperType.Video) {
        return VIDEO_FILE_REGEX.test(file);
    }

    if (type === WallpaperType.Web) {
        return WEB_FILE_REGEX.test(file);
    }

    return false;
}

function resolveWallpaperInfo(workshopPath: string, id: string, options: Pick<ScanWallpapersOptions, 'includeUnsupported'> = {}, visited = new Set<string>()): ResolvedWallpaperInfo | null {
    if (visited.has(id)) {
        return null;
    }
    visited.add(id);

    const dirPath = path.join(workshopPath, id);
    const projectJsonPath = path.join(dirPath, 'project.json');
    if (!fs.existsSync(projectJsonPath)) {
        return null;
    }

    try {
        const json = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        const rawType = json.type ? json.type.toLowerCase() : '';
        let type: WallpaperType | null = null;

        if (rawType === 'scene') {
            const preview = findPreviewFile(dirPath, json.preview);
            return createUnsupportedPreview(dirPath, preview, 'scene', options.includeUnsupported === true);
        }

        if (rawType === 'video') {
            type = WallpaperType.Video;
        } else if (rawType === 'image') {
            type = WallpaperType.Image;
        } else if (rawType === 'web') {
            type = WallpaperType.Web;
        }

        let file = json.file || null;

        if (type) {
            file = file || 'index.html';

            if (isDirectlyRenderable(type, file)) {
                return { type, file, location: dirPath, sourceType: rawType || type };
            }

            const preview = findPreviewFile(dirPath, json.preview);
            return createUnsupportedPreview(dirPath, preview, rawType || type, options.includeUnsupported === true);
        }

        // Try dependency
        if (json.dependency) {
            const depInfo = resolveWallpaperInfo(workshopPath, json.dependency, options, visited);
            if (depInfo) {
                return { ...depInfo, file: file || depInfo.file };
            }
        }

        const preview = findPreviewFile(dirPath, json.preview);
        return createUnsupportedPreview(dirPath, preview, rawType || 'unknown', options.includeUnsupported === true);
    } catch (e) {}
    return null;
}

export function scanWallpapers(workshopPath: string, options: Pick<ScanWallpapersOptions, 'includeUnsupported'> = {}): WallpaperItem[] {
    const wallpaperDirs = fs.readdirSync(workshopPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

    const items: WallpaperItem[] = [];

    for (const dir of wallpaperDirs) {
        const info = resolveWallpaperInfo(workshopPath, dir, options);
        if (info) {
            const projectJsonPath = path.join(workshopPath, dir, 'project.json');
            try {
                const json = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
                items.push(new WallpaperItem(
                    json.title || '未命名', 
                    dir, 
                    info.file, 
                    path.join(workshopPath, dir),
                    info.type,
                    info.location,
                    info.sourceType,
                    info.unsupportedReason
                ));
            } catch (e) {}
        }
    }
    return items;
}

export async function scanWallpapersAsync(workshopPath: string, options: ScanWallpapersOptions = {}): Promise<WallpaperItem[]> {
    const entries = await fs.promises.readdir(workshopPath, { withFileTypes: true });
    const wallpaperDirs = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    const items: WallpaperItem[] = [];

    for (let index = 0; index < wallpaperDirs.length; index++) {
        if (options.signal?.aborted) {
            break;
        }

        const dir = wallpaperDirs[index];
        const info = resolveWallpaperInfo(workshopPath, dir, options);
        if (info) {
            const projectJsonPath = path.join(workshopPath, dir, 'project.json');
            try {
                const json = JSON.parse(await fs.promises.readFile(projectJsonPath, 'utf-8'));
                items.push(new WallpaperItem(
                    json.title || '未命名',
                    dir,
                    info.file,
                    path.join(workshopPath, dir),
                    info.type,
                    info.location,
                    info.sourceType,
                    info.unsupportedReason
                ));
            } catch {
                // Ignore malformed or unreadable project files and keep scanning.
            }
        }

        if (index % 40 === 0 || index === wallpaperDirs.length - 1) {
            options.onProgress?.(index + 1, wallpaperDirs.length);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return items;
}

export function getWallpaperById(workshopPath: string, id: string, options: Pick<ScanWallpapersOptions, 'includeUnsupported'> = {}): WallpaperItem | null {
    const info = resolveWallpaperInfo(workshopPath, id, options);
    if (info) {
        const dirPath = path.join(workshopPath, id);
        const projectJsonPath = path.join(dirPath, 'project.json');
        try {
            const json = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
            return new WallpaperItem(
                json.title || '未命名', 
                id, 
                info.file, 
                dirPath,
                info.type,
                info.location,
                info.sourceType,
                info.unsupportedReason
            );
        } catch (e) {}
    }
    return null;
}
