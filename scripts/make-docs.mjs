// Renders the frames for the README animation through real Skia (the same
// engine and painter the component runs), driven by a synthetic voice.
//
//   node scripts/make-docs.mjs && python3 scripts/make-gif.py

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGlow, loadSkia } from './render.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'renders/frames');
mkdirSync(outDir, { recursive: true });

const { resolveGlowConfig, createEngineState, createFrame, stepGlow, paintGlow, createResources } = await loadGlow();
const { Skia } = await loadSkia();

const FPS = 30;
const SECONDS = 6;
const DPR = 2;

/** The example app's demo voice, as a function of time. */
function demoLevel(t) {
  const phrase = t % 4.2;
  if (phrase >= 2.8) return 0;
  const syllable = Math.pow(Math.max(0, Math.sin(2 * Math.PI * 3.6 * t)), 0.7);
  const stress = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.8 * t + 1.1);
  return 0.12 + 0.75 * syllable * stress;
}

const shots = [
  { name: 'chat', w: 360, h: 96, radius: 20, bg: '#1F1E25', page: '#15141A', props: { theme: 'dark' } },
  { name: 'phone', w: 300, h: 220, radius: 36, bg: '#1F1E25', page: '#15141A', props: { theme: 'dark', type: 'mobile' } },
];

for (const shot of shots) {
  const cfg = resolveGlowConfig(shot.props, { theme: 'dark', reducedMotion: false, radius: shot.radius, version: 1 });
  const state = createEngineState();
  const frame = createFrame();
  const scratch = new Array(114).fill(0);
  const res = createResources();
  // Let it fade in and settle first.
  for (let i = 0; i < 60; i++) stepGlow(state, frame, cfg, { kind: 0, level: 0, low: 0, mid: 0, high: 0 }, null, 1 / 60, shot.w, shot.h);
  const sub = 2; // engine steps per output frame (60 Hz engine, 30 fps output)
  for (let n = 0; n < FPS * SECONDS; n++) {
    for (let k = 0; k < sub; k++) {
      const t = (n * sub + k) / 60;
      stepGlow(state, frame, cfg, { kind: 0, level: demoLevel(t), low: 0, mid: 0, high: 0 }, null, 1 / 60, shot.w, shot.h);
    }
    const surface = Skia.Surface.Make(shot.w * DPR, shot.h * DPR);
    const canvas = surface.getCanvas();
    canvas.scale(DPR, DPR);
    canvas.clear(Skia.Color(shot.page));
    const bg = Skia.Paint();
    bg.setColor(Skia.Color(shot.bg));
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, shot.w, shot.h), shot.radius, shot.radius), bg);
    paintGlow(Skia, canvas, cfg, frame, shot.w, shot.h, scratch, res);
    surface.flush();
    writeFileSync(resolve(outDir, `${shot.name}-${String(n).padStart(4, '0')}.png`), surface.makeImageSnapshot().encodeToBytes());
  }
  console.log(`${shot.name}: ${FPS * SECONDS} frames`);
}
