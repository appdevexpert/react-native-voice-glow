// Renders every scene in scripts/scenes.mjs with the ORIGINAL web
// `voice-glow` component in headless Chromium and writes PNGs, so the
// React Native port can be compared against it pixel by pixel.
//
//   VOICE_GLOW_SRC=/path/to/Libraries.dev/packages/voice-glow \
//   CHROMIUM_PATH=/path/to/chrome \
//   node scripts/reference/render-reference.mjs [outDir]
//
// The original lives at https://github.com/Jakubantalik/Libraries.dev (MIT).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright-core';
import { DPR, SETTLE_SECONDS } from '../scenes.mjs';
const { scenes } = await import(process.env.SCENES ? new URL(process.env.SCENES, 'file://' + process.cwd() + '/').href : '../scenes.mjs');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = process.env.VOICE_GLOW_SRC;
if (!src) {
  console.error('Set VOICE_GLOW_SRC to the voice-glow package folder of a Libraries.dev checkout.');
  process.exit(1);
}
const outDir = resolve(process.argv[2] ?? resolve(root, 'renders/web'));
mkdirSync(outDir, { recursive: true });

// One page per scene, so a heavy scene (the SVG distortion runs in
// software here) cannot starve the others of frames.
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceBeam } from ${JSON.stringify(resolve(src, 'src/index.ts'))};
import { scenes } from ${JSON.stringify(process.env.SCENES ? resolve(process.cwd(), process.env.SCENES) : resolve(root, 'scripts/scenes.mjs'))};

const s = scenes.find((x) => x.name === window.__SCENE__);
createRoot(document.getElementById('root')).render(
  React.createElement('div', { style: { background: s.page, display: 'inline-block' } },
    React.createElement(VoiceBeam, { id: 'scene', level: () => s.level, ...s.props },
      React.createElement('div', { style: { width: s.w, height: s.h, borderRadius: s.radius, background: s.bg } }))));
`;

const result = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { __VOICE_SURFACE__: 'false', 'process.env.NODE_ENV': '"production"' },
  nodePaths: [resolve(root, 'node_modules')],
});
const bundle = result.outputFiles[0].text;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--force-color-profile=srgb'],
});

/** The driver's smoothed level, written on the wrapper every frame. */
const readLevel = (page) =>
  page.evaluate(() => {
    const m = document.getElementById('scene').getAttribute('style').match(/--vb-level-[^:]+:\s*([\d.]+)/);
    return m ? parseFloat(m[1]) : -1;
  });

const meta = {};
for (const s of scenes) {
  const page = await browser.newPage({ deviceScaleFactor: DPR, viewport: { width: Math.max(640, s.w + 40), height: Math.max(480, s.h + 40) } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000}</style></head>
<body><div id="root"></div><script>window.__SCENE__=${JSON.stringify(s.name)};</script><script>${bundle}</script></body></html>`;
  await page.setContent(html);
  await page.waitForTimeout(SETTLE_SECONDS * 1000);
  // Wait until the envelope has settled (slow software frames can stretch it).
  for (let i = 0; i < 40; i++) {
    const a = await readLevel(page);
    await page.waitForTimeout(400);
    const b = await readLevel(page);
    if (a >= 0 && Math.abs(a - b) < 0.0005) break;
  }
  // Freeze the driver, then record the distortion's per-frame state so the
  // native render can be painted at the same instant of the noise drift.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(150);
  meta[s.name] = await page.evaluate(() => {
    const off = document.querySelector('#scene feOffset');
    const disp = document.querySelector('#scene feDisplacementMap');
    const m = document.getElementById('scene').getAttribute('style').match(/--vb-level-[^:]+:\s*([\d.]+)/);
    return {
      level: m ? parseFloat(m[1]) : null,
      noiseDx: off ? off.dx.baseVal : null,
      noiseDy: off ? off.dy.baseVal : null,
      displace: disp ? disp.scale.baseVal : null,
    };
  });
  const el = await page.$('#scene');
  await el.screenshot({ path: resolve(outDir, `${s.name}.png`) });
  await page.close();
}
await browser.close();
writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`Wrote ${scenes.length} reference renders to ${outDir}`);
