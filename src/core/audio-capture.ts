// System (speaker) audio capture via WASAPI loopback.
//
// Wallpaper Engine web wallpapers react to a 128-value frequency array
// (`wallpaperRegisterAudioListener`, first 64 = left channel, last 64 = right).
// The browser getDisplayMedia/getUserMedia paths don't reliably work inside VS Code's
// Electron (no main-process display-media handler; mic is useless with headphones), so we
// capture the real render/loopback stream here in the extension host, FFT it, and stream the
// resulting spectrum over the existing WebSocket to the wallpaper.
//
// The native `audify` module (RtAudio, N-API) is loaded lazily and defensively — a missing or
// incompatible binary must never crash activation; callers fall back to the simulated spectrum.

// audify ships TypeScript definitions; `typeof import(...)` gives us the types without a static
// runtime import so the require stays lazy and swallowable.
type AudifyModule = typeof import('audify');

let audifyModule: AudifyModule | null | undefined;

function loadAudify(): AudifyModule | null {
    if (audifyModule !== undefined) {
        return audifyModule;
    }
    try {
        audifyModule = require('audify') as AudifyModule;
    } catch (error) {
        console.warn('[WP audio] audify native module unavailable:', error);
        audifyModule = null;
    }
    return audifyModule;
}

const FFT_SIZE = 1024;          // samples per channel per callback
const BINS_PER_CHANNEL = 64;    // Wallpaper Engine spec
const GAIN = 6;                 // magnitude -> 0..1-ish scaling
const MAX_VALUE = 1.4;          // soft clamp
const RISE = 1;                 // instantaneous rise
const FALL = 0.82;             // exponential decay for smoother visuals

/** Precomputed Hann window. */
const WINDOW = (() => {
    const w = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
        w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }
    return w;
})();

/** Precomputed bit-reversal permutation for radix-2 FFT of size FFT_SIZE. */
const BIT_REV = (() => {
    const bits = Math.log2(FFT_SIZE);
    const rev = new Uint32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
        let x = i;
        let r = 0;
        for (let b = 0; b < bits; b++) {
            r = (r << 1) | (x & 1);
            x >>= 1;
        }
        rev[i] = r;
    }
    return rev;
})();

/** Precomputed log-spaced bin edges mapping FFT bins (1..FFT_SIZE/2) onto 64 output bins. */
const BIN_EDGES = (() => {
    const half = FFT_SIZE / 2;
    const edges = new Uint32Array(BINS_PER_CHANNEL + 1);
    for (let b = 0; b <= BINS_PER_CHANNEL; b++) {
        edges[b] = Math.min(half, Math.max(1, Math.floor(Math.pow(half, b / BINS_PER_CHANNEL))));
    }
    return edges;
})();

/** In-place iterative radix-2 Cooley–Tukey FFT (re/im are length FFT_SIZE). */
function fft(re: Float64Array, im: Float64Array): void {
    const n = FFT_SIZE;
    for (let i = 0; i < n; i++) {
        const j = BIT_REV[i];
        if (j > i) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const ang = (-2 * Math.PI) / len;
        const wRe = Math.cos(ang);
        const wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curRe = 1;
            let curIm = 0;
            for (let k = 0; k < half; k++) {
                const a = i + k;
                const b = a + half;
                const tRe = re[b] * curRe - im[b] * curIm;
                const tIm = re[b] * curIm + im[b] * curRe;
                re[b] = re[a] - tRe;
                im[b] = im[a] - tIm;
                re[a] += tRe;
                im[a] += tIm;
                const nextRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nextRe;
            }
        }
    }
}

export type SpectrumListener = (spectrum: number[]) => void;

export class SystemAudioCapture {
    private rtAudio: import('audify').RtAudio | null = null;
    private active = false;
    private readonly reBuf = new Float64Array(FFT_SIZE);
    private readonly imBuf = new Float64Array(FFT_SIZE);
    private readonly left = new Float64Array(FFT_SIZE);
    private readonly right = new Float64Array(FFT_SIZE);
    private readonly smoothed = new Float64Array(BINS_PER_CHANNEL * 2);

    public isActive(): boolean {
        return this.active;
    }

    /**
     * Start capturing the default output device's loopback stream. Returns false if the native
     * module is unavailable or the stream can't be opened (caller should fall back).
     */
    public start(onSpectrum: SpectrumListener): boolean {
        if (this.active) {
            return true;
        }
        const audify = loadAudify();
        if (!audify) {
            return false;
        }
        try {
            const { RtAudio, RtAudioApi, RtAudioFormat } = audify;
            const rt = new RtAudio(process.platform === 'win32' ? RtAudioApi.WINDOWS_WASAPI : undefined);

            const deviceId = rt.getDefaultOutputDevice();
            const devices = rt.getDevices();
            const device = devices.find(d => d.id === deviceId) || devices.find(d => d.isDefaultOutput);
            const channels = Math.min(2, Math.max(1, device?.outputChannels || 2));
            const sampleRate = device?.preferredSampleRate || 48000;

            rt.openStream(
                null,
                { deviceId, nChannels: channels, firstChannel: 0 },
                RtAudioFormat.RTAUDIO_FLOAT32,
                sampleRate,
                FFT_SIZE,
                'vscode-wallpaper-loopback',
                (pcm: Buffer) => this.onPcm(pcm, channels, onSpectrum),
                null
            );
            rt.start();

            this.rtAudio = rt;
            this.active = true;
            console.log(`[WP audio] WASAPI loopback started (device ${deviceId}, ${channels}ch @ ${sampleRate}Hz)`);
            return true;
        } catch (error) {
            console.warn('[WP audio] Failed to start loopback capture:', error);
            this.safeClose();
            return false;
        }
    }

    public stop(): void {
        this.safeClose();
        this.smoothed.fill(0);
    }

    private safeClose(): void {
        this.active = false;
        const rt = this.rtAudio;
        this.rtAudio = null;
        if (!rt) {
            return;
        }
        try {
            if (rt.isStreamRunning()) { rt.stop(); }
            if (rt.isStreamOpen()) { rt.closeStream(); }
        } catch (error) {
            console.warn('[WP audio] Error closing loopback stream:', error);
        }
    }

    /** Deinterleave float32 PCM, FFT each channel, emit a 128-value smoothed spectrum. */
    private onPcm(pcm: Buffer, channels: number, onSpectrum: SpectrumListener): void {
        try {
            const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
            const frames = Math.min(FFT_SIZE, Math.floor(samples.length / channels));

            for (let i = 0; i < FFT_SIZE; i++) {
                if (i < frames) {
                    const base = i * channels;
                    this.left[i] = samples[base];
                    this.right[i] = channels > 1 ? samples[base + 1] : samples[base];
                } else {
                    this.left[i] = 0;
                    this.right[i] = 0;
                }
            }

            const spectrum = new Array<number>(BINS_PER_CHANNEL * 2);
            this.channelSpectrum(this.left, spectrum, 0);
            this.channelSpectrum(this.right, spectrum, BINS_PER_CHANNEL);
            onSpectrum(spectrum);
        } catch (error) {
            console.warn('[WP audio] PCM processing error:', error);
        }
    }

    private channelSpectrum(channel: Float64Array, out: number[], offset: number): void {
        for (let i = 0; i < FFT_SIZE; i++) {
            this.reBuf[i] = channel[i] * WINDOW[i];
            this.imBuf[i] = 0;
        }
        fft(this.reBuf, this.imBuf);

        for (let b = 0; b < BINS_PER_CHANNEL; b++) {
            const lo = BIN_EDGES[b];
            const hi = Math.max(lo + 1, BIN_EDGES[b + 1]);
            let sum = 0;
            for (let k = lo; k < hi; k++) {
                sum += Math.sqrt(this.reBuf[k] * this.reBuf[k] + this.imBuf[k] * this.imBuf[k]);
            }
            const mag = (sum / (hi - lo)) / FFT_SIZE;
            const value = Math.min(MAX_VALUE, mag * GAIN);

            const idx = offset + b;
            const prev = this.smoothed[idx];
            this.smoothed[idx] = value > prev ? value * RISE : prev * FALL + value * (1 - FALL);
            out[idx] = this.smoothed[idx];
        }
    }
}
