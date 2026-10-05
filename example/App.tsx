import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { VoiceGlow, PALETTES, type VoiceGlowColorVariant, type VoiceGlowType } from 'react-native-voice-glow';
import { useMicrophone } from 'react-native-voice-glow/expo';
import { Fixture } from './src/Fixture';
import { useDemoVoice } from './src/useDemoVoice';
import { useThinkingMotion } from './src/useThinkingMotion';

type Theme = 'dark' | 'light';

const INK = {
  dark: { page: '#15141A', surface: '#1F1E25', control: '#2A2931', text: '#ECEBF2', muted: '#8E8C99', line: '#2F2E37' },
  light: { page: '#EEEDF2', surface: '#FFFFFF', control: '#E4E3EA', text: '#1B1A21', muted: '#6D6B78', line: '#DCDBE3' },
};

const HOSTS: { type: VoiceGlowType; label: string }[] = [
  { type: 'mobile', label: 'Phone' },
  { type: 'default', label: 'Chat input' },
  { type: 'pill', label: 'Pill' },
];

const VARIANTS = Object.keys(PALETTES) as VoiceGlowColorVariant[];

// `?scene=<name>` on the web renders one parity-test scene (see src/Fixture.tsx).
const fixture = Platform.OS === 'web' ? new URLSearchParams(globalThis.location?.search ?? '').get('scene') : null;

export default function App() {
  if (fixture) return <Fixture name={fixture} />;
  return (
    <SafeAreaProvider>
      <Demo />
    </SafeAreaProvider>
  );
}

function Demo() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [host, setHost] = useState<VoiceGlowType>('mobile');
  const [variant, setVariant] = useState<VoiceGlowColorVariant>('colorful');
  const [demo, setDemo] = useState(true);
  const [thinking, setThinking] = useState(false);

  const mic = useMicrophone();
  const listening = mic.state === 'live';
  const demoLevel = useDemoVoice(demo && !listening && !thinking);
  const motion = useThinkingMotion(thinking);
  const ink = INK[theme];

  const glow = {
    type: host,
    theme,
    colorVariant: variant,
    source: listening && !thinking ? mic.source : null,
    level: demoLevel,
    motion,
  } as const;

  const toggleMic = () => {
    setThinking(false);
    if (listening) mic.stop();
    else mic.start();
  };

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: ink.page }]}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <View style={styles.topBar}>
        <View style={[styles.segment, { backgroundColor: ink.control }]}>
          {HOSTS.map((h) => (
            <Pressable
              key={h.type}
              onPress={() => setHost(h.type)}
              style={[styles.segmentItem, host === h.type && { backgroundColor: ink.surface }]}
              accessibilityRole="button"
              accessibilityState={{ selected: host === h.type }}
            >
              <Text style={[styles.segmentText, { color: host === h.type ? ink.text : ink.muted }]}>{h.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          style={[styles.themeButton, { backgroundColor: ink.control }]}
          accessibilityRole="button"
          accessibilityLabel={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <Text style={[styles.segmentText, { color: ink.text }]}>{theme === 'dark' ? 'Light' : 'Dark'}</Text>
        </Pressable>
      </View>

      <View style={styles.stage}>
        {host === 'mobile' && (
          <VoiceGlow {...glow} style={styles.fill}>
            <View style={[styles.phone, { backgroundColor: ink.surface }]}>
              <Text style={[styles.prompt, { color: ink.text }]}>How can I help you?</Text>
              <View style={styles.phoneBar}>
                <View style={[styles.chip, { backgroundColor: ink.control }]}>
                  <Text style={[styles.chipText, { color: ink.text }]}>Agent</Text>
                </View>
                <Text style={[styles.hint, { color: ink.muted }]}>{statusLine(mic.state, listening, thinking, demo)}</Text>
              </View>
            </View>
          </VoiceGlow>
        )}

        {host === 'default' && (
          <View style={styles.bottom}>
            <VoiceGlow {...glow}>
              <View style={[styles.composer, { backgroundColor: ink.surface }]}>
                <Text style={[styles.placeholder, { color: ink.muted }]}>Ask me anything</Text>
                <View style={styles.composerBar}>
                  <View style={[styles.chip, { backgroundColor: ink.control }]}>
                    <Text style={[styles.chipText, { color: ink.text }]}>Agent</Text>
                  </View>
                </View>
              </View>
            </VoiceGlow>
            <Text style={[styles.hint, styles.hintBelow, { color: ink.muted }]}>
              {statusLine(mic.state, listening, thinking, demo)}
            </Text>
          </View>
        )}

        {host === 'pill' && (
          <View style={styles.center}>
            <VoiceGlow {...glow}>
              <View style={[styles.pill, { backgroundColor: ink.surface }]}>
                <Text style={[styles.pillText, { color: ink.text }]}>{listening ? 'Listening' : 'Recording'}</Text>
              </View>
            </VoiceGlow>
            <Text style={[styles.hint, styles.hintBelow, { color: ink.muted }]}>
              {statusLine(mic.state, listening, thinking, demo)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.swatches} accessibilityRole="radiogroup">
        {VARIANTS.map((v) => {
          const [r, g, b] = PALETTES[v][theme][0];
          const selected = v === variant;
          return (
            <Pressable
              key={v}
              onPress={() => setVariant(v)}
              accessibilityRole="radio"
              accessibilityLabel={`${v} palette`}
              accessibilityState={{ checked: selected }}
              style={[styles.swatchRing, { borderColor: selected ? ink.text : 'transparent' }]}
            >
              <View style={[styles.swatch, { backgroundColor: `rgb(${r}, ${g}, ${b})` }]} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={toggleMic}
          style={[styles.primary, { backgroundColor: ink.text }]}
          accessibilityRole="button"
        >
          <Text style={[styles.primaryText, { color: ink.page }]}>{listening ? 'Stop' : 'Use my microphone'}</Text>
        </Pressable>
        <View style={styles.secondaryRow}>
          <Pressable
            onPress={() => setDemo(!demo)}
            style={[styles.secondary, { borderColor: ink.line }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: demo }}
          >
            <Text style={[styles.secondaryText, { color: ink.text }]}>{demo ? 'Pause demo voice' : 'Play demo voice'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setThinking(!thinking)}
            style={[styles.secondary, { borderColor: ink.line }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: thinking }}
          >
            <Text style={[styles.secondaryText, { color: ink.text }]}>{thinking ? 'Stop thinking' : 'Think'}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function statusLine(state: string, listening: boolean, thinking: boolean, demo: boolean): string {
  if (thinking) return 'Thinking…';
  if (state === 'denied') return 'Microphone access is off. Turn it on in Settings to try your own voice.';
  if (state === 'unsupported') return 'This device has no microphone stream.';
  if (state === 'error') return 'The microphone could not start.';
  if (state === 'requesting') return 'Waiting for microphone access…';
  if (listening) return 'Listening. Say something.';
  return demo ? 'Demo voice' : 'Quiet';
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segmentItem: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9 },
  segmentText: { fontSize: 14, fontWeight: '500' },
  themeButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  stage: { flex: 1, paddingHorizontal: 16, paddingVertical: 16 },
  fill: { flex: 1 },
  phone: { flex: 1, borderRadius: 40, justifyContent: 'space-between', padding: 20 },
  prompt: { fontSize: 26, fontWeight: '400', letterSpacing: -0.3, textAlign: 'center', marginTop: '45%' },
  phoneBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  composer: { borderRadius: 20, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, minHeight: 96 },
  placeholder: { fontSize: 16 },
  composerBar: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  chipText: { fontSize: 14, fontWeight: '500' },
  pill: { width: 150, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 14, fontWeight: '500' },
  hint: { fontSize: 13, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  hintBelow: { textAlign: 'center', marginLeft: 0, marginTop: 12 },
  swatches: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  swatchRing: { padding: 3, borderRadius: 999, borderWidth: 1.5 },
  swatch: { width: 20, height: 20, borderRadius: 999 },
  controls: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  primary: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  primaryText: { fontSize: 16, fontWeight: '600' },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondary: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '500' },
});
