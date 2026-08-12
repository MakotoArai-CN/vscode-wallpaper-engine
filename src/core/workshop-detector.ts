import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const WALLPAPER_ENGINE_APP_ID = '431960';
const STEAMAPPS = 'steamapps';
const WORKSHOP_RELATIVE_PATH = path.join(STEAMAPPS, 'workshop', 'content', WALLPAPER_ENGINE_APP_ID);

export interface WorkshopDetectionCandidate {
    workshopPath: string;
    libraryPath: string;
    source: string;
    hasWallpapers: boolean;
}

export interface WorkshopDetectionResult {
    path: string | undefined;
    candidates: WorkshopDetectionCandidate[];
}

export interface WorkshopDetectionOptions {
    configuredPath?: string;
    steamRoots?: string[];
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    includeDriveSearch?: boolean;
}

function isExistingDirectory(candidatePath: string | undefined): candidatePath is string {
    if (!candidatePath) { return false; }

    try {
        return fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory();
    } catch {
        return false;
    }
}

function uniquePaths(paths: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const candidatePath of paths) {
        if (!candidatePath) { continue; }
        const normalized = path.normalize(candidatePath);
        const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        if (seen.has(key)) { continue; }
        seen.add(key);
        result.push(normalized);
    }

    return result;
}

function unescapeVdfString(value: string): string {
    return value
        .replace(/\\\\/g, '\\')
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t');
}

export function parseSteamLibraryFoldersVdf(content: string): string[] {
    const paths: string[] = [];
    const pathRegex = /"path"\s*"((?:\\.|[^"\\])*)"/gi;
    const legacyPathRegex = /"\d+"\s*"((?:\\.|[^"\\])*)"/g;

    let match: RegExpExecArray | null;
    while ((match = pathRegex.exec(content))) {
        paths.push(unescapeVdfString(match[1]));
    }

    while ((match = legacyPathRegex.exec(content))) {
        paths.push(unescapeVdfString(match[1]));
    }

    return uniquePaths(paths);
}

function resolveWorkshopPathFromInput(candidatePath: string | undefined): string | undefined {
    if (!candidatePath) { return undefined; }

    const normalized = path.normalize(candidatePath);
    const directLooksLikeWorkshop = path.basename(normalized) === WALLPAPER_ENGINE_APP_ID
        && path.basename(path.dirname(normalized)).toLowerCase() === 'content';

    if (directLooksLikeWorkshop && isExistingDirectory(normalized)) {
        return normalized;
    }

    const asSteamLibrary = path.join(normalized, WORKSHOP_RELATIVE_PATH);
    if (isExistingDirectory(asSteamLibrary)) {
        return asSteamLibrary;
    }

    const asSteamApps = path.join(normalized, 'workshop', 'content', WALLPAPER_ENGINE_APP_ID);
    if (path.basename(normalized).toLowerCase() === STEAMAPPS && isExistingDirectory(asSteamApps)) {
        return asSteamApps;
    }

    const asWorkshop = path.join(normalized, 'content', WALLPAPER_ENGINE_APP_ID);
    if (path.basename(normalized).toLowerCase() === 'workshop' && isExistingDirectory(asWorkshop)) {
        return asWorkshop;
    }

    return undefined;
}

export function isUsableWallpaperWorkshopPath(candidatePath: string | undefined): boolean {
    return resolveWorkshopPathFromInput(candidatePath) === path.normalize(candidatePath || '');
}

function hasWallpaperProjects(workshopPath: string): boolean {
    try {
        const entries = fs.readdirSync(workshopPath, { withFileTypes: true });
        for (const entry of entries.slice(0, 500)) {
            if (entry.isDirectory() && fs.existsSync(path.join(workshopPath, entry.name, 'project.json'))) {
                return true;
            }
        }
    } catch {
        return false;
    }

    return false;
}

function getDefaultSteamRoots(env: NodeJS.ProcessEnv, homeDir: string): string[] {
    const roots: Array<string | undefined> = [];

    roots.push(env.STEAM_PATH, env.STEAM_HOME);

    if (process.platform === 'win32') {
        roots.push(
            env.ProgramFiles ? path.join(env.ProgramFiles, 'Steam') : undefined,
            env['ProgramFiles(x86)'] ? path.join(env['ProgramFiles(x86)'], 'Steam') : undefined,
            env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Steam') : undefined,
            'C:\\Program Files (x86)\\Steam',
            'C:\\Program Files\\Steam'
        );
    } else if (process.platform === 'darwin') {
        roots.push(path.join(homeDir, 'Library', 'Application Support', 'Steam'));
    } else {
        roots.push(
            path.join(homeDir, '.steam', 'steam'),
            path.join(homeDir, '.local', 'share', 'Steam'),
            path.join(homeDir, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')
        );
    }

    return uniquePaths(roots);
}

async function getWindowsRegistrySteamRoots(): Promise<string[]> {
    if (process.platform !== 'win32') {
        return [];
    }

    const queries: Array<[string, string]> = [
        ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
        ['HKCU\\Software\\Valve\\Steam', 'SteamExe'],
        ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
        ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath']
    ];
    const roots: string[] = [];

    for (const [key, value] of queries) {
        try {
            const { stdout } = await execFileAsync('reg', ['query', key, '/v', value], {
                windowsHide: true,
                timeout: 1500
            });
            const line = stdout.split(/\r?\n/).find(item => item.includes(value) && item.includes('REG_'));
            const match = line?.match(/REG_\w+\s+(.+)$/);
            if (!match) { continue; }

            const registryValue = match[1].trim();
            roots.push(value.toLowerCase().includes('exe') ? path.dirname(registryValue) : registryValue);
        } catch {
            continue;
        }
    }

    return uniquePaths(roots);
}

function getDriveSearchRoots(): string[] {
    if (process.platform !== 'win32') {
        return [];
    }

    const roots: string[] = [];
    for (let code = 67; code <= 90; code++) {
        const drive = `${String.fromCharCode(code)}:`;
        roots.push(
            path.join(`${drive}\\`, 'SteamLibrary'),
            path.join(`${drive}\\`, 'Steam'),
            path.join(`${drive}\\`, 'Games', 'SteamLibrary'),
            path.join(`${drive}\\`, 'Games', 'Steam'),
            path.join(`${drive}\\`, 'Program Files (x86)', 'Steam'),
            path.join(`${drive}\\`, 'Program Files', 'Steam')
        );
    }

    return roots;
}

function readLibraryFolders(steamRoot: string): string[] {
    const libraryFoldersPath = path.join(steamRoot, STEAMAPPS, 'libraryfolders.vdf');
    if (!fs.existsSync(libraryFoldersPath)) {
        return [];
    }

    try {
        return parseSteamLibraryFoldersVdf(fs.readFileSync(libraryFoldersPath, 'utf-8'));
    } catch {
        return [];
    }
}

function candidateFromPath(inputPath: string, source: string): WorkshopDetectionCandidate | undefined {
    const workshopPath = resolveWorkshopPathFromInput(inputPath);
    if (!workshopPath) {
        return undefined;
    }

    return {
        workshopPath,
        libraryPath: path.resolve(workshopPath, '..', '..', '..'),
        source,
        hasWallpapers: hasWallpaperProjects(workshopPath)
    };
}

function sortCandidates(candidates: WorkshopDetectionCandidate[]): WorkshopDetectionCandidate[] {
    const sourceScore = (source: string) => {
        if (source === 'configured') { return 4; }
        if (source === 'libraryfolders.vdf') { return 3; }
        if (source === 'registry') { return 2; }
        return 1;
    };

    return [...candidates].sort((a, b) => {
        if (a.hasWallpapers !== b.hasWallpapers) {
            return a.hasWallpapers ? -1 : 1;
        }

        return sourceScore(b.source) - sourceScore(a.source);
    });
}

export async function detectWallpaperEngineWorkshopPath(options: WorkshopDetectionOptions = {}): Promise<WorkshopDetectionResult> {
    const env = options.env || process.env;
    const homeDir = options.homeDir || os.homedir();
    const candidates: WorkshopDetectionCandidate[] = [];

    const addCandidate = (candidatePath: string | undefined, source: string) => {
        if (!candidatePath) { return; }
        const candidate = candidateFromPath(candidatePath, source);
        if (!candidate) { return; }
        const key = process.platform === 'win32' ? candidate.workshopPath.toLowerCase() : candidate.workshopPath;
        if (candidates.some(item => (process.platform === 'win32' ? item.workshopPath.toLowerCase() : item.workshopPath) === key)) {
            return;
        }
        candidates.push(candidate);
    };

    addCandidate(options.configuredPath, 'configured');

    const registryRoots = await getWindowsRegistrySteamRoots();
    const steamRoots = uniquePaths([
        ...(options.steamRoots || []),
        ...registryRoots,
        ...getDefaultSteamRoots(env, homeDir),
        ...(options.includeDriveSearch === false ? [] : getDriveSearchRoots())
    ]).filter(isExistingDirectory);

    for (const steamRoot of steamRoots) {
        addCandidate(steamRoot, registryRoots.includes(steamRoot) ? 'registry' : 'default');
        for (const libraryPath of readLibraryFolders(steamRoot)) {
            addCandidate(libraryPath, 'libraryfolders.vdf');
        }
    }

    const sortedCandidates = sortCandidates(candidates);
    return {
        path: sortedCandidates[0]?.workshopPath,
        candidates: sortedCandidates
    };
}
