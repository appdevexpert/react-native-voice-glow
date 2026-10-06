/**
 * Microphone input for Expo, built on `expo-audio`'s real-time PCM stream
 * (`useAudioStream`, Expo SDK 57+). It needs no native code beyond Expo's
 * own modules, so it runs in Expo Go.
 *
 *   npx expo install expo-audio
 *
 * Add the microphone permission text to app.json:
 *   "plugins": [["expo-audio", { "microphonePermission": "…" }]]
 *
 * iOS: while the stream is live, expo-audio puts the audio session in
 * record-only mode, so nothing else the app plays is heard until it stops.
 * For a voice agent that talks while it listens, use
 * `react-native-voice-glow/audio-api` instead.
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
   * The audio mode to set after listening stops. On iOS expo-audio leaves
   * the session record-only and inactive when the stream stops, so later
   * playback would be silent; this hands it back. Pass your app's own mode,
   * or `false` to leave the session alone.
   */
  restoreAudioMode?: Partial<AudioMode> | false;
}

const DEFAULT_RESTORE: Partial<AudioMode> = { playsInSilentMode: true, allowsRecording: false };

/** The native implementation. */
function useNativeMicrophone(options: UseMicrophoneOptions = {}): Microphone {
  const { sampleRate = 48000, restoreAudioMode = DEFAULT_RESTORE } = options;
  const voice = useVoiceInput();
  const [state, setState] = useState<MicrophoneState>('idle');
  const [error, setError] = useState<Error | null>(null);
  /** Whether buffers are being taken. */
  const live = useRef(false);
  /** Bumped by every start and stop, so a start that was overtaken gives up. */
  const attempt = useRef(0);
  const restore = useRef(restoreAudioMode);
  restore.current = restoreAudioMode;

  const onBuffer = useCallback(
    (buffer: AudioStreamBuffer) => {
      if (!live.current) return;
      // The stream is opened as float32, interleaved when stereo.
      voice.pushPCM(firstChannel(new Float32Array(buffer.data), buffer.channels), buffer.sampleRate);
    },
    [voice]
  );

  const { stream } = useAudioStream({ sampleRate, channels: 1, encoding: 'float32', onBuffer });

  const halt = useCallback(() => {
    const wasLive = live.current;
    live.current = false;
    try {
      stream.stop();
    } catch {
      // Already stopped.
    }
    if (wasLive && restore.current !== false) setAudioModeAsync(restore.current).catch(() => {});
  }, [stream]);

  const start = useCallback(async () => {
    if (live.current) return;
    const id = ++attempt.current;
    setError(null);
    setState('requesting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (id !== attempt.current) return;
      if (!permission.granted) {
        setState('denied');
        return;
      }
      live.current = true;
      await stream.start();
      if (id !== attempt.current) {
        // Stopped while starting.
        halt();
        return;
      }
      setState('live');
    } catch (e) {
      if (id !== attempt.current) return;
      halt();
      setError(e instanceof Error ? e : new Error(String(e)));
      setState('error');
    }
  }, [halt, stream]);

  const stop = useCallback(() => {
    attempt.current++;
    halt();
    voice.reset();
    setState('idle');
  }, [halt, voice]);

  useEffect(
    () => () => {
      attempt.current++;
      if (live.current) halt();
    },
    [halt]
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
