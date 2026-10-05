import { useEffect, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import type { VoiceGlowTheme } from './types';

/** The system "Reduce Motion" setting, live. */
export function useReduceMotionSetting(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** `auto` follows the system colour scheme. */
export function useResolvedTheme(theme: VoiceGlowTheme): 'dark' | 'light' {
  const scheme = useColorScheme();
  if (theme === 'auto') return scheme === 'light' ? 'light' : 'dark';
  return theme;
}
