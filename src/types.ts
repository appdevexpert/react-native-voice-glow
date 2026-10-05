import type { ReactNode } from 'react';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import type { RGB, VoiceGlowColorVariant, VoiceGlowType } from './constants';

export type { VoiceGlowColorVariant, VoiceGlowType, RGB };

export type VoiceGlowTheme = 'dark' | 'light' | 'auto';

/**
 * One reading of the audio, written from the JS thread and read by the glow
 * on the UI thread.
 *
 * - `kind: 0`: a manual level, already 0–1. No gain is applied.
 * - `kind: 1`: a raw RMS amplitude (0–1 full scale) with no spectrum; the
 *   glow applies its gain and synthesises the three bands from it.
 * - `kind: 2`: a raw RMS amplitude plus the low / mid / high band energy
 *   (0–1, the mean of the analyser's byte spectrum over each band).
 */
export interface VoiceInputFrame {
  kind: 0 | 1 | 2;
  level: number;
  low: number;
  mid: number;
  high: number;
}

/** A live audio source for `<VoiceGlow source={…}>`. */
export interface VoiceSource {
  readonly input: SharedValue<VoiceInputFrame>;
}

/**
 * The glow's large-scale motion for one frame: how far the lobes are
 * gathered into one compact beam (0 the voice glow, 1 fully gathered),
 * where that beam sits (in half-widths of the lobe ring), how much wider it
 * runs while moving, the level it is held at, and how much it rides the
 * corner arcs.
 */
export interface VoiceGlowMotion {
  gather: number;
  offset?: number;
  stretch?: number;
  heldLevel?: number;
  cornerFollow?: number;
}

export interface VoiceGlowBandColors {
  core?: string;
  above?: string;
  mid?: string;
  below?: string;
}

export interface VoiceGlowProps extends Omit<ViewProps, 'children' | 'style'> {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Host preset; sets the geometry defaults. */
  type?: VoiceGlowType;
  /** Size of the whole effect: every px dimension at once. */
  scale?: number;
  /** Live audio to react to (from `useMicrophone` or `useVoiceInput`); wins over `level`. */
  source?: VoiceSource | null;
  /** Manual drive, 0–1. A shared value is sampled every frame on the UI thread. */
  level?: number | SharedValue<number>;
  /** Input gain on analysed audio. */
  sensitivity?: number;
  /** Noise gate, 0–1. */
  threshold?: number;
  /** Seconds to rise toward a louder level. */
  attack?: number;
  /** Seconds to settle after the sound drops. */
  release?: number;
  /** Resting presence while silent, 0–1. */
  idle?: number;
  /** Period of the idle breathing, seconds. */
  breatheDuration?: number;
  /** Height gain at full level. */
  reach?: number;
  /** Width gain at full level. */
  spread?: number;
  /** Let the frequency bands move the lobes independently. */
  bands?: boolean;
  /** Sideways travel of the spectrum, px/s at full level; negative reverses, 0 holds. */
  flow?: number;
  /** The glow gathered into a beam and where it sits. */
  motion?: VoiceGlowMotion | SharedValue<VoiceGlowMotion | null> | null;
  colorVariant?: VoiceGlowColorVariant;
  /** Up to 7 lobe colours overriding the palette (centre first, then pairs outward). */
  colors?: string[];
  /** The band's ridge and fringe colours. */
  bandColors?: VoiceGlowBandColors;
  theme?: VoiceGlowTheme;
  /** Disable the hue drift. */
  staticColors?: boolean;
  /** Hue drift range in degrees. */
  hueRange?: number;
  /** Hue drift period in seconds. */
  hueDuration?: number;
  /** Whether the effect is on. Turning it off fades the glow out. */
  active?: boolean;
  /** Freezes the effect in place without fading it out. */
  paused?: boolean;
  /** Corner radius in px. Read from the child's style when omitted. */
  borderRadius?: number;
  brightness?: number;
  saturation?: number;
  /** Multiplies the bloom blur radius. */
  glowSize?: number;
  strokeOpacity?: number;
  innerOpacity?: number;
  bloomOpacity?: number;
  /** Px the glow's top contour humps up at the centre at full level. */
  bend?: number;
  bandStrength?: number;
  bandWidth?: number;
  bandPosition?: number;
  bandCurve?: number;
  bandSpread?: number;
  bandSkew?: number;
  bandOffset?: number;
  bandTail?: number;
  bandTailPosition?: number;
  bandTailCurve?: number;
  bandTailOverflow?: number;
  bandAberration?: number;
  /** Horizontal warp of the glow under the band, 0–1; 0 turns the filter off. */
  distortion?: number;
  distortionDetail?: number;
  glowWidth?: number;
  glowHeight?: number;
  lobeSpacing?: number;
  rangeWidth?: number;
  rangeHeight?: number;
  softness?: number;
  coreSize?: number;
  coreLight?: number;
  coreLightWidth?: number;
  coreLightHeight?: number;
  strokeScale?: number;
  innerScale?: number;
  innerHeight?: number;
  bloomScale?: number;
  bloomHeight?: number;
  /** Effect opacity (0–1), glow layers only, never the children. */
  strength?: number;
  /** Written every frame on the UI thread with the smoothed 0–1 level. */
  levelValue?: SharedValue<number>;
  /** Called on the JS thread every frame with the smoothed level. Prefer `levelValue`. */
  onLevel?: (level: number) => void;
  /** Called when the fade-in completes. */
  onActivate?: () => void;
  /** Called when the fade-out completes. */
  onDeactivate?: () => void;
}

/**
 * Everything the UI-thread engine and painter need, as plain numbers.
 * Built on the JS thread from the props; rebuilt only when a prop changes.
 */
export interface GlowConfig {
  version: number;
  dark: boolean;
  mono: boolean;
  // Response
  sensitivity: number;
  threshold: number;
  attack: number;
  release: number;
  idle: number;
  breatheDuration: number;
  reach: number;
  spread: number;
  bands: boolean;
  flow: number;
  lobeSpacing: number;
  bend: number;
  // Band
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
  bandCore: RGB;
  bandAbove: RGB;
  bandMid: RGB;
  bandBelow: RGB;
  // Ceiling, distortion, epicentre
  rangeWidth: number;
  rangeHeight: number;
  distortion: number;
  distortionDetail: number;
  coreLight: number;
  coreLightWidth: number;
  coreLightHeight: number;
  scale: number;
  /** Corner radius, px (not yet clamped to the box). */
  radius: number;
  // Colour
  hueRange: number;
  hueDuration: number;
  hueBase: number;
  staticColors: boolean;
  colors: RGB[];
  brightness: number;
  saturation: number;
  strength: number;
  // State
  reducedMotion: boolean;
  paused: boolean;
  active: boolean;
  // Layers
  strokeOpacity: number;
  innerOpacity: number;
  bloomOpacity: number;
  innerShadow: [number, number, number, number];
  /** Bloom blur sigma, px. */
  bloomBlur: number;
  /** Epicentre blur sigma, px. */
  coreBlur: number;
  glowWidth: number;
  glowHeight: number;
  strokeScale: number;
  innerScale: number;
  innerHeight: number;
  bloomScale: number;
  bloomHeight: number;
  coreSize: number;
  /** Where each lobe's gradient fades out, percent of its radius. */
  fade: number;
}
