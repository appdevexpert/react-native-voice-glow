import {
  BAND_COLORS,
  PALETTES,
  THEME_PRESETS,
  resolveTypeStyle,
  resolveVoiceDefaults,
  type RGB,
} from './constants';
import type { GlowConfig, VoiceGlowProps } from './types';

/**
 * `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)` and `rgba(r, g, b, a)`
 * resolve to an [r, g, b] triple; anything else returns null and the caller
 * keeps its default.
 */
export function parseRgb(color: string | undefined | null): RGB | null {
  if (!color) return null;
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((ch) => ch + ch).join('') : hex[1].slice(0, 6);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const fn = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (fn) return [Math.round(+fn[1]), Math.round(+fn[2]), Math.round(+fn[3])];
  return null;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Scales a tuned blur radius, kept above 0 so a layer never collapses to a hard edge. */
function scaleBlur(px: number, glowSize: number): number {
  return Math.max(0.5, Math.round(px * glowSize * 100) / 100);
}

export interface ResolveOptions {
  theme: 'dark' | 'light';
  reducedMotion: boolean;
  radius: number;
  version: number;
}

/**
 * Resolve the props into the plain config the UI thread runs on. Follows the
 * same precedence as the web component: an explicit prop wins over the type
 * preset, which wins over the theme preset; `scale` multiplies every px
 * dimension afterwards.
 */
export function resolveGlowConfig(props: VoiceGlowProps, opts: ResolveOptions): GlowConfig {
  const { theme, reducedMotion, radius, version } = opts;
  const type = props.type ?? 'default';
  const dark = theme === 'dark';
  const d = resolveVoiceDefaults(type, theme);
  const preset = THEME_PRESETS[theme];
  const typeStyle = resolveTypeStyle(type, theme);
  const colorVariant = props.colorVariant ?? 'colorful';
  const mono = colorVariant === 'mono';

  const sc = Math.max(0.05, props.scale ?? d.scale);
  const glowSize = (props.glowSize ?? d.glowSize) * sc;

  const palette = PALETTES[colorVariant][dark ? 'dark' : 'light'];
  const colors = palette.map((c, i) => parseRgb(props.colors?.[i]) ?? c);
  const defaultBand = BAND_COLORS[theme];
  const bc = props.bandColors;

  const monoMul = mono ? 0.6 : 1;
  const softness = props.softness ?? d.softness;

  return {
    version,
    dark,
    mono,
    sensitivity: Math.max(0, props.sensitivity ?? 3.1),
    threshold: clamp(props.threshold ?? 0.015, 0, 0.95),
    attack: Math.max(0, props.attack ?? 0.325),
    release: Math.max(0, props.release ?? 0.86),
    idle: clamp(props.idle ?? d.idle, 0, 1),
    breatheDuration: Math.max(0.2, props.breatheDuration ?? 5.2),
    reach: Math.max(0, props.reach ?? d.reach),
    spread: Math.max(0, props.spread ?? d.spread),
    bands: props.bands ?? true,
    flow: (props.flow ?? d.flow) * sc,
    lobeSpacing: Math.max(0.1, (props.lobeSpacing ?? d.lobeSpacing) * sc),
    bend: Math.max(0, (props.bend ?? d.bend) * sc),

    bandStrength: Math.max(0, props.bandStrength ?? d.bandStrength),
    bandWidth: Math.max(0, (props.bandWidth ?? d.bandWidth) * sc),
    bandPosition: Math.max(0, props.bandPosition ?? d.bandPosition),
    bandCurve: Math.max(0.3, props.bandCurve ?? d.bandCurve),
    bandSpread: Math.max(0.05, props.bandSpread ?? d.bandSpread),
    bandSkew: clamp(props.bandSkew ?? d.bandSkew, -0.9, 0.9),
    bandOffset: (props.bandOffset ?? d.bandOffset) * sc,
    bandTail: clamp(props.bandTail ?? d.bandTail, 0, 1.5),
    bandTailPosition: clamp(props.bandTailPosition ?? d.bandTailPosition, 0, 0.98),
    bandTailCurve: Math.max(0.5, props.bandTailCurve ?? d.bandTailCurve),
    bandTailOverflow: Math.max(0, (props.bandTailOverflow ?? d.bandTailOverflow) * sc),
    bandAberration: clamp(props.bandAberration ?? d.bandAberration, 0, 1),
    bandCore: parseRgb(bc?.core) ?? defaultBand.core,
    bandAbove: parseRgb(bc?.above) ?? defaultBand.above,
    bandMid: parseRgb(bc?.mid) ?? defaultBand.mid,
    bandBelow: parseRgb(bc?.below) ?? defaultBand.below,

    rangeWidth: (props.rangeWidth ?? d.rangeWidth) * sc,
    rangeHeight: (props.rangeHeight ?? d.rangeHeight) * sc,
    distortion: clamp(props.distortion ?? d.distortion, 0, 1),
    distortionDetail: (props.distortionDetail ?? d.distortionDetail) / sc,
    coreLight: clamp(props.coreLight ?? d.coreLight, 0, 3),
    coreLightWidth: props.coreLightWidth ?? d.coreLightWidth,
    coreLightHeight: props.coreLightHeight ?? d.coreLightHeight,
    scale: sc,
    radius,

    hueRange: Math.max(0, props.hueRange ?? preset.hueRange ?? 24),
    hueDuration: Math.max(0.5, props.hueDuration ?? preset.hueDuration ?? 12),
    hueBase: preset.hueBase ?? 0,
    staticColors: mono ? true : props.staticColors ?? false,
    colors,
    brightness: props.brightness ?? typeStyle.brightness ?? preset.brightness,
    saturation: props.saturation ?? typeStyle.saturation ?? preset.saturation,
    strength: clamp(props.strength ?? typeStyle.strength ?? preset.strength ?? 1, 0, 1),

    reducedMotion,
    paused: props.paused ?? false,
    active: props.active ?? true,

    strokeOpacity: preset.strokeOpacity * (props.strokeOpacity ?? d.strokeOpacity) * monoMul,
    innerOpacity: preset.innerOpacity * (props.innerOpacity ?? d.innerOpacity) * monoMul,
    bloomOpacity: preset.bloomOpacity * (props.bloomOpacity ?? d.bloomOpacity) * monoMul,
    innerShadow: preset.innerShadow,
    bloomBlur: scaleBlur(10, glowSize),
    coreBlur: scaleBlur(8, glowSize),
    glowWidth: (props.glowWidth ?? d.glowWidth) * sc,
    glowHeight: (props.glowHeight ?? d.glowHeight) * sc,
    strokeScale: props.strokeScale ?? d.strokeScale,
    innerScale: props.innerScale ?? d.innerScale,
    innerHeight: props.innerHeight ?? d.innerHeight,
    bloomScale: props.bloomScale ?? d.bloomScale,
    bloomHeight: props.bloomHeight ?? d.bloomHeight,
    coreSize: (props.coreSize ?? d.coreSize) * sc,
    fade: Math.round(clamp(70 * softness, 40, 95)),
  };
}
