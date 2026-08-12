import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectWallpaperEngineWorkshopPath, parseSteamLibraryFoldersVdf } from '../core/workshop-detector';

suite('Workshop Detector Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-wallpaper-detector-test-'));
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Failed to clean up temp dir:', e);
        }
    });

    function createWallpaperLibrary(libraryPath: string) {
        const wallpaperPath = path.join(libraryPath, 'steamapps', 'workshop', 'content', '431960');
        const wallpaperDir = path.join(wallpaperPath, '12345');
        fs.mkdirSync(wallpaperDir, { recursive: true });
        fs.writeFileSync(path.join(wallpaperDir, 'project.json'), JSON.stringify({
            title: 'Detected Wallpaper',
            file: 'index.html',
            type: 'web'
        }));
        return wallpaperPath;
    }

    test('parseSteamLibraryFoldersVdf should read new and legacy library formats', () => {
        const content = `
"libraryfolders"
{
    "0"
    {
        "path" "C:\\\\Program Files (x86)\\\\Steam"
    }
    "1" "D:\\\\SteamLibrary"
}`;

        const libraries = parseSteamLibraryFoldersVdf(content);
        const portableLibraries = libraries.map(item => item.replace(/\\/g, '/'));
        assert.ok(portableLibraries.some(item => item.endsWith('Program Files (x86)/Steam')));
        assert.ok(portableLibraries.some(item => item.endsWith('SteamLibrary')));
    });

    test('detectWallpaperEngineWorkshopPath should resolve libraries from libraryfolders.vdf', async () => {
        const steamRoot = path.join(tempDir, 'Steam');
        const libraryRoot = path.join(tempDir, 'SteamLibrary');
        const expectedPath = createWallpaperLibrary(libraryRoot);
        fs.mkdirSync(path.join(steamRoot, 'steamapps'), { recursive: true });
        fs.writeFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), `
"libraryfolders"
{
    "0"
    {
        "path" "${libraryRoot.replace(/\\/g, '\\\\')}"
        "apps"
        {
            "431960" "1"
        }
    }
}`);

        const result = await detectWallpaperEngineWorkshopPath({
            steamRoots: [steamRoot],
            env: {},
            homeDir: tempDir,
            includeDriveSearch: false
        });

        assert.strictEqual(path.normalize(result.path || ''), path.normalize(expectedPath));
    });

    test('detectWallpaperEngineWorkshopPath should normalize a configured Steam library root', async () => {
        const libraryRoot = path.join(tempDir, 'SteamLibrary');
        const expectedPath = createWallpaperLibrary(libraryRoot);

        const result = await detectWallpaperEngineWorkshopPath({
            configuredPath: libraryRoot,
            env: {},
            homeDir: tempDir,
            includeDriveSearch: false
        });

        assert.strictEqual(path.normalize(result.path || ''), path.normalize(expectedPath));
    });
});
