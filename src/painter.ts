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
 * then the filter (blur, displacement, hue-rotate, brightness, saturate),
 * then the clip, then the mask, then the opacity.
 *
 * Allocation: react-native-skia reports every shader and image filter to
 * the JS engine as 1 MB of native memory, so building them per frame drives
 * the UI thread's garbage collector hard. Everything that depends only on
 * the config or the size is built once into `GlowResources` and reused:
 * gradients are made at unit size and placed with canvas transforms, blurs
 * are cached, and the per-frame colour drift goes on the layer paint as a
 * (cheap) colour filter. Only the distortion's drifting map (four image
 * filters) is rebuilt each frame; no shader is.
 *
 * Order matters in this file: the worklets Babel plugin turns each worklet
 * function into a constant that captures what it calls when it is defined,
 * so a worklet must be declared after every worklet it uses.
 */
import type {
  SkCanvas,
  SkColorFilter,
  SkImageFilter,
  SkPaint,
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

/** Lobe layers, in the order of the cached shaders. */
const LAYER_STROKE = 0;
const LAYER_INNER = 1;
const LAYER_BLOOM = 2;

/**
 * The web component rasters its warp layers at half size and scales them
 * back up, and its SVG filter works in that half-size space, so on screen
 * the noise is twice as coarse and the displacement and drift twice as
 * large as the numbers say. That is the look people see, so it is the look
 * reproduced here, at full resolution.
 */
const WARP_SPACE = 2;

/** Everything the painter can build once per config (and size) and reuse every frame. */
export interface GlowResources {
  version: number;
  w: number;
  h: number;
  lobes: (SkShader | null)[];
  highlight: SkShader | null;
  maskInner: SkShader | null;
  maskStroke: SkShader | null;
  maskBloom: SkShader | null;
  core: SkShader | null;
  coreExtent: number;
  frameV: SkShader | null;
  frameH: SkShader | null;
  rim: SkPath | null;
  bloomBlur: SkImageFilter | null;
  bandBlur: SkImageFilter | null;
  haloBlur: SkImageFilter | null;
  coreBlur: SkImageFilter | null;
  noise: SkImageFilter | null;
  noiseColor: SkColorFilter | null;
  /** The band's end fades, at unit width, placed on its span each frame. */
  bandFade: SkShader | null;
  /** The colour drift's filter, keyed by its hue. */
  colorFilter: SkColorFilter | null;
  colorHue: number;
  colorVersion: number;
}

export function createResources(): GlowResources {
  'worklet';
  return {
    version: -1,
    w: -1,
    h: -1,
    lobes: [],
    highlight: null,
    maskInner: null,
    maskStroke: null,
    maskBloom: null,
    core: null,
    coreExtent: 0,
    frameV: null,
    frameH: null,
    rim: null,
    bloomBlur: null,
    bandBlur: null,
    haloBlur: null,
    coreBlur: null,
    noise: null,
    noiseColor: null,
    bandFade: null,
    colorFilter: null,
    colorHue: NaN,
    colorVersion: -1,
  };
}

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

function rect(x: number, y: number, width: number, height: number) {
  'worklet';
  return { x, y, width, height };
}

function rrect(x: number, y: number, w: number, h: number, r: number) {
  'worklet';
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return { rect: rect(x, y, w, h), rx: rr, ry: rr };
}

// ── Colour filters: the CSS filter functions as Skia colour matrices ─────

/** hue-rotate(deg) brightness(b) saturate(s), chained in CSS order. */
export function cssColorFilter(Sk: SkiaApi, deg: number, b: number, s: number): SkColorFilter {
  'worklet';
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const n = Math.sin(r);
  const hue = Sk.ColorFilter.MakeMatrix([
    0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928, 0, 0,
    0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.14, 0.072 - c * 0.072 - n * 0.283, 0, 0,
    0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ]);
  const bright = Sk.ColorFilter.MakeMatrix([b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]);
  const sat = Sk.ColorFilter.MakeMatrix([
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ]);
  return Sk.ColorFilter.MakeCompose(sat, Sk.ColorFilter.MakeCompose(bright, hue));
}

// ── Paths ───────────────────────────────────────────────────────────────

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

// ── Building the cached resources ───────────────────────────────────────

/** A radial gradient on the unit circle, to be placed with translate + scale. */
function unitRadial(Sk: SkiaApi, colors: Float32Array[], pos: number[]): SkShader {
  'worklet';
  return Sk.Shader.MakeRadialGradient({ x: 0, y: 0 }, 1, colors, pos, TILE_CLAMP, undefined, GRADIENT_PREMUL);
}

function unitMask(Sk: SkiaApi, mid: number, tail: number): SkShader {
  'worklet';
  return tail > 0
    ? unitRadial(Sk, [white(1), white(0.5), white(tail), white(0)], [0, mid / 100, 0.85, 1])
    : unitRadial(Sk, [white(1), white(0.5), white(0)], [0, mid / 100, 1]);
}

/** Build (or refresh) everything that depends only on the config and the size. */
export function prepareResources(Sk: SkiaApi, r: GlowResources, cfg: GlowConfig, cw: number, ch: number): void {
  'worklet';
  const configChanged = r.version !== cfg.version;
  const sizeChanged = r.w !== cw || r.h !== ch;
  if (!configChanged && !sizeChanged) return;

  if (configChanged) {
    const lobes: (SkShader | null)[] = [];
    const strokeStop = cfg.fade / 100;
    const bloomStop = Math.min(95, cfg.fade + 2) / 100;
    for (let layer = 0; layer < 3; layer++) {
      const alpha = layer === LAYER_STROKE ? 1 : layer === LAYER_INNER ? 0.46 : cfg.dark ? 0.9 : 0.7;
      const stop = layer === LAYER_BLOOM ? bloomStop : strokeStop;
      for (let i = 0; i < LOBE_COUNT; i++) {
        const c = cfg.colors[i];
        lobes.push(unitRadial(Sk, [rgba(c, alpha), rgba(c, 0)], [0, stop]));
      }
    }
    r.lobes = lobes;
    r.highlight = cfg.dark
      ? unitRadial(Sk, [white(0.45), white(0.14), white(0)], [0, 0.3, 0.65])
      : unitRadial(
          Sk,
          [Float32Array.of(0, 0, 0, 0.55), Float32Array.of(0, 0, 0, 0.22), Float32Array.of(0, 0, 0, 0)],
          [0, 0.35, 0.7]
        );
    r.maskInner = unitMask(Sk, 45, 0.3);
    r.maskStroke = unitMask(Sk, 45, 0);
    r.maskBloom = unitMask(Sk, 35, 0);

    if (cfg.coreLight > 0) {
      const boost = Math.max(0, Math.min(2, cfg.coreLight - 1));
      const b1 = Math.min(1, boost);
      const b2 = Math.max(0, boost - 1);
      const solid = px1(45 * b1 + 27 * b2) / 100;
      const midStop = px1(40 + 25 * b1 + 15 * b2) / 100;
      const midAlpha = Math.min(1, 0.55 + 0.35 * b1 + 0.1 * b2);
      const endStop = px1(72 + 14 * b1 + 8 * b2) / 100;
      r.core = unitRadial(Sk, [white(1), white(1), white(midAlpha), white(0)], [0, solid, midStop, endStop]);
      r.coreExtent = endStop;
      r.coreBlur = Sk.ImageFilter.MakeBlur(cfg.coreBlur, cfg.coreBlur, TILE_DECAL, null, null);
    } else {
      r.core = null;
      r.coreBlur = null;
    }

    r.bloomBlur = Sk.ImageFilter.MakeBlur(cfg.bloomBlur, cfg.bloomBlur, TILE_DECAL, null, null);
    const fade = cfg.bandTail > 0 ? 0.015 : 0.18;
    r.bandFade = Sk.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      [white(0), white(1), white(1), white(0)],
      [0, fade, 1 - fade, 1],
      TILE_CLAMP
    );
    const blurPx = (3.5 * cfg.bandWidth) / 2;
    r.bandBlur = blurPx > 0 ? Sk.ImageFilter.MakeBlur(blurPx, blurPx, TILE_DECAL, null, null) : null;
    r.haloBlur = blurPx > 0 ? Sk.ImageFilter.MakeBlur(blurPx * 3, blurPx * 3, TILE_DECAL, null, null) : null;

    if (cfg.distortion > 0) {
      const dd = cfg.distortionDetail / WARP_SPACE;
      r.noise = Sk.ImageFilter.MakeShader(Sk.Shader.MakeFractalNoise(0.012 * dd, 0.05 * dd, 2, 7, 0, 0));
      // Green pinned to 0.5 so only x displaces.
      r.noiseColor = Sk.ColorFilter.MakeMatrix([1, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
    } else {
      r.noise = null;
      r.noiseColor = null;
    }
  }

  // The inner light's frame: fades in from every edge.
  const fadePx = 28 * cfg.scale;
  const vStop = Math.min(0.5, fadePx / ch);
  r.frameV = Sk.Shader.MakeLinearGradient(
    { x: 0, y: 0 },
    { x: 0, y: ch },
    [white(1), white(0), white(0), white(1)],
    [0, vStop, Math.max(vStop, 1 - fadePx / ch), 1],
    TILE_CLAMP
  );
  const hStop = Math.min(0.5, fadePx / cw);
  r.frameH = Sk.Shader.MakeLinearGradient(
    { x: 0, y: 0 },
    { x: cw, y: 0 },
    [white(1), white(0), white(0), white(1)],
    [0, hStop, Math.max(hStop, 1 - fadePx / cw), 1],
    TILE_CLAMP
  );

  // The faint inset rim (CSS `box-shadow: inset 0 0 9px 1px`): everything
  // outside the box inset by 1px, blurred back in.
  const R = paintedRadius(cfg.radius, cw, ch);
  const blur = 9 * cfg.scale;
  const rim = pathBuilder(Sk);
  rim.addRect(rect(-blur * 3, -blur * 3, cw + blur * 6, ch + blur * 6));
  rim.addRRect(rrect(1, 1, cw - 2, ch - 2, Math.max(0, R - 1)));
  rim.setFillType(FILL_EVEN_ODD);
  r.rim = finishPath(rim);

  r.version = cfg.version;
  r.w = cw;
  r.h = ch;
}

// ── Drawing helpers ─────────────────────────────────────────────────────

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

/**
 * Fill with a unit-size radial gradient placed at (x, y) with radii (rx, ry),
 * over only its visible extent (in unit radii) within the element.
 */
function drawUnit(
  canvas: SkCanvas,
  paint: SkPaint,
  shader: SkShader | null,
  x: number,
  y: number,
  rx: number,
  ry: number,
  extent: number,
  cw: number,
  ch: number
): void {
  'worklet';
  if (!shader || rx < 0.01 || ry < 0.01) return;
  const x0 = Math.max(-extent, -x / rx);
  const x1 = Math.min(extent, (cw - x) / rx);
  const y0 = Math.max(-extent, -y / ry);
  const y1 = Math.min(extent, (ch - y) / ry);
  if (x1 <= x0 || y1 <= y0) return;
  paint.setShader(shader);
  canvas.save();
  canvas.translate(x, y);
  canvas.scale(rx, ry);
  canvas.drawRect(rect(x0, y0, x1 - x0, y1 - y0), paint);
  canvas.restore();
}

/**
 * The ellipse every layer is masked to: on the beam, growing with the
 * level and humping up with the bend. Multiplies the current layer by it.
 */
function applyEdgeMask(
  Sk: SkiaApi,
  canvas: SkCanvas,
  shader: SkShader | null,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  w: number,
  h: number
): void {
  'worklet';
  const rx = px1(w * cfg.rangeWidth) * f.w * f.mw;
  const ry = px1(h * cfg.rangeHeight) * f.h + f.lift;
  if (!shader || rx < 0.01 || ry < 0.01) {
    clearLayer(Sk, canvas);
    return;
  }
  const cx = cw / 2 + f.cx * f.w;
  const cy = ch + f.cy;
  const p = Sk.Paint();
  p.setBlendMode(BLEND_DST_IN);
  p.setShader(shader);
  canvas.save();
  canvas.translate(cx, cy);
  canvas.scale(rx, ry);
  // A little past the element on every side, so its edge pixels are fully covered.
  canvas.drawRect(rect((-cx - 2) / rx, (-cy - 2) / ry, (cw + 4) / rx, (ch + 4) / ry), p);
  canvas.restore();
}

/**
 * The seven lobes of one layer as stacked radial gradients (the last lobe
 * at the bottom of the stack, as CSS paints a background list).
 */
function drawLobes(
  Sk: SkiaApi,
  canvas: SkCanvas,
  res: GlowResources,
  layer: number,
  f: GlowFrame,
  cw: number,
  ch: number,
  sw: number,
  sh: number,
  y: number,
  stop: number
): void {
  'worklet';
  const p = Sk.Paint();
  for (let i = LOBE_COUNT - 1; i >= 0; i--) {
    const W = Math.round(LOBE_W[i] * sw) * f.w;
    const H = Math.round(LOBE_H[i] * sh) * f.h * f.lobeL[i];
    const X = cw / 2 + (f.cx + f.lobeX[i]) * f.w;
    const Y = ch + (y + f.lobeY[i]);
    drawUnit(canvas, p, res.lobes[layer * LOBE_COUNT + i], X, Y, W, H, stop, cw, ch);
  }
}

/** This frame's displacement map: the cached noise, drifted. */
function displacementMap(Sk: SkiaApi, res: GlowResources, f: GlowFrame): SkImageFilter | null {
  'worklet';
  if (!res.noise || !res.noiseColor) return null;
  return Sk.ImageFilter.MakeColorFilter(
    res.noiseColor,
    Sk.ImageFilter.MakeOffset(f.noiseDx * WARP_SPACE, f.noiseDy * WARP_SPACE, res.noise, null),
    null
  );
}

function displace(Sk: SkiaApi, f: GlowFrame, map: SkImageFilter | null, input: SkImageFilter | null): SkImageFilter | null {
  'worklet';
  if (!map) return input;
  return Sk.ImageFilter.MakeDisplacementMap(CHANNEL_R, CHANNEL_G, f.displace * WARP_SPACE, map, input, null);
}

// ── Layers ──────────────────────────────────────────────────────────────

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function paintInner(
  Sk: SkiaApi,
  canvas: SkCanvas,
  res: GlowResources,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  R: number,
  colorFilter: SkColorFilter,
  clip: SkPath | null,
  warp: SkImageFilter | null,
  bounds: Bounds
): void {
  'worklet';
  const opacity = Math.min(1, f.opacity * f.glow * cfg.innerOpacity * cfg.strength);
  if (opacity <= 0.002) return;

  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  canvas.saveLayer(layer, bounds);

  // Content, then the filter.
  const filterPaint = Sk.Paint();
  filterPaint.setColorFilter(colorFilter);
  if (warp) filterPaint.setImageFilter(warp);
  canvas.saveLayer(filterPaint, bounds);
  canvas.clipRRect(rrect(0, 0, cw, ch, R), CLIP_INTERSECT, true);
  drawLobes(
    Sk,
    canvas,
    res,
    LAYER_INNER,
    f,
    cw,
    ch,
    cfg.glowWidth * 0.9 * cfg.innerScale,
    cfg.glowHeight * 0.9 * cfg.innerScale * cfg.innerHeight,
    0,
    cfg.fade / 100
  );
  if (res.rim) {
    const shadow = Sk.Paint();
    const sc = cfg.innerShadow;
    shadow.setColor(Float32Array.of(sc[0] / 255, sc[1] / 255, sc[2] / 255, sc[3]));
    shadow.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, (9 * cfg.scale) / 2, true));
    canvas.drawPath(res.rim, shadow);
  }
  canvas.restore();

  // The clip, then the mask: the ceiling ellipse, intersected with a
  // frame that keeps the light near the edges.
  if (clip) keepInside(Sk, canvas, clip);
  applyEdgeMask(Sk, canvas, res.maskInner, cfg, f, cw, ch, 170, 64);
  const frame = Sk.Paint();
  frame.setBlendMode(BLEND_DST_IN);
  canvas.saveLayer(frame, bounds);
  const g = Sk.Paint();
  g.setShader(res.frameV);
  canvas.drawRect(rect(0, 0, cw, ch), g);
  g.setShader(res.frameH);
  canvas.drawRect(rect(0, 0, cw, ch), g);
  canvas.restore();

  canvas.restore();
}

function paintStroke(
  Sk: SkiaApi,
  canvas: SkCanvas,
  res: GlowResources,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  R: number,
  colorFilter: SkColorFilter,
  bounds: Bounds
): void {
  'worklet';
  const opacity = Math.min(1, f.opacity * f.glow * cfg.strokeOpacity * cfg.strength);
  if (opacity <= 0.002) return;
  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  canvas.saveLayer(layer, bounds);

  const filterPaint = Sk.Paint();
  filterPaint.setColorFilter(colorFilter);
  canvas.saveLayer(filterPaint, bounds);
  // The 1px ring between the border box and the content box.
  const innerR = Math.max(0, R - 1);
  canvas.clipRRect(rrect(0, 0, cw, ch, innerR), CLIP_INTERSECT, true);
  canvas.clipRRect(rrect(1, 1, cw - 2, ch - 2, Math.max(0, innerR - 1)), CLIP_DIFFERENCE, true);
  drawLobes(
    Sk,
    canvas,
    res,
    LAYER_STROKE,
    f,
    cw,
    ch,
    cfg.glowWidth * cfg.strokeScale,
    cfg.glowHeight * cfg.strokeScale,
    2,
    cfg.fade / 100
  );
  // The hot core at the centre of the edge: white on dark, black on light.
  const cs = cfg.coreSize;
  drawUnit(
    canvas,
    Sk.Paint(),
    res.highlight,
    cw / 2 + f.cx * f.w,
    ch + 2 + f.cy,
    px1((cfg.dark ? 30 : 40) * cs) * f.w,
    px1(30 * cs) * f.h,
    cfg.dark ? 0.65 : 0.7,
    cw,
    ch
  );
  canvas.restore();

  applyEdgeMask(Sk, canvas, res.maskStroke, cfg, f, cw, ch, 170, 64);
  canvas.restore();
}

function paintBloom(
  Sk: SkiaApi,
  canvas: SkCanvas,
  res: GlowResources,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  R: number,
  colorFilter: SkColorFilter,
  clip: SkPath | null,
  warp: SkImageFilter | null,
  bounds: Bounds
): void {
  'worklet';
  const opacity = Math.min(1, f.opacity * f.glow * cfg.bloomOpacity * cfg.strength);
  if (opacity <= 0.002) return;
  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  canvas.saveLayer(layer, bounds);

  // Blur (then the displacement, if any), then the colour: a layer paint's
  // colour filter applies to its image filter's output.
  const filterPaint = Sk.Paint();
  filterPaint.setImageFilter(warp ?? res.bloomBlur);
  filterPaint.setColorFilter(colorFilter);
  canvas.saveLayer(filterPaint, bounds);
  canvas.clipRRect(rrect(0, 0, cw, ch, Math.max(0, R - 1)), CLIP_INTERSECT, true);
  drawLobes(
    Sk,
    canvas,
    res,
    LAYER_BLOOM,
    f,
    cw,
    ch,
    cfg.glowWidth * 1.15 * cfg.bloomScale,
    cfg.glowHeight * 1.5 * cfg.bloomScale * cfg.bloomHeight,
    0,
    Math.min(95, cfg.fade + 2) / 100
  );
  canvas.restore();

  if (clip) keepInside(Sk, canvas, clip);
  applyEdgeMask(Sk, canvas, res.maskBloom, cfg, f, cw, ch, 200, 130);
  canvas.restore();
}

function paintBand(
  Sk: SkiaApi,
  canvas: SkCanvas,
  res: GlowResources,
  cfg: GlowConfig,
  f: GlowFrame,
  pts: number[],
  colorFilter: SkColorFilter,
  bounds: Bounds
): void {
  'worklet';
  const alpha = Math.min(1, 0.6 * cfg.bandStrength * f.bendA);
  const opacity = f.opacity * cfg.strength;
  if (alpha < 0.005 || cfg.bandWidth <= 0 || opacity <= 0.002) return;

  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  layer.setColorFilter(colorFilter);
  canvas.saveLayer(layer, bounds);

  const bw = cfg.bandWidth * (1 + 0.35 * f.level);
  const split = cfg.bandAberration * (0.35 + 0.65 * f.level);
  const dy = (4 + 12 * split) * cfg.scale;
  const dx = 4 * split * cfg.scale;
  const base = (cfg.dark ? 0.42 : 0.4) * alpha;
  const thickness = 14 * bw;

  const p = Sk.Paint();
  p.setStyle(STYLE_STROKE);
  p.setStrokeCap(CAP_ROUND);
  p.setStrokeJoin(JOIN_ROUND);

  // Halo: wide and hazy, under everything.
  p.setImageFilter(res.haloBlur);
  p.setColor(rgba(cfg.bandCore, base * 0.3));
  p.setStrokeWidth(thickness * 2.2);
  canvas.drawPath(linePath(Sk, pts, 0, 0), p);

  // The ridge: a red fringe above, a faint green between, blue below and
  // the core on top, each a stack of shrinking strokes so it has a ramp
  // across its thickness.
  p.setImageFilter(res.bandBlur);
  for (let r = 0; r < 4; r++) {
    const c = r === 0 ? cfg.bandAbove : r === 1 ? cfg.bandMid : r === 2 ? cfg.bandBelow : cfg.bandCore;
    const a = r === 1 ? 0.55 : r === 3 ? 0.9 : 1;
    const ox = r === 0 ? dx : r === 1 ? dx * 0.35 : r === 2 ? -dx : 0;
    const oy = r === 0 ? -dy : r === 1 ? -dy * 0.35 : r === 2 ? dy : 0;
    const path = linePath(Sk, pts, ox, oy);
    for (let k = 0; k < 4; k++) {
      p.setColor(rgba(c, base * a * BAND_RAMP_A[k]));
      p.setStrokeWidth(Math.max(0.6, thickness * BAND_RAMP_W[k]));
      canvas.drawPath(path, p);
    }
  }

  // Fade the ends into the edge so the band never stops in a stub: the
  // cached unit-width fade, stretched over this frame's span.
  const x0 = pts[0];
  const span = Math.max(1, pts[BAND_SAMPLES * 2] - x0);
  if (res.bandFade) {
    const m = Sk.Paint();
    m.setBlendMode(BLEND_DST_IN);
    m.setShader(res.bandFade);
    canvas.save();
    canvas.translate(x0, 0);
    canvas.scale(span, 1);
    canvas.drawRect(rect((bounds.x - 2 - x0) / span, bounds.y - 2, (bounds.width + 4) / span, bounds.height + 4), m);
    canvas.restore();
  }
  canvas.restore();
}

function paintCore(
  Sk: SkiaApi,
  canvas: SkCanvas,
  res: GlowResources,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  R: number,
  below: SkPath | null,
  bounds: Bounds
): void {
  'worklet';
  if (!res.core) return;
  const boost = Math.max(0, Math.min(2, cfg.coreLight - 1));
  const grow = 1 + 0.3 * boost;
  const opacity = f.opacity * Math.min(1, f.glow * Math.min(1, cfg.coreLight) * (1.6 + 1.4 * boost));
  if (opacity <= 0.002) return;
  const rx = px1(120 * cfg.coreLightWidth * grow * cfg.scale) * f.w;
  const ry = px1(70 * cfg.coreLightHeight * grow * cfg.scale) * f.h + f.lift;

  const layer = Sk.Paint();
  layer.setAlphaf(opacity);
  layer.setImageFilter(res.coreBlur);
  canvas.saveLayer(layer, bounds);
  canvas.clipRRect(rrect(0, 0, cw, ch, Math.max(0, R - 1)), CLIP_INTERSECT, true);
  if (below) canvas.clipPath(below, CLIP_INTERSECT, true);
  drawUnit(canvas, Sk.Paint(), res.core, cw / 2 + f.cx * f.w, ch + f.cy, rx, ry, res.coreExtent, cw, ch);
  canvas.restore();
}

/**
 * The top of the region the glow can reach this frame, so every offscreen
 * layer is only as tall as the glow (a quiet glow on a phone screen is a
 * fraction of it).
 */
function glowTop(cfg: GlowConfig, f: GlowFrame, ch: number, pts: number[]): number {
  'worklet';
  // The bloom's ceiling is the tallest of the masks; nothing it masks reaches higher.
  let top = ch + f.cy - (px1(130 * cfg.rangeHeight) * f.h + f.lift);
  // The band and its blurred halo.
  let minY = ch;
  for (let i = 0; i <= BAND_SAMPLES; i++) if (pts[i * 2 + 1] < minY) minY = pts[i * 2 + 1];
  const thickness = 14 * cfg.bandWidth * (1 + 0.35 * f.level);
  const dy = (4 + 12 * cfg.bandAberration) * cfg.scale;
  const blurPx = (3.5 * cfg.bandWidth) / 2;
  top = Math.min(top, minY - dy - thickness * 1.1 - blurPx * 9);
  // The epicentre and its blur.
  if (cfg.coreLight > 0) {
    const grow = 1 + 0.3 * Math.max(0, Math.min(2, cfg.coreLight - 1));
    top = Math.min(top, ch + f.cy - (px1(70 * cfg.coreLightHeight * grow * cfg.scale) * f.h + f.lift) - cfg.coreBlur * 3);
  }
  return Math.max(0, Math.floor(top - 4));
}

/**
 * Paint the whole glow for one frame. `scratch` holds the band line's
 * points between frames (2 × (BAND_SAMPLES + 1) numbers); `res` holds the
 * cached shaders and filters.
 */
export function paintGlow(
  Sk: SkiaApi,
  canvas: SkCanvas,
  cfg: GlowConfig,
  f: GlowFrame,
  cw: number,
  ch: number,
  scratch: number[],
  res: GlowResources
): void {
  'worklet';
  if (cw <= 0 || ch <= 0 || f.opacity <= 0.001) return;
  prepareResources(Sk, res, cfg, cw, ch);
  const R = paintedRadius(cfg.radius, cw, ch);

  canvas.save();
  canvas.clipRRect(rrect(0, 0, cw, ch, R), CLIP_INTERSECT, true);

  const hue = cfg.hueBase + f.hue;
  if (res.colorVersion !== cfg.version || Math.abs(res.colorHue - hue) > 0.01 || !res.colorFilter) {
    res.colorFilter = cssColorFilter(Sk, hue, cfg.brightness, cfg.saturation);
    res.colorHue = hue;
    res.colorVersion = cfg.version;
  }
  const colorFilter = res.colorFilter;

  bandPoints(cfg, f, cw, ch, scratch);
  const top = glowTop(cfg, f, ch, scratch);
  // const bounds = rect(0, top, cw, ch - top);
  const bounds = Sk.XYWHRect(0, top, cw, ch - top);
  const warp = cfg.distortion > 0 && !f.warpOff && f.displace > 0.01;
  const above = warp ? abovePath(Sk, scratch, cw, ch) : null;
  const below = warp || cfg.coreLight > 0 ? belowPath(Sk, scratch, cw, ch) : null;

  const map = warp ? displacementMap(Sk, res, f) : null;

  paintInner(Sk, canvas, res, cfg, f, cw, ch, R, colorFilter, above, null, bounds);
  if (warp) paintInner(Sk, canvas, res, cfg, f, cw, ch, R, colorFilter, below, displace(Sk, f, map, null), bounds);
  paintStroke(Sk, canvas, res, cfg, f, cw, ch, R, colorFilter, bounds);
  paintBloom(Sk, canvas, res, cfg, f, cw, ch, R, colorFilter, above, null, bounds);
  if (warp) paintBloom(Sk, canvas, res, cfg, f, cw, ch, R, colorFilter, below, displace(Sk, f, map, res.bloomBlur), bounds);
  paintBand(Sk, canvas, res, cfg, f, scratch, colorFilter, bounds);
  if (cfg.coreLight > 0) paintCore(Sk, canvas, res, cfg, f, cw, ch, R, below, bounds);

  canvas.restore();
}
