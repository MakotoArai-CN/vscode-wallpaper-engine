export const MOCK_API_SCRIPT = `
(function() {
    console.log("[WE-Mock] Initializing Environment...");

    // ============================================================
    // 🛠️ Node.js / Electron 环境伪造 (Polyfill)
    // ============================================================
    
    // 1. Mock require
    window.require = function(moduleName) {
        console.log(\`[WE-Mock] ⚠️ Wallpaper tried to require('\${moduleName}')\`);
        
        if (moduleName === 'jquery') {
            if (window.jQuery) return window.jQuery;
            return window.$ || {};
        }
        if (moduleName === 'fs') {
            return {
                readFileSync: () => '',
                readFile: (path, cb) => cb(null, ''),
                existsSync: () => false,
                readdir: (path, cb) => {
                    // Use relative path, base tag handles the rest
                    fetch(\`/api/readdir?path=\${encodeURIComponent(path)}\`)
                        .then(r => r.json())
                        .then(files => cb && cb(null, files))
                        .catch(e => cb && cb(e));
                }
            };
        }
        if (moduleName === 'path') {
            return {
                join: (...args) => args.join('/'),
                resolve: (...args) => args.join('/')
            };
        }
        if (moduleName === 'electron') {
            return {
                ipcRenderer: {
                    on: () => {},
                    send: () => {},
                    removeListener: () => {}
                }
            };
        }
        return {};
    };

    // 2. Mock module/exports
    // [Smart Fix] Handle UMD libraries (like jQuery) that hide themselves if module.exports exists
    var _exports = {};
    window.module = {};
    Object.defineProperty(window.module, 'exports', {
        get: function() { return _exports; },
        set: function(v) {
            _exports = v;
            // Auto-expose jQuery if detected
            if (v && v.fn && v.fn.jquery) {
                console.log("[WE-Mock] Detected jQuery in module.exports, exposing globally.");
                window.jQuery = v;
                window.$ = v;
            }
        }
    });
    Object.defineProperty(window, 'exports', {
        get: function() { return window.module.exports; },
        set: function(v) { window.module.exports = v; }
    });

    // 3. Mock Smooth.js
    if (typeof window.Smooth === "undefined") {
        window.Smooth = function (arr, config) {
            return function (t) { return arr && arr.length > 0 ? arr[0] : 0; };
        };
        window.Smooth.METHOD_CUBIC = "cubic";
        window.Smooth.METHOD_LINEAR = "linear";
        window.Smooth.METHOD_NEAREST = "nearest";
    }

    // 4. Mock process
    window.process = {
        type: 'renderer',
        versions: { electron: 'mock', chrome: 'mock', node: 'mock' },
        platform: 'win32',
        env: { NODE_ENV: 'production' }
    };

    // 5. Mock global
    window.global = window;

    // ============================================================
    // 🎨 Wallpaper Engine API 模拟
    // ============================================================

    window.__WE_CALLBACKS__ = {
        properties: null,
        audio: null,
        general: null
    };

    Object.defineProperty(window, 'wallpaperPropertyListener', {
        set: function(l) {
            console.log("[WE-Mock] Property Listener Registered");
            window.__WE_CALLBACKS__.properties = l;
            window.__WE_CALLBACKS__.general = l;
        },
        get: function() { return window.__WE_CALLBACKS__.properties; }
    });

    window.wallpaperRegisterAudioListener = function(cb) {
        window.__WE_CALLBACKS__.audio = cb;
    };

    window.wallpaperRegisterMediaStatusListener = function() {};
    window.wallpaperRegisterMediaPropertiesListener = function() {};
    window.wallpaperRegisterMediaTimelineListener = function() {};
    
    window.wallpaperRequestRandomFileForProperty = function(propName, cb) {
        fetch(\`/api/random-file?prop=\${encodeURIComponent(propName)}\`)
            .then(r => r.json())
            .then(data => cb && cb(propName, data.file || null))
            .catch(e => cb && cb(propName, null));
    };

    // ============================================================
    // 📡 通信处理
    // ============================================================
    window.addEventListener('message', (e) => {
        if (!e.data) return;
        const { type, data } = e.data;
        const cbs = window.__WE_CALLBACKS__;

        if ((type === 'UPDATE_PROPERTIES' || type === 'PROPERTIES') && cbs.properties) {
            if (cbs.properties.applyUserProperties) {
                cbs.properties.applyUserProperties(data);
            }
        } 
        else if (type === 'AUDIO_TICK') {
            // Only honor externally pushed audio when explicitly in 'external' mode, so the
            // hidden workbench sidebar's zero-ticks can't overwrite locally-computed audio.
            if (audioSourceType === 'external' && cbs.audio) {
                cbs.audio(data);
            }
        }
        else if (type === 'UPDATE_GENERAL') {
            console.log('[WE-Mock] PostMessage General Update:', data);
            if (data.audioSource !== undefined) {
                setAudioSource(data.audioSource);
            }
            if (data.audioVolume !== undefined) {
                audioVolume = data.audioVolume;
            }
        }
        else if (type === 'WE_MOUSE') {
            dispatchWallpaperMouse(data);
        }
        else if (type === 'INIT_GENERAL' && cbs.general) {
            if (cbs.general.applyGeneralProperties) {
                cbs.general.applyGeneralProperties({ fps: 60, isActive: true });
            }
        }
    });

    // Fixes
    window.t = null;
    window.wt = null;

    // Intercept Image Src
    const originalImageSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (originalImageSrcDescriptor && originalImageSrcDescriptor.set) {
        Object.defineProperty(HTMLImageElement.prototype, "src", {
            set: function (val) {
                if (val === null || val === "null" || val === undefined || val === "undefined") return;
                originalImageSrcDescriptor.set.call(this, val);
            },
            get: originalImageSrcDescriptor.get,
        });
    }

    // [New] Intercept Media Src (Video/Audio)
    const originalMediaSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    if (originalMediaSrcDescriptor && originalMediaSrcDescriptor.set) {
        Object.defineProperty(HTMLMediaElement.prototype, "src", {
            set: function (val) {
                if (val === null || val === "null" || val === undefined || val === "undefined") return;
                originalMediaSrcDescriptor.set.call(this, val);
            },
            get: originalMediaSrcDescriptor.get,
        });
    }

    // [New] Intercept setAttribute to prevent "null"
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {
        if (name === 'src' && (val === null || val === 'null' || val === undefined || val === 'undefined')) {
            console.warn("[WE-Mock] Prevented setAttribute('src', null/undefined)", this);
            return;
        }
        return originalSetAttribute.call(this, name, val);
    };

    // [New] Intercept XMLHttpRequest for Proxy
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        if (typeof url === "string" && url.startsWith("http") && !url.includes(location.host)) {
            console.log(\`[WE-Mock] Proxying request: \${url}\`);
            url = \`/proxy?url=\${encodeURIComponent(url)}\`;
        }
        return originalOpen.call(this, method, url, ...args);
    };

    // [New] Intercept Video Play (Autoplay Fix)
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
        return originalPlay.call(this).catch((e) => {
            if (e.name === "NotAllowedError") {
                console.warn("[WE-Mock] Autoplay blocked, muting and retrying...");
                this.muted = true;
                return originalPlay.call(this);
            }
            throw e;
        });
    };

    // ============================================================
    // 🎵 Audio Simulation Logic
    // ============================================================
    let audioContext;
    let analyser;
    let dataArray;
    let micStream;
    let audioSourceType = 'off';
    let audioVolume = 50;
    let systemFallbackTimer;

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
            console.error("[WE-Mock] Mic Error:", e);
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
            console.error("[WE-Mock] System Audio Error:", e);
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

    // Switch the audio source that feeds wallpaperRegisterAudioListener.
    // 'system' = real speaker output captured by the extension via WASAPI loopback and pushed as
    // AUDIO_DATA (works with headphones). 'mic' captures the microphone. 'simulate'/'off' need no
    // stream. Capture failures fall back to 'simulate' so there's always visible feedback.
    function setAudioSource(src) {
        if (!src) { return; }
        console.log('[WE-Mock] setAudioSource ->', src);
        audioSourceType = src;
        clearTimeout(systemFallbackTimer);
        if (src === 'mic') {
            initMic();
        } else if (src === 'system') {
            stopAudio();
            // If no loopback data arrives shortly (non-Windows / no device / native module
            // missing), fall back to the simulated spectrum so the wallpaper still reacts.
            systemFallbackTimer = setTimeout(function() {
                if (audioSourceType === 'system') {
                    console.warn('[WE-Mock] No system loopback data; using simulate fallback.');
                    audioSourceType = 'simulate';
                }
            }, 2500);
        } else {
            stopAudio();
        }
    }

    function audioLoop() {
        if (audioSourceType === 'external') {
            requestAnimationFrame(audioLoop);
            return;
        }

        let audioData = new Array(64).fill(0);
        
        if (audioSourceType === 'simulate') {
            const t = Date.now() / 1000;
            for(let i=0; i<64; i++) {
                let v = Math.max(0, Math.sin(i*0.1 + t*10) * 0.8);
                v *= (1 - i/64);
                v += Math.random() * 0.2; 
                v *= (audioVolume / 100); // Apply volume
                audioData[i] = Math.min(1, v);
                audioData[i+64] = Math.min(1, v);
            }
        } else if ((audioSourceType === 'mic' || audioSourceType === 'system') && analyser) {
            analyser.getByteFrequencyData(dataArray);
            for (let i = 0; i < 64; i++) {
                if (i < dataArray.length) {
                    audioData[i] = (dataArray[i] / 255.0) * (audioVolume / 100);
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
        
        const cbs = window.__WE_CALLBACKS__;
        if (cbs.audio) {
            cbs.audio(finalData);
        }

        requestAnimationFrame(audioLoop);
    }
    audioLoop();

    // Apply the initial audio source from the server config (default: system).
    fetch('/config')
        .then(r => r.json())
        .then(cfg => { if (cfg && cfg.audioSource) { setAudioSource(cfg.audioSource); } })
        .catch(e => console.warn('[WE-Mock] Failed to read initial audio config:', e));

    // ============================================================
    // 🖱️ Mouse Interaction (Wallpaper Engine behaviour = native DOM events)
    // ============================================================
    // Wallpaper Engine has no dedicated mouse API; desktop wallpapers just receive real
    // cursor input as DOM events. The workbench captures the cursor (the iframe is
    // click-through) and forwards normalized coordinates here; we re-synthesize native-like
    // events so the wallpaper's own addEventListener('mousemove'|'click'|'wheel', ...) fire.
    function dispatchWallpaperMouse(d) {
        if (!d || !d.kind) { return; }
        try {
            const w = window.innerWidth || document.documentElement.clientWidth || 1;
            const h = window.innerHeight || document.documentElement.clientHeight || 1;
            const x = Math.round((d.nx || 0) * w);
            const y = Math.round((d.ny || 0) * h);
            const target = document.elementFromPoint(x, y) || document.body || document.documentElement;
            let evt;
            if (d.kind === 'wheel') {
                evt = new WheelEvent('wheel', {
                    bubbles: true, cancelable: true, view: window,
                    clientX: x, clientY: y, screenX: x, screenY: y,
                    deltaX: d.deltaX || 0, deltaY: d.deltaY || 0, deltaMode: 0
                });
            } else {
                evt = new MouseEvent(d.kind, {
                    bubbles: true, cancelable: true, view: window,
                    clientX: x, clientY: y, screenX: x, screenY: y,
                    button: d.button || 0, buttons: d.buttons || 0
                });
            }
            // bubbles:true propagates from the concrete target up through document to window,
            // so both canvas-local and window/document-global listeners receive the event.
            (target || window).dispatchEvent(evt);
        } catch (e) { /* ignore malformed mouse payloads */ }
    }

    // ============================================================
    // 🔌 WebSocket Connection (for Real-time Settings)
    // ============================================================
    (function() {
        try {
            let host = location.host;
            if (!host) {
                const base = document.querySelector('base');
                if (base && base.href) {
                    try {
                        host = new URL(base.href).host;
                    } catch (e) {}
                }
            }
            if (!host) host = '127.0.0.1:23333'; // Fallback

            const ws = new WebSocket('ws://' + host);
            ws.onopen = () => console.log('[WE-Mock] WebSocket Connected');
            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'UPDATE_PROPERTIES' || msg.type === 'PROPERTIES') {
                        console.log('[WE-Mock] WS Property Update:', msg.data);
                        const cbs = window.__WE_CALLBACKS__;
                        if (cbs.properties && cbs.properties.applyUserProperties) {
                            cbs.properties.applyUserProperties(msg.data);
                        }
                    } else if (msg.type === 'AUDIO_DATA') {
                        // Real system-loopback spectrum from the extension. Feed the wallpaper and
                        // keep the local generator idle (external); cancel the simulate fallback.
                        audioSourceType = 'external';
                        clearTimeout(systemFallbackTimer);
                        const audioCb = window.__WE_CALLBACKS__.audio;
                        if (audioCb) { audioCb(msg.data); }
                    } else if (msg.type === 'UPDATE_GENERAL') {
                        console.log('[WE-Mock] WS General Update:', msg.data);
                        if (msg.data.audioSource !== undefined) {
                            setAudioSource(msg.data.audioSource);
                        }
                        if (msg.data.audioVolume !== undefined) {
                            audioVolume = msg.data.audioVolume;
                        }
                        if (msg.data.interaction !== undefined) {
                            // Mouse forwarding lives in the workbench frame; relay the toggle up.
                            window.parent.postMessage({ type: 'WE_INTERACTION', enabled: !!msg.data.interaction }, '*');
                        }
                    }
                } catch (e) {
                    console.error('[WE-Mock] WS Message Error:', e);
                }
            };
        } catch (e) {
            console.error('[WE-Mock] WebSocket Init Error:', e);
        }
    })();
})();
`;

export const BOOTSTRAP_SCRIPT = `
(function() {
    console.log("[WE-Boot] Starting...");
    
    // 简单的帮助函数，用于转换 project.json 里的属性格式到 WE API 需要的格式
    function parseProperties(rawProps) {
        const result = {};
        for (const key in rawProps) {
            const prop = rawProps[key];
            let val = prop.value;
            if (val === undefined) val = prop.default;
            
            // Safe defaults
            if (val === undefined) {
                if (prop.type === 'color') val = "1 1 1";
                else if (prop.type === 'slider') val = 0;
                else if (prop.type === 'bool') val = false;
                else if (prop.type === 'text') val = "";
                else if (prop.type === 'combo') val = (prop.options && prop.options.length > 0) ? prop.options[0].value : "";
                else val = ""; // Fallback
            }

            // Wrap in value object as expected by WE
            result[key] = { value: val };
        }
        return result;
    }

    fetch('/project.json')
        .then(res => res.json())
        .then(data => {
            console.log("[WE-Boot] Loaded project.json", data);
            
            // 1. 发送通用设置 (FPS 等)
            window.postMessage({ type: 'INIT_GENERAL' }, '*');

            // 2. 发送属性
            if (data.general && data.general.properties) {
                const props = parseProperties(data.general.properties);
                console.log("[WE-Boot] Sending properties:", props);
                
                // 稍微延迟一下，确保 wallpaperPropertyListener 已经注册
                setTimeout(() => {
                    window.postMessage({ type: 'UPDATE_PROPERTIES', data: props }, '*');
                }, 500);
                
                // 再试一次，以防万一
                setTimeout(() => {
                    window.postMessage({ type: 'UPDATE_PROPERTIES', data: props }, '*');
                }, 2000);
            }
        })
        .catch(e => console.error("[WE-Boot] Failed to load project.json", e));
})();
`;
