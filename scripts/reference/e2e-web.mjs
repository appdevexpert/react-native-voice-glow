// End-to-end check of the real component on React Native Web.
//
// Serves the example app's web export, opens each parity scene
// (`?scene=<name>`) in headless Chromium, and compares a screenshot of the
// live <VoiceGlow> (Reanimated frame loop, Skia picture, CanvasKit canvas)
// against the original web component's render in test/golden.
//
//   (cd example && npx expo export --platform web --output-dir dist-web)
//   CHROMIUM_PATH=/path/to/chrome node scripts/reference/e2e-web.mjs

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { scenes, DPR, SETTLE_SECONDS } from '../scenes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = resolve(root, 'example/dist-web');
const outDir = resolve(root, 'renders/e2e');
mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(dist, path === '/' ? 'index.html' : path);
  if (!existsSync(file)) file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--force-color-profile=srgb'] });
const results = [];
for (const scene of scenes.filter((s) => !s.name.includes('distortion'))) {
  const page = await browser.newPage({ deviceScaleFactor: DPR, viewport: { width: Math.max(640, scene.w + 40), height: Math.max(480, scene.h + 40) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?scene=${scene.name}`);
  await page.waitForSelector('#scene canvas', { timeout: 30000 });
  await page.waitForTimeout(SETTLE_SECONDS * 1000 + 500);
  const shot = await (await page.$('#scene')).screenshot();
  writeFileSync(resolve(outDir, `${scene.name}.png`), shot);
  const a = PNG.sync.read(shot);
  const b = PNG.sync.read(readFileSync(resolve(root, 'test/golden', `${scene.name}.png`)));
  let sum = 0;
  const errs = [];
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      let e = 0;
      for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(a.data[i + c] - b.data[j + c]));
      errs.push(e);
      sum += e;
    }
  }
  errs.sort((p, q) => p - q);
  results.push({
    scene: scene.name,
    size: `${a.width}x${a.height}`,
    mean: +(sum / errs.length).toFixed(2),
    p99: errs[Math.floor(errs.length * 0.99)],
    errors: errors.length,
  });
  await page.close();
}
await browser.close();
server.close();
console.table(results);
// The live canvas rasterises on the GPU (WebGL), the reference on the CPU,
// so allow a few levels of blur and antialiasing difference.
const ok = results.every((r) => r.mean < 4 && r.p99 <= 16 && r.errors === 0);
console.log(ok ? 'PASS: the live component matches the original web component' : 'FAIL');
process.exit(ok ? 0 : 1);
