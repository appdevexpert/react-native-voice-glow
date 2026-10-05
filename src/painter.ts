/**
 * Paints one frame of the glow into a Skia canvas. Runs on the UI thread
 * (every function here is a worklet) and in Node, through react-native-skia's
 * CanvasKit-backed web API, for the render tests.
 *
 * The layers mirror the web component's DOM, bottom to top, each clipped to
 * the element's rounded rectangle:
 *
 *   1. inner light: soft lobes inside the element, faded off away from the
 *      edges, plus a faint inset rim
 *   2. stroke: the lobes painted into the 1px edge ring, with a hot core
 *   3. bloom: a blurred halo of the lobes
 *   4. band: the luminous ridge along the bend, with chromatic fringes
 *   5. epicentre: a white wash under the band (light theme)
 *
 * Every visual layer follows the CSS pipeline it stands in for: content,
 * then the filter (blur, hue-rotate, brightness, saturate, displacement),
 * then the clip, then the mask, then the opacity.
 */
import type {
  SkCanvas,
  SkColorFilter,
  SkImageFilter,
  SkPath,
  SkShader,
  Skia as SkiaValue,
} from '@shopify/react-native-skia';
import { LOBE_COUNT, LOBE_H, LOBE_W, type RGB } from './constants';
import { BAND_SAMPLES, bandPoints, paintedRadius, type GlowFrame } from './engine';
import type { GlowConfig } from './types';

// Skia enum values (kept local so this module never imports the native package at runtime).
const TILE_CLAMP = 0;
const TILE_DECAL = 3;
const BLEND_CLEAR = 0;
const BLEND_DST_IN = 6;
const CLIP_DIFFERENCE = 0;
const CLIP_INTERSECT = 1;
const CHANNEL_R = 0;
const CHANNEL_G = 1;
const STYLE_STROKE = 1;
const CAP_ROUND = 1;
const JOIN_ROUND = 1;
const FILL_EVEN_ODD = 1;
const BLUR_NORMAL = 0;
/** Interpolate gradient colours in premultiplied space, as CSS does. */
const GRADIENT_PREMUL = 1;

/** The react-native-skia API object (`Skia`), passed in so the painter also runs against CanvasKit in tests. */
type SkiaApi = typeof SkiaValue;

const BAND_RAMP_W = [1, 0.72, 0.46, 0.22];
const BAND_RAMP_A = [0.16, 0.2, 0.26, 0.34];

function rgba(c: RGB, a: number): Float32Array {
  'worklet';
  return Float32Array.of(c[0] / 255, c[1] / 255, c[2] / 255, a);
}

function white(a: number): Float32Array {
  'worklet';
  return Float32Array.of(1, 1, 1, a);
}

/** Round to 0.1px the way the web stylesheet writes its lengths. */
function px1(v: number): number {
  'worklet';
  return Math.round(v * 10) / 10;
}

// ── Colour filters: the CSS filter functions as Skia colour matrices ─────

function matrixFilter(Sk: SkiaApi, m: number[]): SkColorFilter {
  'worklet';
  return Sk.ColorFilter.MakeMatrix(m);
}

/** hue-rotate(deg) brightness(b) saturate(s), chained in CSS order. */
export function cssColorFilter(Sk: SkiaApi, deg: number, b: number, s: number): SkColorFilter {
  'worklet';
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const n = Math.sin(r);
  const hue = matrixFilter(Sk, [
    0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928, 0, 0,
    0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.14, 0.072 - c * 0.072 - n * 0.283, 0, 0,
    0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ]);
  const bright = matrixFilter(Sk, [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]);
  const sat = matrixFilter(Sk, [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ]);
  return Sk.ColorFilter.MakeCompose(sat, Sk.ColorFilter.MakeCompose(bright, hue));
}

// ── Shapes and shaders ──────────────────────────────────────────────────

/** An elliptical radial gradient: CSS `radial-gradient(ellipse rx ry at cx cy, …)`. */
function ellipseShader(
  Sk: SkiaApi,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colors: Float32Array[],
  pos: number[]
): SkShader {
  'worklet';
  const k = ry / rx;
  const local = Sk.Matrix([1, 0, 0, 0, k, cy - k * cy, 0, 0, 1]);
  return Sk.Shader.MakeRadialGradient({ x: cx, y: cy }, rx, colors, pos, TILE_CLAMP, local, GRADIENT_PREMUL);
}

/** A path builder that works on both the immutable-path (PathBuilder) and older mutable-path APIs. */
function pathBuilder(Sk: SkiaApi): any {
  'worklet';
  const factory = (Sk as any).PathBuilder;
  return factory ? factory.Make() : Sk.Path.Make();
}

function finishPath(b: any): SkPath {
  'worklet';
  return typeof b.build === 'function' ? b.build() : b;
}

function linePath(Sk: SkiaApi, pts: number[], ox: number, oy: number): SkPath {
  'worklet';
  const b = pathBuilder(Sk);
  b.moveTo(pts[0] + ox, pts[1] + oy);
  for (let i = 1; i <= BAND_SAMPLES; i++) b.lineTo(pts[i * 2] + ox, pts[i * 2 + 1] + oy);
  return finishPath(b);
}

/** The region under the band line. */
function belowPath(Sk: SkiaApi, pts: number[], cw: number, ch: number): SkPath {
  'worklet';
  const b = pathBuilder(Sk);
  b.moveTo(0, ch);
  for (let i = 0; i <= BAND_SAMPLES; i++) b.lineTo(pts[i * 2], pts[i * 2 + 1]);
  b.lineTo(cw, ch);
  b.close();
  return finishPath(b);
}

/** The region above the band line. */
function abovePath(Sk: SkiaApi, pts: number[], cw: number, ch: number): SkPath {
  'worklet';
  const b = pathBuilder(Sk);
  b.moveTo(0, 0);
  b.lineTo(cw, 0);
  b.lineTo(cw, ch);
  for (let i = BAND_SAMPLES; i >= 0; i--) b.lineTo(pts[i * 2], pts[i * 2 + 1]);
  b.lineTo(0, ch);
  b.close();
  return finishPath(b);
}

function rrect(Sk: SkiaApi, x: number, y: number, w: number, h: number, r: number) {
  'worklet';
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return Sk.RRectXY(Sk.XYWHRect(x, y, w, h), rr, rr);
}

/** Erase the current layer within the current clip. (A paint, not drawColor: BlendMode.Clear is 0.) */
function clearLayer(Sk: SkiaApi, canvas: SkCanvas): void {
  'worklet';
  const p = Sk.Paint();
  p.setBlendMode(BLEND_CLEAR);
  canvas.drawPaint(p);
}

/** Erase everything in the current layer outside `path` (a CSS clip-path applied after the filter). */
function keepInside(Sk: SkiaApi, canvas: SkCanvas, path: SkPath): void {
  'worklet';
  canvas.save();
  canvas.clipPath(path, CLIP_DIFFERENCE, true);
  clearLayer(Sk, canvas);
  canvas.restore();
}

/** Multiply the current layer by a mask shader's alpha (CSS mask-image). */
function applyMask(Sk: SkiaApi, canvas: SkCanvas, shader: SkShader, cw: number, ch: number): void {
  'worklet';
  const p = Sk.Paint();
  p.setBlendMode(BLEND_DST_IN);
  p.setShader(shader);
  canvas.drawRect(Sk.XYWHRect(0, 0, cw, ch), p);
}

/**
 * The ellipse every layer is masked to: on the beam, growing with the
 * level and humping up with the bend.
 */
function edgeMask(
  Sk: SkiaApi,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  w: number,
  h: number,
  mid: number,
  tail: number
): SkShader | null {
  'worklet';
  const rx = px1(w * cfg.rangeWidth) * f.w * f.mw;
  const ry = px1(h * cfg.rangeHeight) * f.h + f.lift;
  if (rx < 0.01 || ry < 0.01) return null;
  const cx = cw / 2 + f.cx * f.w;
  const cy = ch + f.cy;
  if (tail > 0) {
    return ellipseShader(Sk, cx, cy, rx, ry, [white(1), white(0.5), white(tail), white(0)], [0, mid / 100, 0.85, 1]);
  }
  return ellipseShader(Sk, cx, cy, rx, ry, [white(1), white(0.5), white(0)], [0, mid / 100, 1]);
}

/**
 * The seven lobes as stacked radial gradients (the last lobe at the bottom
 * of the stack, as CSS paints a background list).
 */
function drawLobes(
  Sk: SkiaApi,
  canvas: SkCanvas,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  alpha: number,
  sw: number,
  sh: number,
  y: number,
  fade: number
): void {
  'worklet';
  const stop = fade / 100;
  const p = Sk.Paint();
  for (let i = LOBE_COUNT - 1; i >= 0; i--) {
    const W = Math.round(LOBE_W[i] * sw) * f.w;
    const H = Math.round(LOBE_H[i] * sh) * f.h * f.lobeL[i];
    if (W < 0.01 || H < 0.01) continue;
    const X = cw / 2 + (f.cx + f.lobeX[i]) * f.w;
    const Y = ch + (y + f.lobeY[i]);
    const c = cfg.colors[i];
    p.setShader(ellipseShader(Sk, X, Y, W, H, [rgba(c, alpha), rgba(c, 0)], [0, stop]));
    // Only the gradient's visible extent needs filling.
    const ex = W * stop + 1;
    const ey = H * stop + 1;
    const x0 = Math.max(0, X - ex);
    const y0 = Math.max(0, Y - ey);
    const x1 = Math.min(cw, X + ex);
    const y1 = Math.min(ch, Y + ey);
    if (x1 > x0 && y1 > y0) canvas.drawRect(Sk.XYWHRect(x0, y0, x1 - x0, y1 - y0), p);
  }
}

/**
 * The displacement warp: drifting fractal noise displacing x only.
 *
 * The web component rasters its warp layers at half size and scales them
 * back up, and its SVG filter works in that half-size space, so on screen
 * the noise is twice as coarse and the displacement and drift twice as
 * large as the numbers say. That is the look people see, so it is the look
 * reproduced here, at full resolution.
 */
const WARP_SPACE = 2;

function displacementFilter(Sk: SkiaApi, cfg: GlowConfig, f: GlowFrame, input: SkImageFilter): SkImageFilter {
  'worklet';
  const dd = cfg.distortionDetail / WARP_SPACE;
  const noise = Sk.Shader.MakeFractalNoise(0.012 * dd, 0.05 * dd, 2, 7, 0, 0);
  let map = Sk.ImageFilter.MakeShader(noise);
  map = Sk.ImageFilter.MakeOffset(f.noiseDx * WARP_SPACE, f.noiseDy * WARP_SPACE, map, null);
  // Green pinned to 0.5 so only x displaces.
  map = Sk.ImageFilter.MakeColorFilter(
    Sk.ColorFilter.MakeMatrix([1, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]),
    map,
    null
  );
  return Sk.ImageFilter.MakeDisplacementMap(CHANNEL_R, CHANNEL_G, f.displace * WARP_SPACE, map, input, null);
}

// ── Layers ──────────────────────────────────────────────────────────────

function paintInner(
  Sk: SkiaApi,
  canvas: SkCanvas,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  R: number,
  colorFilter: SkColorFilter,
  clip: SkPath | null,
  warped: boolean
): void {
  'worklet';
  const opacity = Math.min(1, f.opacity * f.glow * cfg.innerOpacity * cfg.strength);
  if (opacity <= 0.002) return;

  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  canvas.saveLayer(layer);

  // Content, then the filter.
  const filterPaint = Sk.Paint();
  const cf = Sk.ImageFilter.MakeColorFilter(colorFilter, null, null);
  filterPaint.setImageFilter(warped ? displacementFilter(Sk, cfg, f, cf) : cf);
  canvas.saveLayer(filterPaint);
  canvas.clipRRect(rrect(Sk, 0, 0, cw, ch, R), CLIP_INTERSECT, true);
  const gw = cfg.glowWidth * 0.9 * cfg.innerScale;
  const gh = cfg.glowHeight * 0.9 * cfg.innerScale * cfg.innerHeight;
  drawLobes(Sk, canvas, cfg, f, cw, ch, 0.46, gw, gh, 0, cfg.fade);
  // The faint inset rim (CSS `box-shadow: inset 0 0 9px 1px`).
  const blur = 9 * cfg.scale;
  const sigma = blur / 2;
  const rim = pathBuilder(Sk);
  rim.addRect(Sk.XYWHRect(-blur * 3, -blur * 3, cw + blur * 6, ch + blur * 6));
  rim.addRRect(rrect(Sk, 1, 1, cw - 2, ch - 2, Math.max(0, R - 1)));
  rim.setFillType(FILL_EVEN_ODD);
  const shadow = Sk.Paint();
  const sc = cfg.innerShadow;
  shadow.setColor(Float32Array.of(sc[0] / 255, sc[1] / 255, sc[2] / 255, sc[3]));
  shadow.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, sigma, true));
  canvas.drawPath(finishPath(rim), shadow);
  canvas.restore();

  // The clip, then the mask: the ceiling ellipse, intersected with a
  // frame that keeps the light near the edges.
  if (clip) keepInside(Sk, canvas, clip);
  const mask = edgeMask(Sk, cfg, f, cw, ch, 170, 64, 45, 0.3);
  if (mask) applyMask(Sk, canvas, mask, cw, ch);
  else clearLayer(Sk, canvas);
  const fadePx = 28 * cfg.scale;
  const frame = Sk.Paint();
  frame.setBlendMode(BLEND_DST_IN);
  canvas.saveLayer(frame);
  const g = Sk.Paint();
  const vStop = Math.min(0.5, fadePx / ch);
  g.setShader(
    Sk.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: 0, y: ch },
      [white(1), white(0), white(0), white(1)],
      [0, vStop, Math.max(vStop, 1 - fadePx / ch), 1],
      TILE_CLAMP
    )
  );
  canvas.drawRect(Sk.XYWHRect(0, 0, cw, ch), g);
  const hStop = Math.min(0.5, fadePx / cw);
  g.setShader(
    Sk.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: cw, y: 0 },
      [white(1), white(0), white(0), white(1)],
      [0, hStop, Math.max(hStop, 1 - fadePx / cw), 1],
      TILE_CLAMP
    )
  );
  canvas.drawRect(Sk.XYWHRect(0, 0, cw, ch), g);
  canvas.restore();

  canvas.restore();
}

function paintStroke(
  Sk: SkiaApi,
  canvas: SkCanvas,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  R: number,
  colorFilter: SkColorFilter
): void {
  'worklet';
  const opacity = Math.min(1, f.opacity * f.glow * cfg.strokeOpacity * cfg.strength);
  if (opacity <= 0.002) return;
  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  canvas.saveLayer(layer);

  const filterPaint = Sk.Paint();
  filterPaint.setColorFilter(colorFilter);
  canvas.saveLayer(filterPaint);
  // The 1px ring between the border box and the content box.
  const innerR = Math.max(0, R - 1);
  canvas.clipRRect(rrect(Sk, 0, 0, cw, ch, innerR), CLIP_INTERSECT, true);
  canvas.clipRRect(rrect(Sk, 1, 1, cw - 2, ch - 2, Math.max(0, innerR - 1)), CLIP_DIFFERENCE, true);
  drawLobes(Sk, canvas, cfg, f, cw, ch, 1, cfg.glowWidth * cfg.strokeScale, cfg.glowHeight * cfg.strokeScale, 2, cfg.fade);
  // The hot core at the centre of the edge: white on dark, black on light.
  const bx = cw / 2 + f.cx * f.w;
  const by = ch + 2 + f.cy;
  const cs = cfg.coreSize;
  const p = Sk.Paint();
  if (cfg.dark) {
    const rx = px1(30 * cs) * f.w;
    const ry = px1(30 * cs) * f.h;
    if (rx > 0.01 && ry > 0.01) {
      p.setShader(ellipseShader(Sk, bx, by, rx, ry, [white(0.45), white(0.14), white(0)], [0, 0.3, 0.65]));
      canvas.drawRect(Sk.XYWHRect(0, 0, cw, ch), p);
    }
  } else {
    const rx = px1(40 * cs) * f.w;
    const ry = px1(30 * cs) * f.h;
    if (rx > 0.01 && ry > 0.01) {
      p.setShader(
        ellipseShader(
          Sk,
          bx,
          by,
          rx,
          ry,
          [Float32Array.of(0, 0, 0, 0.55), Float32Array.of(0, 0, 0, 0.22), Float32Array.of(0, 0, 0, 0)],
          [0, 0.35, 0.7]
        )
      );
      canvas.drawRect(Sk.XYWHRect(0, 0, cw, ch), p);
    }
  }
  canvas.restore();

  const mask = edgeMask(Sk, cfg, f, cw, ch, 170, 64, 45, 0);
  if (mask) applyMask(Sk, canvas, mask, cw, ch);
  else clearLayer(Sk, canvas);
  canvas.restore();
}

function paintBloom(
  Sk: SkiaApi,
  canvas: SkCanvas,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  R: number,
  colorFilter: SkColorFilter,
  clip: SkPath | null,
  warped: boolean
): void {
  'worklet';
  const opacity = Math.min(1, f.opacity * f.glow * cfg.bloomOpacity * cfg.strength);
  if (opacity <= 0.002) return;
  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  canvas.saveLayer(layer);

  const blur = Sk.ImageFilter.MakeBlur(cfg.bloomBlur, cfg.bloomBlur, TILE_DECAL, null, null);
  const colored = Sk.ImageFilter.MakeColorFilter(colorFilter, blur, null);
  const filterPaint = Sk.Paint();
  filterPaint.setImageFilter(warped ? displacementFilter(Sk, cfg, f, colored) : colored);
  canvas.saveLayer(filterPaint);
  canvas.clipRRect(rrect(Sk, 0, 0, cw, ch, Math.max(0, R - 1)), CLIP_INTERSECT, true);
  drawLobes(
    Sk,
    canvas,
    cfg,
    f,
    cw,
    ch,
    cfg.dark ? 0.9 : 0.7,
    cfg.glowWidth * 1.15 * cfg.bloomScale,
    cfg.glowHeight * 1.5 * cfg.bloomScale * cfg.bloomHeight,
    0,
    Math.min(95, cfg.fade + 2)
  );
  canvas.restore();

  if (clip) keepInside(Sk, canvas, clip);
  const mask = edgeMask(Sk, cfg, f, cw, ch, 200, 130, 35, 0);
  if (mask) applyMask(Sk, canvas, mask, cw, ch);
  else clearLayer(Sk, canvas);
  canvas.restore();
}

/** A horizontal gradient that fades the band's ends into the edge. */
function endsFaded(Sk: SkiaApi, x0: number, x1: number, c: RGB, a: number, fade: number): SkShader {
  'worklet';
  return Sk.Shader.MakeLinearGradient(
    { x: x0, y: 0 },
    { x: x1 === x0 ? x0 + 1 : x1, y: 0 },
    [rgba(c, 0), rgba(c, a), rgba(c, a), rgba(c, 0)],
    [0, fade, 1 - fade, 1],
    TILE_CLAMP
  );
}

function paintBand(
  Sk: SkiaApi,
  canvas: SkCanvas,
  cfg: GlowConfig,
  f: GlowFrame,
  pts: number[],
  colorFilter: SkColorFilter
): void {
  'worklet';
  const alpha = Math.min(1, 0.6 * cfg.bandStrength * f.bendA);
  const opacity = f.opacity * cfg.strength;
  if (alpha < 0.005 || cfg.bandWidth <= 0 || opacity <= 0.002) return;

  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  layer.setImageFilter(Sk.ImageFilter.MakeColorFilter(colorFilter, null, null));
  canvas.saveLayer(layer);

  const bw = cfg.bandWidth * (1 + 0.35 * f.level);
  const split = cfg.bandAberration * (0.35 + 0.65 * f.level);
  const dy = (4 + 12 * split) * cfg.scale;
  const dx = 4 * split * cfg.scale;
  const base = (cfg.dark ? 0.42 : 0.4) * alpha;
  const thickness = 14 * bw;
  const blurPx = (3.5 * cfg.bandWidth) / 2;
  const x0 = pts[0];
  const x1 = pts[BAND_SAMPLES * 2];
  const fade = cfg.bandTail > 0 ? 0.015 : 0.18;

  const p = Sk.Paint();
  p.setStyle(STYLE_STROKE);
  p.setStrokeCap(CAP_ROUND);
  p.setStrokeJoin(JOIN_ROUND);

  // Halo: wide and hazy, under everything.
  p.setImageFilter(Sk.ImageFilter.MakeBlur(blurPx * 3, blurPx * 3, TILE_DECAL, null, null));
  p.setShader(endsFaded(Sk, x0, x1, cfg.bandCore, base * 0.3, fade));
  p.setStrokeWidth(thickness * 2.2);
  canvas.drawPath(linePath(Sk, pts, 0, 0), p);

  // The ridge: a red fringe above, a faint green between, blue below and
  // the core on top, each a stack of shrinking strokes so it has a ramp
  // across its thickness.
  p.setImageFilter(Sk.ImageFilter.MakeBlur(blurPx, blurPx, TILE_DECAL, null, null));
  for (let r = 0; r < 4; r++) {
    const c = r === 0 ? cfg.bandAbove : r === 1 ? cfg.bandMid : r === 2 ? cfg.bandBelow : cfg.bandCore;
    const a = r === 1 ? 0.55 : r === 3 ? 0.9 : 1;
    const ox = r === 0 ? dx : r === 1 ? dx * 0.35 : r === 2 ? -dx : 0;
    const oy = r === 0 ? -dy : r === 1 ? -dy * 0.35 : r === 2 ? dy : 0;
    const path = linePath(Sk, pts, ox, oy);
    for (let k = 0; k < 4; k++) {
      p.setShader(endsFaded(Sk, x0, x1, c, base * a * BAND_RAMP_A[k], fade));
      p.setStrokeWidth(Math.max(0.6, thickness * BAND_RAMP_W[k]));
      canvas.drawPath(path, p);
    }
  }
  canvas.restore();
}

function paintCore(
  Sk: SkiaApi,
  canvas: SkCanvas,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  R: number,
  below: SkPath | null
): void {
  'worklet';
  const boost = Math.max(0, Math.min(2, cfg.coreLight - 1));
  const b1 = Math.min(1, boost);
  const b2 = Math.max(0, boost - 1);
  const grow = 1 + 0.3 * boost;
  const solid = px1(45 * b1 + 27 * b2) / 100;
  const midStop = px1(40 + 25 * b1 + 15 * b2) / 100;
  const midAlpha = Math.min(1, 0.55 + 0.35 * b1 + 0.1 * b2);
  const endStop = px1(72 + 14 * b1 + 8 * b2) / 100;
  const opacity = f.opacity * Math.min(1, f.glow * Math.min(1, cfg.coreLight) * (1.6 + 1.4 * boost));
  if (opacity <= 0.002) return;

  const rx = px1(120 * cfg.coreLightWidth * grow * cfg.scale) * f.w;
  const ry = px1(70 * cfg.coreLightHeight * grow * cfg.scale) * f.h + f.lift;
  if (rx < 0.01 || ry < 0.01) return;

  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  layer.setImageFilter(Sk.ImageFilter.MakeBlur(cfg.coreBlur, cfg.coreBlur, TILE_DECAL, null, null));
  canvas.saveLayer(layer);
  canvas.clipRRect(rrect(Sk, 0, 0, cw, ch, Math.max(0, R - 1)), CLIP_INTERSECT, true);
  if (below) canvas.clipPath(below, CLIP_INTERSECT, true);
  const p = Sk.Paint();
  p.setShader(
    ellipseShader(
      Sk,
      cw / 2 + f.cx * f.w,
      ch + f.cy,
      rx,
      ry,
      [white(1), white(1), white(midAlpha), white(0)],
      [0, solid, midStop, endStop]
    )
  );
  canvas.drawRect(Sk.XYWHRect(0, 0, cw, ch), p);
  canvas.restore();
}

/**
 * Paint the whole glow for one frame. `scratch` holds the band line's
 * points between frames (2 × (BAND_SAMPLES + 1) numbers).
 */
export function paintGlow(
  Sk: SkiaApi,
  canvas: SkCanvas,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  scratch: number[]
): void {
  'worklet';
  if (cw <= 0 || ch <= 0 || f.opacity <= 0.001) return;
  const R = paintedRadius(cfg.radius, cw, ch);

  canvas.save();
  canvas.clipRRect(rrect(Sk, 0, 0, cw, ch, R), CLIP_INTERSECT, true);

  const colorFilter = cssColorFilter(Sk, cfg.hueBase + f.hue, cfg.brightness, cfg.saturation);
  bandPoints(cfg, f, cw, ch, scratch);
  const warp = cfg.distortion > 0 && !f.warpOff && f.displace > 0.01;
  const above = warp ? abovePath(Sk, scratch, cw, ch) : null;
  const below = warp || cfg.coreLight > 0 ? belowPath(Sk, scratch, cw, ch) : null;

  paintInner(Sk, canvas, cfg, f, cw, ch, R, colorFilter, above, false);
  if (warp) paintInner(Sk, canvas, cfg, f, cw, ch, R, colorFilter, below, true);
  paintStroke(Sk, canvas, cfg, f, cw, ch, R, colorFilter);
  paintBloom(Sk, canvas, cfg, f, cw, ch, R, colorFilter, above, false);
  if (warp) paintBloom(Sk, canvas, cfg, f, cw, ch, R, colorFilter, below, true);
  paintBand(Sk, canvas, cfg, f, scratch, colorFilter);
  if (cfg.coreLight > 0) paintCore(Sk, canvas, cfg, f, cw, ch, R, below);

  canvas.restore();
}
