import { useEffect } from 'react';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { VoiceGlowMotion } from 'react-native-voice-glow';

/**
 * A simple "thinking" state built on the glow's `motion` prop: the lobes
 * gather into one beam that sweeps from side to side, riding the corners.
 */
export function useThinkingMotion(thinking: boolean) {
  const gather = useSharedValue(0);
  const sweep = useSharedValue(0.5);

  useEffect(() => {
    gather.value = withTiming(thinking ? 1 : 0, { duration: thinking ? 500 : 350, easing: Easing.inOut(Easing.cubic) });
    if (thinking) {
      sweep.value = 0;
      sweep.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true);
    } else {
      cancelAnimation(sweep);
    }
  }, [thinking, gather, sweep]);

  return useDerivedValue<VoiceGlowMotion | null>(() => {
    if (gather.value < 0.001) return null;
    const side = sweep.value * 2 - 1;
    return {
      gather: gather.value,
      offset: side * 0.8 * gather.value,
      stretch: 0.5,
      heldLevel: 0.55,
      cornerFollow: 1,
    };
  });
}
