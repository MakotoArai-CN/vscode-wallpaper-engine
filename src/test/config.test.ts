import * as assert from 'assert';
import { buildGlassCss, validateConfig } from '../config';

suite('Config Test Suite', () => {
    test('validateConfig should return false for empty path', () => {
        const config = { 
            workshopPath: '', 
            opacity: 0.5,
            serverPort: 23333,
            customJs: '',
            wallpaperId: '',
            resizeDelay: 500,
            startupCheckInterval: 300,
            transparentOpacity: 0.85,
            transparentCss: '',
            customCss: '',
            customWallpaperPaths: [],
            wallpaperFit: 'contain' as const,
            showUnsupportedWallpapers: false,
            audioSource: 'system' as const,
            interactionEnabled: true,
            adaptiveColors: {
                enabled: true,
                strength: 0.68,
                respectTransparency: true,
                navAlpha: 1,
                topAlpha: 1
            },
            glass: {
                enabled: true,
                preset: 'liquid' as const,
                tint: '#111827',
                opacity: 0.66,
                blur: 22,
                saturation: 1.55,
                borderOpacity: 0.34,
                shadowOpacity: 0.28
            }
        };
        const result = validateConfig(config);
        assert.strictEqual(result, false);
    });

    test('buildGlassCss should not target native Monaco menu layers', () => {
        const css = buildGlassCss({
            enabled: true,
            preset: 'liquid',
            tint: '#111827',
            opacity: 0.66,
            blur: 22,
            saturation: 1.55,
            borderOpacity: 0.34,
            shadowOpacity: 0.28
        });

        assert.ok(!css.includes('.context-view'));
        assert.ok(!css.includes('.monaco-menu-container'));
        assert.ok(!css.includes('.monaco-menu'));
        assert.ok(!css.includes('linear-gradient'));
        assert.ok(css.includes('.agent-host-chat'));
        assert.ok(css.includes('.agent-sessions-container'));
        assert.ok(css.includes('.part.auxiliarybar .pane.chat-viewpane-container'));
        assert.ok(css.includes('.chat-input-container .monaco-editor-background'));
        assert.ok(css.includes('.part.sidebar .monaco-list-rows'));
        assert.ok(css.includes('.part.auxiliarybar .monaco-list-rows'));
        assert.ok(css.includes('data-vwe-adaptive-colors'));
    });
});
