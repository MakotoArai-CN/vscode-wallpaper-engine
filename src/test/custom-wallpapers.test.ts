import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createCustomWallpaperItem, getCustomWallpaperById, isCustomWallpaperId, scanCustomWallpapers } from '../core/custom-wallpapers';
import { WallpaperType } from '../core/types';

suite('Custom Wallpapers Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-custom-wallpaper-test-'));
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Failed to clean up temp dir:', e);
        }
    });

    test('createCustomWallpaperItem should support image files', () => {
        const imagePath = path.join(tempDir, 'background.png');
        fs.writeFileSync(imagePath, 'image');

        const item = createCustomWallpaperItem(imagePath);

        assert.ok(item);
        assert.strictEqual(item.type, WallpaperType.Image);
        assert.strictEqual(item.getMediaPath().path, imagePath);
        assert.ok(isCustomWallpaperId(item.id));
    });

    test('createCustomWallpaperItem should support directories with index.html', () => {
        const webDir = path.join(tempDir, 'web-background');
        fs.mkdirSync(webDir);
        fs.writeFileSync(path.join(webDir, 'index.html'), '<html></html>');

        const item = createCustomWallpaperItem(webDir);

        assert.ok(item);
        assert.strictEqual(item.type, WallpaperType.Web);
        assert.strictEqual(item.getMediaPath().path, path.join(webDir, 'index.html'));
    });

    test('getCustomWallpaperById should restore item from encoded id', () => {
        const videoPath = path.join(tempDir, 'loop.mp4');
        fs.writeFileSync(videoPath, 'video');
        const item = createCustomWallpaperItem(videoPath);

        assert.ok(item);
        const restored = getCustomWallpaperById(item.id);

        assert.ok(restored);
        assert.strictEqual(restored.getMediaPath().path, videoPath);
        assert.strictEqual(restored.type, WallpaperType.Video);
    });

    test('scanCustomWallpapers should skip invalid paths', () => {
        const imagePath = path.join(tempDir, 'background.jpg');
        fs.writeFileSync(imagePath, 'image');

        const items = scanCustomWallpapers([imagePath, path.join(tempDir, 'missing.txt')]);

        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].type, WallpaperType.Image);
    });
});
