import { useEffect } from 'react';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * A synthetic voice level for trying the glow without a microphone (and in
 * the simulator): phrases of syllables at a speaking rate, with pauses
 * between them. Runs on the UI thread.
 */
export function useDemoVoice(playing: boolean): SharedValue<number> {
  const level = useSharedValue(0);
  const clock = useSharedValue(0);

  const loop = useFrameCallback((info) => {
    'worklet';
    clock.value += (info.timeSincePreviousFrame ?? 16) / 1000;
    const t = clock.value;
    const phrase = t % 4.2;
    const speaking = phrase < 2.8;
    // Syllables at ~3.6 per second, with some louder than others.
    const syllable = Math.pow(Math.max(0, Math.sin(2 * Math.PI * 3.6 * t)), 0.7);
    const stress = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.8 * t + 1.1);
    level.value = speaking ? 0.12 + 0.75 * syllable * stress : 0;
  }, false);

  useEffect(() => {
    loop.setActive(playing);
    if (!playing) level.value = 0;
  }, [loop, playing, level]);

  return level;
}
