// Renders every scene in scripts/scenes.mjs through REAL Skia and writes
// PNGs, without a simulator.
//
// It runs the library's own engine and painter (src/engine.ts,
// src/painter.ts) against react-native-skia's web API, which is the same
// Skia API surface backed by CanvasKit (the WASM build of the engine
// react-native-skia wraps). So these are the exact draw calls the
// component makes on a device, rasterised by Skia.
//
//   node scripts/render.mjs [outDir]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { DPR, SETTLE_SECONDS } from './scenes.mjs';
const { scenes } = await import(process.env.SCENES ? new URL(process.env.SCENES, 'file://' + process.cwd() + '/').href : './scenes.mjs');

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(process.argv[2] ?? resolve(root, 'renders/native'));
mkdirSync(outDir, { recursive: true });

/** Bundle the library's engine and painter for Node. */
export async function loadGlow() {
  const result = await esbuild.build({
    stdin: {
      contents: `
        export { resolveGlowConfig } from './src/config';
        export { createEngineState, createFrame, stepGlow } from './src/engine';
        export { paintGlow } from './src/painter';
      `,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

/** react-native-skia's API, backed by CanvasKit. */
export async function loadSkia() {
  const CanvasKitInit = require('canvaskit-wasm');
  const CanvasKit = await CanvasKitInit({ locateFile: (f) => require.resolve(`canvaskit-wasm/bin/${f}`) });
  const { JsiSkApi } = require('@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia.js');
  return { Skia: JsiSkApi(CanvasKit), CanvasKit };
}

function hexColor(Skia, hex) {
  return Skia.Color(hex);
}

/** Render one scene after `seconds` of a constant level. */
export function renderScene(glow, Skia, scene, seconds = SETTLE_SECONDS, dpr = DPR, pin = null) {
  const { resolveGlowConfig, createEngineState, createFrame, stepGlow, paintGlow } = glow;
  const theme = scene.props.theme === 'light' ? 'light' : 'dark';
  const cfg = resolveGlowConfig(scene.props, { theme, reducedMotion: false, radius: scene.radius, version: 1 });
  const state = createEngineState();
  const frame = createFrame();
  const input = { kind: 0, level: scene.level, low: 0, mid: 0, high: 0 };
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) stepGlow(state, frame, cfg, input, null, 1 / 60, scene.w, scene.h);
  // Paint at the same instant of the distortion's drift as the reference, when known.
  if (pin && pin.displace != null) {
    frame.noiseDx = pin.noiseDx;
    frame.noiseDy = pin.noiseDy;
    frame.displace = pin.displace;
  }

  const surface = Skia.Surface.Make(Math.round(scene.w * dpr), Math.round(scene.h * dpr));
  const canvas = surface.getCanvas();
  canvas.scale(dpr, dpr);
  canvas.clear(hexColor(Skia, scene.page));
  const bg = Skia.Paint();
  bg.setColor(hexColor(Skia, scene.bg));
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, scene.w, scene.h), scene.radius, scene.radius), bg);
  const scratch = new Array(2 * 57).fill(0);
  const t0 = performance.now();
  paintGlow(Skia, canvas, cfg, frame, scene.w, scene.h, scratch);
  surface.flush();
  const paintMs = performance.now() - t0;
  const png = surface.makeImageSnapshot().encodeToBytes();
  return { png, paintMs, frame, state };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const glow = await loadGlow();
  const { Skia } = await loadSkia();
  const metaPath = resolve(root, 'renders/web/meta.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  for (const scene of scenes) {
    const { png, paintMs } = renderScene(glow, Skia, scene, SETTLE_SECONDS, DPR, meta[scene.name]);
    writeFileSync(resolve(outDir, `${scene.name}.png`), png);
    console.log(`${scene.name.padEnd(28)} ${paintMs.toFixed(1)} ms (CPU raster)`);
  }
  console.log(`Wrote ${scenes.length} renders to ${outDir}`);
}
