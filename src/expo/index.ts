/**
 * Microphone input for Expo, built on `expo-audio`'s real-time PCM stream
 * (`useAudioStream`, Expo SDK 57+). Works in Expo Go, no dev build needed.
 *
 *   npx expo install expo-audio
 *
 * Add the microphone permission text to app.json:
 *   "plugins": [["expo-audio", { "microphonePermission": "…" }]]
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioMode,
  type AudioStreamBuffer,
} from 'expo-audio';
import { firstChannel, useVoiceInput } from '../input';
import type { Microphone, MicrophoneState } from '../microphone';
import { useWebMicrophone } from '../webMicrophone';

export type { Microphone, MicrophoneState } from '../microphone';

export interface UseMicrophoneOptions {
  /** Requested sample rate, Hz. The device may deliver another; the analyser adapts. */
  sampleRate?: number;
  /**
   * Audio session to set before listening. The default lets recording and
   * playback share the session (for a voice agent that also speaks), and
   * plays in silent mode on iOS. Pass `false` to leave the session alone.
   */
  audioMode?: Partial<AudioMode> | false;
}

/** The native implementation. */
function useNativeMicrophone(options: UseMicrophoneOptions = {}): Microphone {
  const { sampleRate = 48000, audioMode } = options;
  const voice = useVoiceInput();
  const [state, setState] = useState<MicrophoneState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const live = useRef(false);

  const onBuffer = useCallback(
    (buffer: AudioStreamBuffer) => {
      if (!live.current) return;
      // The stream is opened as float32, interleaved when stereo.
      voice.pushPCM(firstChannel(new Float32Array(buffer.data), buffer.channels), buffer.sampleRate);
    },
    [voice]
  );

  const { stream } = useAudioStream({ sampleRate, channels: 1, encoding: 'float32', onBuffer });

  const start = useCallback(async () => {
    if (live.current) return;
    setError(null);
    setState('requesting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setState('denied');
        return;
      }
      if (audioMode !== false) {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, ...audioMode });
      }
      live.current = true;
      await stream.start();
      setState('live');
    } catch (e) {
      live.current = false;
      setError(e instanceof Error ? e : new Error(String(e)));
      setState('error');
    }
  }, [audioMode, stream]);

  const stop = useCallback(() => {
    if (!live.current) return;
    live.current = false;
    try {
      stream.stop();
    } catch {
      // Already stopped.
    }
    voice.reset();
    setState('idle');
  }, [stream, voice]);

  useEffect(
    () => () => {
      if (live.current) {
        live.current = false;
        try {
          stream.stop();
        } catch {
          // Already released.
        }
      }
    },
    [stream]
  );

  return { source: voice.source, state, error, start, stop };
}

/**
 * Listen to the microphone and feed the glow. On React Native Web this uses
 * the browser's getUserMedia and AnalyserNode instead.
 *
 * @example
 * const mic = useMicrophone();
 *
 * <VoiceGlow source={mic.source}>
 *   <ChatInput />
 * </VoiceGlow>
 */
export const useMicrophone: (options?: UseMicrophoneOptions) => Microphone =
  Platform.OS === 'web' ? () => useWebMicrophone() : useNativeMicrophone;
