// Checks src/analyser.ts against the browser's own AnalyserNode.
//
// A voice-like test signal (a gliding fundamental with harmonics, formant
// bumps, breath noise and syllable-rate amplitude) is played through an
// AnalyserNode in Chromium's OfflineAudioContext, read every 16 ms, and the
// same signal is fed to VoiceAnalyser at the same instants. The RMS and the
// three band readings the glow uses must agree.
//
//   CHROMIUM_PATH=/path/to/chrome node scripts/reference/analyser-parity.mjs

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const SAMPLE_RATE = 48000;
const SECONDS = 3;
const HOP = 768; // 6 render quanta = 16 ms
const N = SAMPLE_RATE * SECONDS;

function makeSignal() {
  const x = new Float32Array(N);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  let phase = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SAMPLE_RATE;
    const f0 = 140 + 40 * Math.sin(2 * Math.PI * 0.7 * t);
    phase += (2 * Math.PI * f0) / SAMPLE_RATE;
    let v = 0;
    for (let h = 1; h <= 30; h++) {
      const f = f0 * h;
      // Formant bumps near 700 Hz, 1200 Hz and 2600 Hz.
      const g =
        Math.exp(-(((f - 700) / 250) ** 2)) + 0.7 * Math.exp(-(((f - 1200) / 300) ** 2)) + 0.4 * Math.exp(-(((f - 2600) / 400) ** 2));
      v += (g + 0.05) * Math.sin(phase * h) / h;
    }
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 3.2 * t)) ** 0.7;
    x[i] = 0.18 * syllable * v + 0.01 * rand();
  }
  return x;
}

const signal = makeSignal();

// ── Ours ──────────────────────────────────────────────────────────────────
const built = await esbuild.build({ entryPoints: [resolve(root, 'src/analyser.ts')], bundle: true, write: false, format: 'cjs', platform: 'node' });
const mod = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require);
const { VoiceAnalyser } = mod.exports;
const ours = [];
{
  // A hop longer than the signal, so process() only fills the ring and the
  // analyses happen exactly at the instants the browser is read.
  const a = new VoiceAnalyser();
  const feed = (from, to) => a.process(signal.subarray(from, to), Number.MAX_SAFE_INTEGER);
  for (let at = HOP; at <= N; at += HOP) {
    feed(at - HOP, at);
    ours.push(a.analyse(SAMPLE_RATE));
  }
}

// ── The browser's ─────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
const theirs = await page.evaluate(
  async ({ data, sampleRate, hop }) => {
    const n = data.length;
    const ctx = new OfflineAudioContext(1, n, sampleRate);
    const buf = ctx.createBuffer(1, n, sampleRate);
    buf.copyToChannel(Float32Array.from(data), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.5;
    src.connect(an);
    an.connect(ctx.destination);
    const time = new Float32Array(an.fftSize);
    const freq = new Uint8Array(an.frequencyBinCount);
    const bands = [
      [80, 300],
      [300, 2000],
      [2000, 6000],
    ];
    const out = [];
    for (let at = hop; at < n; at += hop) {
      ctx.suspend(at / sampleRate).then(() => {
        an.getFloatTimeDomainData(time);
        let s = 0;
        for (let i = 0; i < time.length; i++) s += time[i] * time[i];
        an.getByteFrequencyData(freq);
        const binHz = sampleRate / an.fftSize;
        const r = { rms: Math.sqrt(s / time.length) };
        ['low', 'mid', 'high'].forEach((k, b) => {
          const from = Math.max(0, Math.floor(bands[b][0] / binHz));
          const to = Math.min(freq.length - 1, Math.ceil(bands[b][1] / binHz));
          let acc = 0;
          for (let i = from; i <= to; i++) acc += freq[i];
          r[k] = acc / (to - from + 1) / 255;
        });
        out.push(r);
        ctx.resume();
      });
    }
    src.start(0);
    await ctx.startRendering();
    return out;
  },
  { data: Array.from(signal), sampleRate: SAMPLE_RATE, hop: HOP }
);
await browser.close();

// ── Compare ───────────────────────────────────────────────────────────────
const count = Math.min(ours.length, theirs.length);
const err = { rms: 0, low: 0, mid: 0, high: 0 };
const max = { rms: 0, low: 0, mid: 0, high: 0 };
for (let i = 0; i < count; i++) {
  for (const k of Object.keys(err)) {
    const d = Math.abs(ours[i][k] - theirs[i][k]);
    err[k] += d / count;
    max[k] = Math.max(max[k], d);
  }
}
console.log(`${count} readings compared`);
for (const k of Object.keys(err)) console.log(`${k.padEnd(5)} mean |Δ| ${err[k].toFixed(5)}   max |Δ| ${max[k].toFixed(5)}`);
const ok = Object.keys(err).every((k) => err[k] < 0.005 && max[k] < 0.03);
console.log(ok ? 'PASS: matches the browser AnalyserNode' : 'FAIL');
process.exit(ok ? 0 : 1);
