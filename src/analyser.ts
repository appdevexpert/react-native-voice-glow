/**
 * A Web Audio AnalyserNode in plain TypeScript, fed with PCM.
 *
 * The glow was tuned against the browser's AnalyserNode (fftSize 1024,
 * smoothingTimeConstant 0.5, the default -100…-30 dB range) read once per
 * animation frame. Native audio libraries hand over PCM buffers instead, at
 * whatever size and rate the platform picks, so this re-creates the
 * analyser exactly as the Web Audio spec defines it (Blackman window,
 * FFT, 1/N magnitude, smoothing, dB to byte) and runs it at 60 analyses
 * per second of audio, whatever the buffer size. The readings it returns
 * are what the web component would have read for the same sound.
 */

export interface VoiceAnalysis {
  /** RMS amplitude of the latest window, 0–1 full scale. */
  rms: number;
  /** Mean of the byte spectrum over 80–300 Hz, 300–2000 Hz and 2–6 kHz, each 0–1. */
  low: number;
  mid: number;
  high: number;
}

export interface VoiceAnalyserOptions {
  fftSize?: number;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
  /** Analyses per second of audio. */
  rate?: number;
}

/** Voice bands in Hz: fundamentals and chest, vowels and presence, sibilance. */
const BANDS: ReadonlyArray<readonly [number, number]> = [
  [80, 300],
  [300, 2000],
  [2000, 6000],
];

export class VoiceAnalyser {
  readonly fftSize: number;
  private readonly smoothing: number;
  private readonly minDb: number;
  private readonly maxDb: number;
  private readonly rate: number;
  /** Ring buffer of the most recent fftSize samples. */
  private readonly ring: Float32Array;
  private writeAt = 0;
  private filled = 0;
  /** Samples since the last analysis. */
  private sinceAnalysis = 0;
  private readonly window: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly smoothed: Float32Array;
  private readonly bytes: Uint8Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly rev: Uint32Array;

  constructor(options: VoiceAnalyserOptions = {}) {
    const n = options.fftSize ?? 1024;
    if (n < 32 || (n & (n - 1)) !== 0) throw new Error('fftSize must be a power of two ≥ 32');
    this.fftSize = n;
    this.smoothing = options.smoothingTimeConstant ?? 0.5;
    this.minDb = options.minDecibels ?? -100;
    this.maxDb = options.maxDecibels ?? -30;
    this.rate = options.rate ?? 60;
    this.ring = new Float32Array(n);
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
    this.smoothed = new Float32Array(n / 2);
    this.bytes = new Uint8Array(n / 2);
    // Blackman window, α = 0.16, as the Web Audio spec defines it.
    this.window = new Float32Array(n);
    const a0 = 0.42;
    const a1 = 0.5;
    const a2 = 0.08;
    for (let i = 0; i < n; i++) {
      this.window[i] = a0 - a1 * Math.cos((2 * Math.PI * i) / n) + a2 * Math.cos((4 * Math.PI * i) / n);
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** Forget everything heard so far. */
  reset(): void {
    this.ring.fill(0);
    this.smoothed.fill(0);
    this.writeAt = 0;
    this.filled = 0;
    this.sinceAnalysis = 0;
  }

  /**
   * Feed mono PCM samples (-1…1). Runs an analysis every 1/rate seconds of
   * audio and returns the mean of the analyses this buffer completed, or
   * null if it completed none (a buffer shorter than one hop).
   */
  process(samples: Float32Array, sampleRate: number): VoiceAnalysis | null {
    const hop = Math.max(1, Math.round(sampleRate / this.rate));
    let count = 0;
    let sumSq = 0;
    let low = 0;
    let mid = 0;
    let high = 0;
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.writeAt] = samples[i];
      this.writeAt = (this.writeAt + 1) % this.fftSize;
      if (this.filled < this.fftSize) this.filled++;
      this.sinceAnalysis++;
      if (this.sinceAnalysis >= hop) {
        this.sinceAnalysis = 0;
        const r = this.analyse(sampleRate);
        sumSq += r.rms * r.rms;
        low += r.low;
        mid += r.mid;
        high += r.high;
        count++;
      }
    }
    if (count === 0) return null;
    return { rms: Math.sqrt(sumSq / count), low: low / count, mid: mid / count, high: high / count };
  }

  /** One analysis of the latest fftSize samples (the AnalyserNode's getFloatTimeDomainData + getByteFrequencyData). */
  analyse(sampleRate: number): VoiceAnalysis {
    const n = this.fftSize;
    const { re, im, window: w, ring } = this;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = ring[(this.writeAt + i) % n];
      sumSq += v * v;
      const j = this.rev[i];
      re[j] = v * w[i];
      im[j] = 0;
    }
    // Iterative radix-2 FFT.
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step];
          const s = this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    const bins = n / 2;
    const k = this.smoothing;
    const range = this.maxDb - this.minDb;
    for (let i = 0; i < bins; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / n;
      const v = k * this.smoothed[i] + (1 - k) * mag;
      this.smoothed[i] = Number.isFinite(v) ? v : 0;
      const db = this.smoothed[i] > 0 ? 20 * Math.log10(this.smoothed[i]) : -Infinity;
      const scaled = Math.floor((255 / range) * (db - this.minDb));
      this.bytes[i] = scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
    }
    const binHz = sampleRate / n;
    const out = [0, 0, 0];
    for (let b = 0; b < 3; b++) {
      const [lo, hi] = BANDS[b];
      const from = Math.max(0, Math.floor(lo / binHz));
      const to = Math.min(bins - 1, Math.ceil(hi / binHz));
      let acc = 0;
      for (let i = from; i <= to; i++) acc += this.bytes[i];
      out[b] = to >= from ? acc / (to - from + 1) / 255 : 0;
    }
    return { rms: Math.sqrt(sumSq / n), low: out[0], mid: out[1], high: out[2] };
  }
}
