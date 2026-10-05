// Compares renders/native against renders/web: per-scene mean and 99th
// percentile channel error, and a side-by-side strip (web | native |
// difference ×4) for looking at.
//
//   node scripts/compare.mjs [webDir] [nativeDir] [outDir]

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const { scenes } = await import(process.env.SCENES ? new URL(process.env.SCENES, 'file://' + process.cwd() + '/').href : './scenes.mjs');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const webDir = resolve(process.argv[2] ?? resolve(root, 'renders/web'));
const nativeDir = resolve(process.argv[3] ?? resolve(root, 'renders/native'));
const outDir = resolve(process.argv[4] ?? resolve(root, 'renders/compare'));
mkdirSync(outDir, { recursive: true });

const read = (p) => PNG.sync.read(readFileSync(p));
const results = [];

for (const s of scenes) {
  const wp = resolve(webDir, `${s.name}.png`);
  const np = resolve(nativeDir, `${s.name}.png`);
  if (!existsSync(wp) || !existsSync(np)) continue;
  const a = read(wp);
  const b = read(np);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const gap = 8;
  const out = new PNG({ width: w * 3 + gap * 2, height: h });
  out.data.fill(0);
  const errors = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      let e = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a.data[ia + c] - b.data[ib + c]);
        e = Math.max(e, d);
        out.data[(y * out.width + x) * 4 + c] = a.data[ia + c];
        out.data[(y * out.width + x + w + gap) * 4 + c] = b.data[ib + c];
        out.data[(y * out.width + x + 2 * (w + gap)) * 4 + c] = Math.min(255, d * 4);
      }
      for (const off of [0, w + gap, 2 * (w + gap)]) out.data[(y * out.width + x + off) * 4 + 3] = 255;
      errors.push(e);
    }
  }
  errors.sort((p, q) => p - q);
  const mean = errors.reduce((p, q) => p + q, 0) / errors.length;
  const p99 = errors[Math.floor(errors.length * 0.99)];
  const over16 = errors.filter((e) => e > 16).length / errors.length;
  results.push({ scene: s.name, static: s.static, mean: +mean.toFixed(2), p99, over16: +(over16 * 100).toFixed(2) });
  writeFileSync(resolve(outDir, `${s.name}.png`), PNG.sync.write(out));
}

console.table(results);
writeFileSync(resolve(outDir, 'results.json'), JSON.stringify(results, null, 2));
