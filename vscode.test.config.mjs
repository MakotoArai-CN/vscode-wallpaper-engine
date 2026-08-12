import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'out/test/**/*.test.js',
    version: '1.106.1',
    workspaceFolder: '.',
    mocha: {
        ui: 'tdd',
        timeout: 20000
    }
});
