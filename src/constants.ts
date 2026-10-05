/**
 * Tuned constants for the glow: lobe geometry, palettes, theme presets and
 * per-type presets.
 *
 * These values are ported from `voice-glow` by Jakub Antalik
 * (https://github.com/Jakubantalik/Libraries.dev, MIT licensed) so the
 * React Native glow reads the same as the web one. See LICENSE.
 */

export type VoiceGlowColorVariant =
  | 'colorful'
  | 'mono'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'candy'
  | 'ice'
  | 'gold';

export type VoiceGlowType = 'default' | 'pill' | 'mobile';

export type RGB = [number, number, number];

/**
 * Lobe geometry, in px for a ~350px-wide reference element. Seven soft
 * ellipses fan out from the bottom centre: the centre lobe follows the low
 * band, its neighbours the mids, the outer pair the highs and the far pair
 * the mids again, so a voice makes the colours ripple outward.
 */
export const LOBE_X = [0, -36, 36, -72, 72, -108, 108];
export const LOBE_W = [74, 54, 54, 48, 48, 42, 42];
export const LOBE_H = [46, 40, 40, 32, 32, 26, 26];
export const LOBE_BAND = [0, 1, 1, 2, 2, 1, 1];
export const LOBE_COUNT = 7;

/** Resting distance between neighbouring lobes, px. */
export const LOBE_SPACING = 36;
/** Width of the ring the lobes travel around, px: one full turn of the flow. */
export const LOBE_SPAN = LOBE_SPACING * LOBE_COUNT;

/** Seven colours per palette, one per lobe (centre first, then pairs). */
export const PALETTES: Record<VoiceGlowColorVariant, { dark: RGB[]; light: RGB[] }> = {
  colorful: {
    dark: [
      [255, 70, 120],
      [60, 190, 255],
      [175, 70, 255],
      [60, 220, 130],
      [255, 150, 40],
      [90, 100, 255],
      [40, 200, 190],
    ],
    light: [
      [255, 201, 21],
      [126, 196, 255],
      [180, 40, 230],
      [235, 100, 160],
      [255, 176, 122],
      [154, 160, 255],
      [127, 217, 238],
    ],
  },
  mono: {
    dark: [
      [215, 215, 215],
      [180, 180, 180],
      [190, 190, 190],
      [160, 160, 160],
      [170, 170, 170],
      [150, 150, 150],
      [155, 155, 155],
    ],
    light: [
      [60, 60, 60],
      [90, 90, 90],
      [85, 85, 85],
      [110, 110, 110],
      [105, 105, 105],
      [125, 125, 125],
      [120, 120, 120],
    ],
  },
  ocean: {
    dark: [
      [80, 140, 255],
      [40, 200, 230],
      [120, 90, 255],
      [30, 170, 210],
      [160, 80, 240],
      [60, 110, 255],
      [40, 190, 180],
    ],
    light: [
      [40, 100, 240],
      [20, 160, 200],
      [90, 60, 230],
      [20, 130, 180],
      [130, 50, 220],
      [40, 80, 230],
      [20, 150, 150],
    ],
  },
  sunset: {
    dark: [
      [255, 110, 60],
      [255, 180, 40],
      [255, 60, 90],
      [255, 210, 80],
      [240, 70, 140],
      [255, 140, 50],
      [230, 50, 110],
    ],
    light: [
      [235, 80, 30],
      [230, 150, 10],
      [230, 30, 70],
      [225, 175, 30],
      [215, 40, 110],
      [235, 110, 20],
      [205, 30, 90],
    ],
  },
  forest: {
    dark: [
      [70, 220, 120],
      [40, 200, 180],
      [140, 230, 80],
      [30, 170, 140],
      [190, 235, 70],
      [50, 190, 110],
      [30, 150, 120],
    ],
    light: [
      [30, 170, 80],
      [20, 150, 130],
      [90, 180, 30],
      [20, 130, 100],
      [130, 180, 20],
      [30, 150, 80],
      [20, 120, 90],
    ],
  },
  candy: {
    dark: [
      [255, 90, 170],
      [255, 120, 220],
      [210, 80, 255],
      [255, 150, 190],
      [180, 110, 255],
      [255, 70, 140],
      [230, 100, 240],
    ],
    light: [
      [235, 40, 140],
      [230, 70, 190],
      [180, 40, 230],
      [235, 100, 160],
      [150, 70, 230],
      [230, 30, 110],
      [200, 60, 210],
    ],
  },
  ice: {
    dark: [
      [150, 230, 255],
      [90, 200, 255],
      [190, 240, 255],
      [120, 190, 255],
      [160, 220, 250],
      [80, 170, 255],
      [200, 235, 255],
    ],
    light: [
      [30, 160, 220],
      [20, 130, 210],
      [60, 180, 230],
      [40, 120, 220],
      [50, 160, 220],
      [20, 110, 220],
      [70, 170, 230],
    ],
  },
  gold: {
    dark: [
      [255, 200, 70],
      [255, 170, 40],
      [255, 220, 110],
      [240, 150, 30],
      [255, 235, 140],
      [230, 160, 40],
      [250, 210, 90],
    ],
    light: [
      [200, 140, 10],
      [190, 120, 0],
      [210, 160, 30],
      [180, 110, 0],
      [205, 170, 40],
      [175, 115, 5],
      [195, 150, 20],
    ],
  },
};

/** Band colour defaults per theme: the ridge core and its three fringes. */
export const BAND_COLORS: Record<'dark' | 'light', { core: RGB; above: RGB; mid: RGB; below: RGB }> = {
  dark: { core: [255, 255, 255], above: [255, 70, 80], mid: [90, 255, 150], below: [80, 140, 255] },
  light: { core: [197, 139, 255], above: [255, 122, 182], mid: [126, 196, 255], below: [45, 255, 171] },
};

export interface ThemePreset {
  strokeOpacity: number;
  innerOpacity: number;
  bloomOpacity: number;
  /** rgba of the faint inset rim, 0–255 rgb and 0–1 alpha. */
  innerShadow: [number, number, number, number];
  saturation: number;
  brightness: number;
  hueRange?: number;
  hueDuration?: number;
  hueBase?: number;
  strength?: number;
  bandStrength?: number;
}

export const THEME_PRESETS: Record<'dark' | 'light', ThemePreset> = {
  dark: {
    strokeOpacity: 1.16,
    innerOpacity: 0.47,
    bloomOpacity: 0.89,
    innerShadow: [255, 255, 255, 0.1],
    saturation: 1.2,
    brightness: 1.1,
  },
  light: {
    strokeOpacity: 1.2,
    innerOpacity: 0.85,
    bloomOpacity: 0.5,
    innerShadow: [0, 0, 0, 0.08],
    saturation: 1.6,
    brightness: 0.95,
    hueRange: 40,
    hueDuration: 8.5,
    hueBase: 5,
    strength: 0.8,
    bandStrength: 1.7,
  },
};

/** The geometry and response knobs a `type` preset may retune. */
export interface VoiceGeometry {
  scale: number;
  glowSize: number;
  strokeOpacity: number;
  innerOpacity: number;
  bloomOpacity: number;
  idle: number;
  reach: number;
  spread: number;
  flow: number;
  bend: number;
  bandStrength: number;
  bandWidth: number;
  bandPosition: number;
  bandCurve: number;
  bandSpread: number;
  bandSkew: number;
  bandOffset: number;
  bandTail: number;
  bandTailPosition: number;
  bandTailCurve: number;
  bandTailOverflow: number;
  bandAberration: number;
  distortion: number;
  distortionDetail: number;
  glowWidth: number;
  glowHeight: number;
  lobeSpacing: number;
  rangeWidth: number;
  rangeHeight: number;
  softness: number;
  coreSize: number;
  coreLight: number;
  coreLightWidth: number;
  coreLightHeight: number;
  strokeScale: number;
  innerScale: number;
  innerHeight: number;
  bloomScale: number;
  bloomHeight: number;
}

/** The tuned defaults: the `default` type, a ~350px chat input. */
export const VOICE_DEFAULTS: VoiceGeometry = {
  scale: 1,
  glowSize: 1,
  strokeOpacity: 1,
  innerOpacity: 1,
  bloomOpacity: 1,
  idle: 0.18,
  reach: 1.2,
  spread: 1.05,
  flow: 48,
  bend: 60,
  bandStrength: 1.55,
  bandWidth: 2.15,
  bandPosition: 0.35,
  bandCurve: 1.75,
  bandSpread: 0.87,
  bandSkew: 0.12,
  bandOffset: -27,
  bandTail: 0.59,
  bandTailPosition: 0.67,
  bandTailCurve: 2.4,
  bandTailOverflow: 15,
  bandAberration: 0.89,
  distortion: 0.62,
  distortionDetail: 2.3,
  glowWidth: 0.65,
  glowHeight: 1.25,
  lobeSpacing: 0.85,
  rangeWidth: 0.75,
  rangeHeight: 1,
  softness: 1.07,
  coreSize: 1,
  coreLight: 0,
  coreLightWidth: 1,
  coreLightHeight: 1,
  strokeScale: 1,
  innerScale: 1,
  innerHeight: 1,
  bloomScale: 1,
  bloomHeight: 1,
};

/**
 * Per-type overrides. `pill` is a ~150×44 recording pill, `mobile` the
 * bottom of a phone screen (~400px wide, tall).
 */
export const TYPE_PRESETS: Record<VoiceGlowType, Partial<VoiceGeometry>> = {
  default: {},
  pill: {
    scale: 0.45,
    glowSize: 0.95,
    strokeOpacity: 1.2,
    innerOpacity: 0.85,
    reach: 1.35,
    spread: 1.1,
    flow: 0,
    bend: 23,
    bandStrength: 1.55,
    bandWidth: 1.85,
    bandCurve: 1.95,
    bandSpread: 0.38,
    bandOffset: -16,
    bandTail: 0,
    distortion: 0.45,
    distortionDetail: 3,
    glowWidth: 0.65,
    glowHeight: 0.95,
    lobeSpacing: 0.45,
    rangeWidth: 0.8,
    rangeHeight: 0.7,
    softness: 0.88,
    coreSize: 0.25,
    strokeScale: 1.25,
    innerScale: 0.95,
    bloomScale: 1.05,
    bloomHeight: 2.25,
  },
  mobile: {
    scale: 1.25,
    spread: 0.45,
    reach: 3,
    flow: 60,
    bend: 70,
    bandWidth: 2.4,
    bandCurve: 1.55,
    bandSpread: 0.9,
    bandOffset: -50,
    bandTail: 0.62,
    bandTailPosition: 0.42,
    bandTailCurve: 2.7,
    bandTailOverflow: 22,
    bandStrength: 1.8,
    distortionDetail: 2,
    glowWidth: 1.15,
    glowHeight: 2.1,
    lobeSpacing: 1.35,
    rangeWidth: 1.25,
    rangeHeight: 1.2,
    softness: 1.1,
  },
};

export type VoiceTypeStyle = { brightness?: number; saturation?: number; strength?: number };

const TYPE_STYLE_DARK: Record<VoiceGlowType, VoiceTypeStyle> = {
  default: { brightness: 1.15 },
  pill: { brightness: 1.35, saturation: 1.5 },
  mobile: { strength: 1, brightness: 1.2, saturation: 1.5 },
};

const TYPE_STYLE_LIGHT: Record<VoiceGlowType, VoiceTypeStyle> = {
  default: {},
  pill: {},
  mobile: { strength: 1 },
};

/** The colour tuning for a type on a theme. */
export function resolveTypeStyle(type: VoiceGlowType, theme: 'dark' | 'light'): VoiceTypeStyle {
  return theme === 'light' ? TYPE_STYLE_LIGHT[type] : TYPE_STYLE_DARK[type];
}

const LIGHT_TYPE_OVERRIDES: Record<VoiceGlowType, Partial<VoiceGeometry>> = {
  default: { bandStrength: 1.7 },
  pill: { bandStrength: 2 },
  mobile: { bandStrength: 1.7 },
};

/** The full geometry for a type on a theme: defaults, theme, then type. */
export function resolveVoiceDefaults(type: VoiceGlowType = 'default', theme: 'dark' | 'light' = 'dark'): VoiceGeometry {
  const typePreset = TYPE_PRESETS[type];
  const themeOverrides: Partial<VoiceGeometry> = {};
  if (theme === 'light') {
    if (typePreset.reach === undefined) themeOverrides.reach = 1.8;
    if (typePreset.spread === undefined) themeOverrides.spread = 0.8;
    if (typePreset.coreLight === undefined) themeOverrides.coreLight = 1.8;
  }
  return {
    ...VOICE_DEFAULTS,
    ...themeOverrides,
    ...typePreset,
    ...(theme === 'light' ? LIGHT_TYPE_OVERRIDES[type] : undefined),
  };
}
