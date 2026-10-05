// Fast tests that need no simulator and no browser:
//
// - parity: every scene is painted by the library's own engine and painter
//   through real Skia (CanvasKit) and compared, pixel by pixel, against the
//   original web component's render of the same scene (test/golden, made by
//   scripts/reference/render-reference.mjs in headless Chromium);
// - engine: the envelope, fades and reduced-motion behave as specified;
// - analyser: the JS analyser reads a pure tone in the right band.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';
import { scenes, SETTLE_SECONDS, DPR } from '../scripts/scenes.mjs';
import { loadGlow, loadSkia, renderScene } from '../scripts/render.mjs';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const golden = resolve(root, 'test/golden');
const meta = JSON.parse(readFileSync(resolve(golden, 'meta.json'), 'utf8'));

const glow = await loadGlow();
const { Skia } = await loadSkia();

function diff(pngA, pngB) {
  const a = PNG.sync.read(pngA);
  const b = PNG.sync.read(pngB);
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  const errs = new Uint8Array(a.width * a.height);
  let sum = 0;
  for (let i = 0; i < errs.length; i++) {
    let e = 0;
    for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]));
    errs[i] = e;
    sum += e;
  }
  errs.sort();
  return { mean: sum / errs.length, p99: errs[Math.floor(errs.length * 0.99)] };
}

for (const scene of scenes) {
  test(`parity with the web component: ${scene.name}`, () => {
    const { png } = renderScene(glow, Skia, scene, SETTLE_SECONDS, DPR, meta[scene.name]);
    const { mean, p99 } = diff(Buffer.from(png), readFileSync(resolve(golden, `${scene.name}.png`)));
    assert.ok(mean < 3, `mean channel error ${mean.toFixed(2)} ≥ 3`);
    assert.ok(p99 <= 8, `99th percentile channel error ${p99} > 8`);
  });
}

const { resolveGlowConfig, createEngineState, createFrame, stepGlow } = glow;
const cfgFor = (props = {}, opts = {}) =>
  resolveGlowConfig(props, { theme: 'dark', reducedMotion: false, radius: 20, version: 1, ...opts });
const run = (cfg, input, seconds, s = createEngineState(), f = createFrame()) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const e = stepGlow(s, f, cfg, input, null, 1 / 60, 360, 96);
    if (e) events.push({ e, t: (i + 1) / 60 });
  }
  return { s, f, events };
};

test('engine: the attack follows its time constant', () => {
  const cfg = cfgFor({ idle: 0 });
  const { s } = run(cfg, { kind: 0, level: 1, low: 0, mid: 0, high: 0 }, cfg.attack);
  // One time constant of a one-pole follower toward shape(1) = 1.
  assert.ok(Math.abs(s.level - (1 - Math.exp(-1))) < 0.03, `level ${s.level}`);
});

test('engine: a quiet input below the noise gate stays silent', () => {
  const { s } = run(cfgFor(), { kind: 0, level: 0.01, low: 0, mid: 0, high: 0 }, 2);
  assert.equal(s.level, 0);
});

test('engine: fades in over 0.6 s and out over 0.5 s, reporting each', () => {
  const s = createEngineState();
  const f = createFrame();
  const quiet = { kind: 0, level: 0, low: 0, mid: 0, high: 0 };
  const a = run(cfgFor({ active: true }), quiet, 1, s, f);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0].e, 1);
  assert.ok(Math.abs(a.events[0].t - 0.6) < 0.02);
  assert.equal(f.opacity, 1);
  const b = run(cfgFor({ active: false }), quiet, 1, s, f);
  assert.equal(b.events[0].e, 2);
  assert.ok(Math.abs(b.events[0].t - 0.5) < 0.02);
  assert.equal(f.opacity, 0);
});

test('engine: reduced motion stops the flow, hue drift and distortion but keeps the voice', () => {
  const cfg = cfgFor({}, { reducedMotion: true });
  const { s, f } = run(cfg, { kind: 0, level: 0.8, low: 0, mid: 0, high: 0 }, 3);
  assert.equal(s.phase, 0);
  assert.equal(f.hue, 0);
  assert.equal(f.displace, 0);
  assert.ok(f.level > 0.8);
});

test('engine: an analysed spectrum moves the lobes independently', () => {
  const cfg = cfgFor({ flow: 0, idle: 0 });
  const { s, f } = run(cfg, { kind: 2, level: 0.1, low: 0.6, mid: 0, high: 0.3 }, 3);
  assert.ok(s.b0 > 0.9 && s.b2 > 0.9 && s.b1 === 0, `bands ${s.b0} ${s.b1} ${s.b2}`);
  // Centre lobe follows the lows, its neighbours the mids, the outer pair the
  // highs (each also fades with its distance from the centre).
  assert.ok(f.lobeL[0] > f.lobeL[1] * 1.5, 'low band lifts the centre lobe well above the mids');
  assert.ok(f.lobeL[3] > f.lobeL[1], 'high band lifts the outer pair above the mids');
});

test('engine: paused holds the frame', () => {
  const cfg = cfgFor({ idle: 0 });
  const { s, f } = run(cfg, { kind: 0, level: 0.7, low: 0, mid: 0, high: 0 }, 2);
  const held = f.level;
  run({ ...cfg, paused: true }, { kind: 0, level: 0, low: 0, mid: 0, high: 0 }, 2, s, f);
  assert.equal(f.level, held);
});

test('analyser: a 1 kHz tone lands in the mid band, a 150 Hz tone in the low band', async () => {
  const built = await esbuild.build({ entryPoints: [resolve(root, 'src/analyser.ts')], bundle: true, write: false, format: 'cjs', platform: 'node' });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require);
  const { VoiceAnalyser } = mod.exports;
  const tone = (hz) => {
    const x = new Float32Array(48000);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / 48000);
    return x;
  };
  const mid = new VoiceAnalyser().process(tone(1000), 48000);
  assert.ok(mid.mid > mid.low && mid.mid > mid.high);
  assert.ok(Math.abs(mid.rms - 0.3 / Math.SQRT2) < 0.01);
  const low = new VoiceAnalyser().process(tone(150), 48000);
  assert.ok(low.low > low.mid && low.low > low.high);
});
