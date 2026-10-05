import { Canvas, Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import {
  isSharedValue,
  runOnJS,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { resolveGlowConfig } from './config';
import { BAND_SAMPLES, createEngineState, createFrame, stepGlow } from './engine';
import { useReduceMotionSetting, useResolvedTheme } from './hooks';
import { paintGlow } from './painter';
import type { GlowConfig, VoiceGlowMotion, VoiceGlowProps, VoiceInputFrame } from './types';

const DEFAULT_RADIUS = 16;
/** Frame pacing: a 120 Hz display would double the paint work for no visible gain. */
const MIN_FRAME_INTERVAL = 1 / 60 - 0.002;

/** Every prop that shapes the glow (and so the config); the rest go to the wrapper View. */
const CONFIG_KEYS = [
  'type', 'scale', 'sensitivity', 'threshold', 'attack', 'release', 'idle', 'breatheDuration', 'reach',
  'spread', 'bands', 'flow', 'colorVariant', 'colors', 'bandColors', 'staticColors', 'hueRange',
  'hueDuration', 'active', 'paused', 'brightness', 'saturation', 'glowSize', 'strokeOpacity', 'innerOpacity',
  'bloomOpacity', 'bend', 'bandStrength', 'bandWidth', 'bandPosition', 'bandCurve', 'bandSpread', 'bandSkew',
  'bandOffset', 'bandTail', 'bandTailPosition', 'bandTailCurve', 'bandTailOverflow', 'bandAberration',
  'distortion', 'distortionDetail', 'glowWidth', 'glowHeight', 'lobeSpacing', 'rangeWidth', 'rangeHeight',
  'softness', 'coreSize', 'coreLight', 'coreLightWidth', 'coreLightHeight', 'strokeScale', 'innerScale',
  'innerHeight', 'bloomScale', 'bloomHeight', 'strength',
] as const;
const CONFIG_KEY_SET: ReadonlySet<string> = new Set(CONFIG_KEYS);

/** The child's corner radius, when it sets one in its style. */
function childRadius(children: VoiceGlowProps['children']): number | undefined {
  const only = Children.toArray(children);
  if (only.length !== 1 || !isValidElement(only[0])) return undefined;
  const style = StyleSheet.flatten((only[0] as ReactElement<{ style?: ViewStyle }>).props.style);
  const r = style?.borderRadius;
  return typeof r === 'number' ? r : undefined;
}

function emptyPicture(): SkPicture {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
  return recorder.finishRecordingAsPicture();
}

/**
 * VoiceGlow: a sound-reactive glow for React Native.
 *
 * A centred, colourful beam along the bottom edge of the wrapped element
 * that rises and blooms with the level of a voice. Feed it a microphone
 * (`useMicrophone` from `react-native-voice-glow/expo` or `/audio-api`), any
 * PCM via `useVoiceInput`, or drive it yourself with `level`.
 *
 * Everything per-frame runs on the UI thread: the envelope, the motion and
 * the Skia drawing, so a busy JS thread does not stutter the glow.
 *
 * @example
 * const mic = useMicrophone();
 *
 * <VoiceGlow source={mic.source}>
 *   <ChatInput />
 * </VoiceGlow>
 */
export function VoiceGlow(props: VoiceGlowProps) {
  const {
    children,
    style,
    source = null,
    level = 0,
    motion = null,
    theme = 'dark',
    borderRadius,
    levelValue,
    onLevel,
    onActivate,
    onDeactivate,
    onLayout,
  } = props;

  const resolvedTheme = useResolvedTheme(theme);
  const reducedMotion = useReduceMotionSetting();
  const radius = borderRadius ?? childRadius(children) ?? DEFAULT_RADIUS;

  // The config is rebuilt only when a shaping prop actually changes value,
  // so a fresh array literal each render does not churn the UI thread.
  const configKey = JSON.stringify(CONFIG_KEYS.map((k) => (props as Record<string, unknown>)[k]));
  const versionRef = useRef(0);
  const config = useMemo<GlowConfig>(() => {
    versionRef.current += 1;
    return resolveGlowConfig(props, {
      theme: resolvedTheme,
      reducedMotion,
      radius,
      version: versionRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, resolvedTheme, reducedMotion, radius]);

  const viewProps = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (CONFIG_KEY_SET.has(k)) continue;
      if (
        k === 'children' || k === 'style' || k === 'source' || k === 'level' || k === 'motion' || k === 'theme' ||
        k === 'borderRadius' || k === 'levelValue' || k === 'onLevel' || k === 'onActivate' ||
        k === 'onDeactivate' || k === 'onLayout'
      ) {
        continue;
      }
      out[k] = v;
    }
    return out;
  }, [props]);

  // ── State shared with the UI thread ───────────────────────────────────
  const cfg = useSharedValue<GlowConfig>(config);
  useEffect(() => {
    cfg.value = config;
  }, [cfg, config]);

  const size = useSharedValue({ w: 0, h: 0 });
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      size.value = { w: width, h: height };
      onLayout?.(e);
    },
    [size, onLayout]
  );

  // A plain number is mirrored into a shared value; a shared value is read directly.
  const ownLevel = useSharedValue(typeof level === 'number' ? level : 0);
  useEffect(() => {
    if (typeof level === 'number') ownLevel.value = level;
  }, [level, ownLevel]);
  const levelSource: SharedValue<number> = isSharedValue(level) ? (level as SharedValue<number>) : ownLevel;

  const ownMotion = useSharedValue<VoiceGlowMotion | null>(isSharedValue(motion) ? null : (motion as VoiceGlowMotion | null));
  useEffect(() => {
    if (!isSharedValue(motion)) ownMotion.value = (motion as VoiceGlowMotion | null) ?? null;
  }, [motion, ownMotion]);
  const motionSource: SharedValue<VoiceGlowMotion | null> = isSharedValue(motion)
    ? (motion as SharedValue<VoiceGlowMotion | null>)
    : ownMotion;

  const input: SharedValue<VoiceInputFrame> | null = source ? source.input : null;

  const engine = useSharedValue(createEngineState());
  const frame = useSharedValue(createFrame());
  const scratch = useSharedValue<number[]>(new Array((BAND_SAMPLES + 1) * 2).fill(0));
  const picture = useSharedValue<SkPicture>(useMemo(emptyPicture, []));

  // ── Callbacks back to the JS thread ───────────────────────────────────
  const callbacks = useRef({ onLevel, onActivate, onDeactivate });
  callbacks.current = { onLevel, onActivate, onDeactivate };
  const [running, setRunning] = useState(true);
  const handleFadeEvent = useCallback((event: number) => {
    if (event === 1) callbacks.current.onActivate?.();
    else {
      callbacks.current.onDeactivate?.();
      setRunning(false);
    }
  }, []);
  const reportLevel = useCallback((value: number) => callbacks.current.onLevel?.(value), []);
  const wantsLevel = onLevel != null;
  const levelOut = levelValue ?? null;

  // ── The frame loop (UI thread) ────────────────────────────────────────
  const onFrame = useCallback(
    (info: { timeSincePreviousFrame: number | null }) => {
      'worklet';
      const s = engine.value;
      const c = cfg.value;
      s.sincePaint += (info.timeSincePreviousFrame ?? 16.7) / 1000;
      // A paused glow repaints only when a prop changes.
      if (c.paused && s.paintedVersion === c.version) {
        s.sincePaint = 0;
        return;
      }
      if (s.sincePaint < MIN_FRAME_INTERVAL && s.paintedVersion === c.version) return;
      const dt = s.sincePaint;
      s.sincePaint = 0;

      const { w, h } = size.value;
      const f = frame.value;
      const reading: VoiceInputFrame = input
        ? input.value
        : { kind: 0, level: levelSource.value, low: 0, mid: 0, high: 0 };
      const event = stepGlow(s, f, c, reading, motionSource.value, dt, w, h);
      if (levelOut) levelOut.value = f.level;
      if (wantsLevel) runOnJS(reportLevel)(f.level);
      if (event !== 0) runOnJS(handleFadeEvent)(event);

      if (w > 0 && h > 0) {
        const recorder = Skia.PictureRecorder();
        const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, w, h));
        paintGlow(Skia, canvas, c, f, w, h, scratch.value);
        picture.value = recorder.finishRecordingAsPicture();
      }
      s.paintedVersion = c.version;
    },
    [engine, cfg, size, frame, input, levelSource, motionSource, levelOut, wantsLevel, reportLevel, handleFadeEvent, scratch, picture]
  );

  const loop = useFrameCallback(onFrame, true);

  // Start again whenever the glow is switched back on; stop once it has faded out.
  const active = config.active;
  useEffect(() => {
    if (active && !running) setRunning(true);
  }, [active, running]);
  useEffect(() => {
    loop.setActive(running);
  }, [loop, running]);

  return (
    <View
      {...viewProps}
      style={[styles.wrapper, { borderRadius: radius }, style]}
      onLayout={handleLayout}
    >
      {children}
      <Canvas
        style={styles.overlay}
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

/** Same component, under the web library's name. */
export const VoiceBeam = VoiceGlow;

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
});
