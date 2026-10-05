import { View } from 'react-native';
import { VoiceGlow, type VoiceGlowProps } from 'react-native-voice-glow';
// The same scenes the library's parity tests render.
import { scenes } from '../../scripts/scenes.mjs';

type Scene = {
  name: string;
  w: number;
  h: number;
  radius: number;
  bg: string;
  page: string;
  level: number;
  props: Partial<VoiceGlowProps>;
};

/**
 * Renders one test scene by itself, for the end-to-end check on React
 * Native Web (`?scene=<name>`): the real component, its Reanimated frame
 * loop and its Skia canvas, screenshotted in headless Chromium and compared
 * against the original web component.
 */
export function Fixture({ name }: { name: string }) {
  const scene = (scenes as Scene[]).find((s) => s.name === name);
  if (!scene) return null;
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: scene.page }}>
      <VoiceGlow nativeID="scene" level={scene.level} {...scene.props}>
        <View style={{ width: scene.w, height: scene.h, borderRadius: scene.radius, backgroundColor: scene.bg }} />
      </VoiceGlow>
    </View>
  );
}
