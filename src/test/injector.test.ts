import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveWorkbenchPaths } from '../core/injector';

suite('Injector Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-injector-test-'));
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Failed to clean up temp dir:', e);
        }
    });

    function writeAppFile(relativePath: string) {
        const filePath = path.join(tempDir, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '');
        return path.normalize(filePath);
    }

    test('resolveWorkbenchPaths should discover VS Code workbench files outside hard-coded paths', () => {
        const htmlPath = writeAppFile('out/vs/custom/electron/workbench/workbench.html');
        const mainJsPath = writeAppFile('out/vs/custom/workbench/workbench.desktop.main.js');
        const loaderJsPath = writeAppFile('out/vs/custom/electron/workbench/workbench.js');
        const sessionsJsPath = writeAppFile('out/vs/custom/sessions/sessions.desktop.main.js');

        const paths = resolveWorkbenchPaths(tempDir);

        assert.ok(paths.htmlPaths.map(path.normalize).includes(htmlPath));
        assert.ok(paths.mainJsPaths.map(path.normalize).includes(mainJsPath));
        assert.ok(paths.loaderJsPaths.map(path.normalize).includes(loaderJsPath));
        assert.ok(paths.integrityPatchJsPaths.map(path.normalize).includes(mainJsPath));
        assert.ok(paths.integrityPatchJsPaths.map(path.normalize).includes(sessionsJsPath));
    });

    test('resolveWorkbenchPaths should support the VS Code 1.132 stable layout', () => {
        const htmlPath = writeAppFile('out/vs/code/electron-browser/workbench/workbench.html');
        const loaderJsPath = writeAppFile('out/vs/code/electron-browser/workbench/workbench.js');
        const mainJsPath = writeAppFile('out/vs/workbench/workbench.desktop.main.js');
        const sessionsJsPath = writeAppFile('out/vs/sessions/sessions.desktop.main.js');

        const paths = resolveWorkbenchPaths(tempDir);

        assert.ok(paths.htmlPaths.map(path.normalize).includes(htmlPath));
        assert.ok(paths.loaderJsPaths.map(path.normalize).includes(loaderJsPath));
        assert.ok(paths.mainJsPaths.map(path.normalize).includes(mainJsPath));
        assert.ok(paths.integrityPatchJsPaths.map(path.normalize).includes(mainJsPath));
        assert.ok(paths.integrityPatchJsPaths.map(path.normalize).includes(sessionsJsPath));
    });
});
