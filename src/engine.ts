/**
 * The per-frame voice engine. Runs on the UI thread (every function here is
 * a worklet) and in Node for the render tests.
 *
 * Each frame it reads the latest audio reading, shapes it (gain, noise
 * gate, soft saturation), follows it with an attack/release envelope,
 * advances the flow, gathers the lobes where a motion asks for it, folds
 * in the idle breathing and the hue drift, and writes the result into a
 * `GlowFrame` the painter draws from.
 *
 * The maths is a port of the driver in `voice-glow` by Jakub Antalik
 * (MIT), so the glow responds to a voice exactly as the web one does.
 */
import { LOBE_BAND, LOBE_COUNT, LOBE_SPAN, LOBE_X } from './constants';
import type { GlowConfig, VoiceGlowMotion, VoiceInputFrame } from './types';

export interface EngineState {
  /** Smoothed level and low / mid / high bands. */
  level: number;
  b0: number;
  b1: number;
  b2: number;
  /** The last raw reading, held while paused. */
  raw: number;
  r0: number;
  r1: number;
  r2: number;
  /** Flow phase in px, 0 ≤ phase < span. */
  phase: number;
  /** The instance's own clock, seconds; advances only while running. */
  t: number;
  /** The distortion's share, 0–1: 1 for the voice glow, settling to 0 while gathered. */
  warp: number;
  /** The motion last read, held while paused. */
  mGather: number;
  mOffset: number;
  mStretch: number;
  mHeld: number;
  mCorner: number;
  /** Fade in / out of the whole effect. */
  opacity: number;
  fadeFrom: number;
  fadeTo: number;
  fadeT: number;
  fadeDur: number;
  fadeNotified: boolean;
  /** The batch of readings being played back, and how far into it. */
  inSeq: number;
  inT: number;
  /** Frame pacing: seconds since the last painted frame. */
  sincePaint: number;
  /** The size last painted, so a paused glow repaints after a resize. */
  paintedW: number;
  paintedH: number;
  /** The config version last painted, so a paused glow repaints only when a prop changes. */
  paintedVersion: number;
}

export interface GlowFrame {
  opacity: number;
  glow: number;
  /** Height and width multipliers (the web's --vb-h / --vb-w). */
  h: number;
  w: number;
  /** Where the beam sits, px from centre, and how far it is lifted along a corner. */
  cx: number;
  cy: number;
  /** Mask width while gathered. */
  mw: number;
  /** The bend: extra ceiling height at the centre, px, and its 0–1 strength. */
  lift: number;
  bendA: number;
  level: number;
  /** How far the lobes are gathered into a beam, 0–1. */
  corner: number;
  /** Hue drift, degrees. */
  hue: number;
  /** Displacement scale for the distortion, px. */
  displace: number;
  noiseDx: number;
  noiseDy: number;
  warpOff: boolean;
  lobeX: number[];
  lobeL: number[];
  lobeY: number[];
}

export function createEngineState(): EngineState {
  'worklet';
  return {
    level: 0,
    b0: 0,
    b1: 0,
    b2: 0,
    raw: 0,
    r0: 0,
    r1: 0,
    r2: 0,
    phase: 0,
    t: 0,
    warp: 1,
    mGather: 0,
    mOffset: 0,
    mStretch: 0,
    mHeld: 0,
    mCorner: 0,
    opacity: 0,
    fadeFrom: 0,
    fadeTo: -1,
    fadeT: 0,
    fadeDur: 0,
    fadeNotified: true,
    inSeq: -1,
    inT: 0,
    sincePaint: 1,
    paintedVersion: -1,
    paintedW: 0,
    paintedH: 0,
  };
}

export function createFrame(): GlowFrame {
  'worklet';
  return {
    opacity: 0,
    glow: 0.4,
    h: 0.8,
    w: 1,
    cx: 0,
    cy: 0,
    mw: 1,
    lift: 0,
    bendA: 0,
    level: 0,
    corner: 0,
    hue: 0,
    displace: 0,
    noiseDx: 0,
    noiseDy: 0,
    warpOff: false,
    lobeX: [0, 0, 0, 0, 0, 0, 0],
    lobeL: [1, 1, 1, 1, 1, 1, 1],
    lobeY: [0, 0, 0, 0, 0, 0, 0],
  };
}

// Gain applied before `sensitivity`: a phone microphone at conversational
// distance gives an RMS of roughly 0.03–0.2, which this lifts into the
// 0.15–1 range the shaping curve expects.
const BASE_GAIN = 5;
const BAND_GAIN = 1.7;
const TWO_PI = Math.PI * 2;
const WARP_OUT_TAU = 0.06;
const WARP_IN_TAU = 0.35;
const WARP_OFF_BELOW = 0.03;
const FADE_IN = 0.6;
const FADE_OUT = 0.5;

export const CEILING_HALF_WIDTH = 170;
export const CEILING_HEIGHT = 64;
export const BAND_SAMPLES = 56;

export function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wrap a lobe offset into [-span/2, span/2). */
function wrapX(x: number, span: number): number {
  'worklet';
  const half = span / 2;
  return ((((x + half) % span) + span) % span) - half;
}

/** How much of a lobe shows at offset x: full at centre, gone at the wrap edge. */
function edgeEnvelope(x: number, span: number): number {
  'worklet';
  const t = x / (span / 2 + 4);
  return Math.max(0, 1 - t * t);
}

/** Noise gate then soft saturation, so a shout rounds off instead of clipping. */
function shape(raw: number, threshold: number): number {
  'worklet';
  if (raw <= threshold) return 0;
  const t = (raw - threshold) / Math.max(0.001, 1 - threshold);
  return clamp01((1 - Math.exp(-3 * t)) / (1 - Math.exp(-3)));
}

/** One-pole follower: fast up (attack), slow down (release). */
function follow(prev: number, target: number, dt: number, attack: number, release: number): number {
  'worklet';
  const tau = target > prev ? attack : release;
  const a = 1 - Math.exp(-dt / Math.max(0.001, tau));
  return prev + (target - prev) * a;
}

function pingPong(phase: number): number {
  'worklet';
  return (1 - Math.cos(TWO_PI * phase)) / 2;
}

/** CSS `ease`, cubic-bezier(0.25, 0.1, 0.25, 1). */
function ease(p: number): number {
  'worklet';
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const x1 = 0.25;
  const y1 = 0.1;
  const x2 = 0.25;
  const y2 = 1;
  // Solve x(u) = p for u by Newton's method, then evaluate y(u).
  let u = p;
  for (let i = 0; i < 6; i++) {
    const x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u - p;
    const dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
  }
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
}

/** The corner radius the element actually paints: clamped to half the box. */
export function paintedRadius(radius: number, cw: number, ch: number): number {
  'worklet';
  return Math.max(0, Math.min(radius, cw / 2, ch / 2));
}

/** How far above the bottom edge the element's outline sits at `x`. */
function cornerLift(x: number, cw: number, radius: number, influence: number): number {
  'worklet';
  if (radius <= 0) return 0;
  const d = Math.min(x, cw - x) - influence;
  if (d >= radius) return 0;
  if (d <= 0) return radius;
  const dx = radius - d;
  return radius - Math.sqrt(Math.max(0, radius * radius - dx * dx));
}

/**
 * Advance the engine by `frameDt` seconds and write the frame. Returns 1
 * when a fade-in has just completed, 2 when a fade-out has, else 0.
 */
export function stepGlow(
  s: EngineState,
  f: GlowFrame,
  cfg: GlowConfig,
  input: VoiceInputFrame | null,
  motion: VoiceGlowMotion | null,
  frameDt: number,
  cw: number,
  ch: number
): number {
  'worklet';
  let event = 0;
  const paused = cfg.paused;
  const dt = paused ? 0 : Math.min(0.05, Math.max(0, frameDt));
  s.t += dt;
  const t = s.t;
  const reduced = cfg.reducedMotion;

  // ── Fade in / out ───────────────────────────────────────────────────
  const fadeTarget = cfg.active ? 1 : 0;
  if (s.fadeTo === -1 && fadeTarget === 0) {
    // Mounted switched off: stay invisible without reporting a fade-out.
    s.fadeTo = 0;
    s.opacity = 0;
  }
  if (fadeTarget !== s.fadeTo) {
    s.fadeFrom = s.opacity;
    s.fadeTo = fadeTarget;
    s.fadeT = 0;
    s.fadeDur = fadeTarget ? FADE_IN : FADE_OUT;
    s.fadeNotified = false;
  }
  if (s.fadeT < s.fadeDur) {
    s.fadeT = Math.min(s.fadeDur, s.fadeT + dt);
    s.opacity = s.fadeFrom + (s.fadeTo - s.fadeFrom) * ease(s.fadeT / s.fadeDur);
  }
  if (!s.fadeNotified && s.fadeT >= s.fadeDur) {
    s.fadeNotified = true;
    s.opacity = s.fadeTo;
    event = s.fadeTo ? 1 : 2;
  }

  // ── Raw level and bands from the source ─────────────────────────────
  if (!paused) {
    const kind = input ? input.kind : 0;
    const value = input ? input.level : 0;
    if (kind === 2 && input) {
      let level = value;
      let low = input.low;
      let mid = input.mid;
      let high = input.high;
      const readings = input.readings;
      if (readings && readings.length >= 4) {
        // Play a batch of readings back at the rate they were analysed.
        if (input.seq !== s.inSeq) {
          s.inSeq = input.seq ?? -1;
          s.inT = 0;
        } else {
          s.inT += dt;
        }
        const k = Math.min(readings.length / 4 - 1, Math.floor(s.inT * 60)) * 4;
        level = readings[k];
        low = readings[k + 1];
        mid = readings[k + 2];
        high = readings[k + 3];
      }
      s.raw = level * BASE_GAIN * cfg.sensitivity;
      s.r0 = low * BAND_GAIN * cfg.sensitivity;
      s.r1 = mid * BAND_GAIN * cfg.sensitivity;
      s.r2 = high * BAND_GAIN * cfg.sensitivity;
    } else {
      // No spectrum to read, so give the bands a little independent life:
      // slow, out-of-phase wobbles scaled by the level.
      const raw = kind === 1 ? value * BASE_GAIN * cfg.sensitivity : clamp01(value);
      const r = clamp01(raw);
      s.raw = raw;
      s.r0 = r;
      s.r1 = r * (0.72 + 0.28 * Math.sin(t * 9.1));
      s.r2 = r * (0.6 + 0.4 * Math.sin(t * 13.7 + 2));
    }
  }

  // ── Shape and follow ────────────────────────────────────────────────
  s.level = follow(s.level, shape(s.raw, cfg.threshold), dt, cfg.attack, cfg.release);
  const bandThreshold = cfg.threshold * 0.6;
  const bandRelease = cfg.release * 1.15;
  s.b0 = follow(s.b0, shape(s.r0, bandThreshold), dt, cfg.attack, bandRelease);
  s.b1 = follow(s.b1, shape(s.r1, bandThreshold), dt, cfg.attack, bandRelease);
  s.b2 = follow(s.b2, shape(s.r2, bandThreshold), dt, cfg.attack, bandRelease);

  // ── Motion: the lobes gathered into one beam, and where it sits ─────
  const span = LOBE_SPAN * cfg.lobeSpacing;
  if (!paused) {
    if (motion) {
      s.mGather = clamp01(motion.gather);
      s.mOffset = motion.offset ?? 0;
      s.mStretch = clamp01(motion.stretch ?? 0);
      s.mHeld = clamp01(motion.heldLevel ?? 0);
      s.mCorner = clamp01(motion.cornerFollow ?? 0);
    } else {
      s.mGather = 0;
      s.mOffset = 0;
      s.mStretch = 0;
      s.mHeld = 0;
      s.mCorner = 0;
    }
  }
  const morph = s.mGather;
  const cx = reduced ? 0 : (s.mOffset * span) / 2;
  const gather = 1 - morph * 0.6;
  const maskWidth = 1 - morph * 0.45;
  const passWidth = 1 + morph * 0.3 * s.mStretch;

  // ── Idle breathing folded under the voice ───────────────────────────
  const breathe = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((TWO_PI * t) / cfg.breatheDuration);
  const voiced = s.level + (1 - s.level) * cfg.idle * breathe;
  const heldT = clamp01((morph - 0.25) / 0.75);
  const held = heldT * heldT * (3 - 2 * heldT);
  const eff = Math.max(voiced, s.mHeld * held);

  const glow = 0.15 + 0.85 * eff;
  const h = 0.5 + cfg.reach * eff;
  const w = (0.85 + cfg.spread * eff) * passWidth;

  // ── Flow: the spectrum slides sideways as the voice comes in ────────
  if (cfg.flow !== 0 && !reduced) {
    s.phase = (((s.phase + cfg.flow * eff * dt) % span) + span) % span;
  }

  // ── Bend: the glow's ceiling humps up at the centre ─────────────────
  const lift = cfg.bend * eff;
  const bendA = cfg.bend > 0 ? Math.min(1, lift / cfg.bend) : 0;

  const beamAbsX = cw / 2 + cx * w;
  const lobeReach = 30 * cfg.scale * w;
  const arcRadius = paintedRadius(cfg.radius, cw, ch);
  const cornerBlend = morph * s.mCorner;

  // ── Distortion share ────────────────────────────────────────────────
  s.warp = follow(s.warp, morph > 0.02 ? 0 : 1, dt, WARP_IN_TAU, WARP_OUT_TAU);

  f.opacity = s.opacity;
  f.glow = glow;
  f.h = h;
  f.w = w;
  f.cx = cx;
  f.cy = -cornerLift(beamAbsX, cw, arcRadius, lobeReach * 1.4) * cornerBlend;
  f.mw = maskWidth;
  f.lift = Math.max(0, lift);
  f.bendA = bendA;
  f.level = s.level;
  f.corner = morph;
  f.warpOff = cfg.distortion > 0 && s.warp < WARP_OFF_BELOW;
  f.displace = reduced ? 0 : cfg.distortion * 120 * cfg.scale * (0.15 + 0.85 * eff) * s.warp;
  f.noiseDx = 8 * cfg.scale * Math.sin(t * 0.9);
  f.noiseDy = 4 * cfg.scale * Math.sin(t * 0.6 + 1.3);

  // Each lobe: its offset along the flow, and its amplitude. The band it
  // follows lifts it between 0.6× and 1.3× of the shared height, and the
  // edge envelope fades it out toward the wrap.
  for (let i = 0; i < LOBE_COUNT; i++) {
    const x = wrapX(LOBE_X[i] * cfg.lobeSpacing + s.phase, span);
    const band = LOBE_BAND[i];
    const bandLevel = band === 0 ? s.b0 : band === 1 ? s.b1 : s.b2;
    const bandLift = cfg.bands ? 0.6 + 0.7 * bandLevel : 1;
    f.lobeX[i] = x * gather;
    f.lobeL[i] = bandLift * edgeEnvelope(x, span);
    const lobeAbsX = cw / 2 + (cx + x * gather) * w;
    f.lobeY[i] = -cornerLift(lobeAbsX, cw, arcRadius, lobeReach) * cornerBlend;
  }

  // ── Hue drift ───────────────────────────────────────────────────────
  f.hue =
    cfg.staticColors || reduced || cfg.hueRange === 0
      ? 0
      : -cfg.hueRange + 2 * cfg.hueRange * pingPong(t / cfg.hueDuration);

  return event;
}

/**
 * The band's bell, 1 at the centre and exactly 0 at the ends:
 * exp(-(|t| / σ)^p) with the tail value subtracted out.
 */
function bell(t: number, p: number, sigma: number, skew: number): number {
  'worklet';
  const side = t < 0 ? 1 - skew : 1 + skew;
  const s = Math.max(0.05, sigma * side);
  const v = Math.exp(-Math.pow(Math.abs(t) / s, p));
  const tail = Math.exp(-Math.pow(1 / s, p));
  return Math.max(0, (v - tail) / (1 - tail));
}

/** The band's rise again toward the corners. */
function tailLift(dist: number, edge: number, lift: number, position: number, curve: number): number {
  'worklet';
  if (lift <= 0 || edge <= 0) return 0;
  const start = edge * Math.max(0, Math.min(0.98, position));
  if (dist <= start) return 0;
  const u = Math.min(1, (dist - start) / Math.max(1, edge - start));
  return lift * Math.pow(u, Math.max(0.5, curve));
}

/**
 * The band line's points in element px, left to right, written into `out`
 * as [x0, y0, x1, y1, …] (BAND_SAMPLES + 1 points).
 */
export function bandPoints(cfg: GlowConfig, f: GlowFrame, cw: number, ch: number, out: number[]): void {
  'worklet';
  const centre = cw / 2 + f.cx * f.w;
  const half = CEILING_HALF_WIDTH * cfg.rangeWidth * f.w * f.mw;
  const apexCap = ch * 0.82 * Math.min(1, cfg.scale);
  const apex = Math.min(apexCap, (CEILING_HEIGHT * cfg.rangeHeight * f.h + f.lift) * cfg.bandPosition);
  const base = ch - cfg.bandOffset;
  const tailT = Math.min(1, f.corner * 4);
  const tail = cfg.bandTail * (1 - tailT * tailT * (3 - 2 * tailT));
  const withTail = tail > 0.001;
  const over = withTail ? cfg.bandTailOverflow : 0;
  const x0 = withTail ? -over : centre - half;
  const x1 = withTail ? cw + over : centre + half;
  const radius = paintedRadius(cfg.radius, cw, ch);
  for (let i = 0; i <= BAND_SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / BAND_SAMPLES;
    const tt = Math.max(-1, Math.min(1, (x - centre) / Math.max(1, half)));
    const edge = (x < centre ? centre : cw - centre) + over;
    const y =
      bell(tt, cfg.bandCurve, cfg.bandSpread, cfg.bandSkew) +
      tailLift(Math.abs(x - centre), edge, tail, cfg.bandTailPosition, cfg.bandTailCurve);
    const arc = f.corner > 0 ? cornerLift(x, cw, radius, 0) * f.corner : 0;
    out[i * 2] = x;
    out[i * 2 + 1] = base - apex * y - arc;
  }
}
