import * as fs from 'fs';
import * as path from 'path';
import { WallpaperType } from './types';
import { WallpaperItem } from './scanner';

export const CUSTOM_WALLPAPER_ID_PREFIX = 'custom:';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v']);
const WEB_EXTENSIONS = new Set(['.html', '.htm']);

function getWallpaperType(filePath: string): WallpaperType | undefined {
    const extension = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) { return WallpaperType.Image; }
    if (VIDEO_EXTENSIONS.has(extension)) { return WallpaperType.Video; }
    if (WEB_EXTENSIONS.has(extension)) { return WallpaperType.Web; }
    return undefined;
}

function encodeWallpaperPath(filePath: string): string {
    return Buffer.from(path.resolve(filePath), 'utf-8').toString('base64url');
}

function decodeWallpaperPath(id: string): string | undefined {
    if (!id.startsWith(CUSTOM_WALLPAPER_ID_PREFIX)) {
        return undefined;
    }

    try {
        return Buffer.from(id.slice(CUSTOM_WALLPAPER_ID_PREFIX.length), 'base64url').toString('utf-8');
    } catch {
        return undefined;
    }
}

export function isCustomWallpaperId(id: string | undefined): boolean {
    return Boolean(id?.startsWith(CUSTOM_WALLPAPER_ID_PREFIX));
}

function findDirectoryEntry(dirPath: string): string | undefined {
    const htmlCandidates = ['index.html', 'index.htm'];
    for (const candidate of htmlCandidates) {
        const fullPath = path.join(dirPath, candidate);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            return fullPath;
        }
    }

    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));

        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            if (getWallpaperType(fullPath)) {
                return fullPath;
            }
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function createItemFromEntry(entryPath: string, title?: string): WallpaperItem | undefined {
    const type = getWallpaperType(entryPath);
    if (!type) {
        return undefined;
    }

    const absoluteEntry = path.resolve(entryPath);
    const rootPath = path.dirname(absoluteEntry);
    const fileName = path.basename(absoluteEntry);
    const itemTitle = title || path.basename(fileName, path.extname(fileName));
    const item = new WallpaperItem(
        itemTitle,
        `${CUSTOM_WALLPAPER_ID_PREFIX}${encodeWallpaperPath(absoluteEntry)}`,
        fileName,
        rootPath,
        type,
        rootPath
    );

    item.label = `$(file-media) ${itemTitle}`;
    item.description = `Custom [${type}]`;
    return item;
}

export function createCustomWallpaperItem(inputPath: string): WallpaperItem | undefined {
    let stat: fs.Stats;
    const absolutePath = path.resolve(inputPath);

    try {
        stat = fs.statSync(absolutePath);
    } catch {
        return undefined;
    }

    if (stat.isFile()) {
        return createItemFromEntry(absolutePath);
    }

    if (stat.isDirectory()) {
        const entryPath = findDirectoryEntry(absolutePath);
        if (!entryPath) {
            return undefined;
        }
        return createItemFromEntry(entryPath, path.basename(absolutePath));
    }

    return undefined;
}

export function scanCustomWallpapers(paths: string[]): WallpaperItem[] {
    const seen = new Set<string>();
    const items: WallpaperItem[] = [];

    for (const customPath of paths) {
        const item = createCustomWallpaperItem(customPath);
        if (!item || seen.has(item.id)) {
            continue;
        }
        seen.add(item.id);
        items.push(item);
    }

    return items;
}

export function getCustomWallpaperById(id: string, configuredPaths: string[] = []): WallpaperItem | undefined {
    const decodedPath = decodeWallpaperPath(id);
    if (decodedPath) {
        const item = createCustomWallpaperItem(decodedPath);
        if (item) {
            return item;
        }
    }

    return scanCustomWallpapers(configuredPaths).find(item => item.id === id);
}
