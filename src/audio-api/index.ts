/**
 * Microphone input built on Software Mansion's `react-native-audio-api`,
 * for bare React Native apps or Expo apps that already use it. Needs a
 * development build (it is not in Expo Go). Unlike the expo-audio stream,
 * it can listen while the app is playing audio, as a voice agent does.
 *
 *   npm install react-native-audio-api
 *
 * In Expo, add its config plugin with the microphone permissions. The
 * Android list replaces the plugin's defaults, so RECORD_AUDIO must be in it:
 *   "plugins": [["react-native-audio-api", {
 *     "iosMicrophonePermission": "…",
 *     "androidPermissions": ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"]
 *   }]]
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioManager, AudioRecorder, type SessionOptions } from 'react-native-audio-api';
import { useVoiceInput } from '../input';
import type { Microphone, MicrophoneState } from '../microphone';
import { useWebMicrophone } from '../webMicrophone';

export type { Microphone, MicrophoneState } from '../microphone';

export interface UseMicrophoneOptions {
  /** Requested sample rate, Hz. */
  sampleRate?: number;
  /** Samples per callback. 800 at 48 kHz is one buffer per 60 Hz frame. */
  bufferLength?: number;
  /**
   * The iOS audio session to set before listening. The default lets
   * recording and playback share the session (a voice agent that also
   * speaks). Pass `false` to leave the session alone.
   */
  session?: SessionOptions | false;
}

const DEFAULT_SESSION: SessionOptions = {
  iosCategory: 'playAndRecord',
  iosMode: 'default',
  iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
};

/** The native implementation. */
function useNativeMicrophone(options: UseMicrophoneOptions = {}): Microphone {
  const { sampleRate = 48000, bufferLength = 800, session = DEFAULT_SESSION } = options;
  const voice = useVoiceInput();
  const [state, setState] = useState<MicrophoneState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const recorder = useRef<AudioRecorder | null>(null);
  /** Bumped by every start and stop, so a start that was overtaken gives up. */
  const attempt = useRef(0);

  const release = useCallback(() => {
    const r = recorder.current;
    recorder.current = null;
    if (!r) return;
    r.clearOnAudioReady();
    r.clearOnError();
    r.stop().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (recorder.current) return;
    const id = ++attempt.current;
    setError(null);
    setState('requesting');
    try {
      if (session !== false) AudioManager.setAudioSessionOptions(session);
      const permission = await AudioManager.requestRecordingPermissions();
      if (id !== attempt.current) return;
      if (permission !== 'Granted') {
        setState('denied');
        return;
      }
      await AudioManager.setAudioSessionActivity(true);
      if (id !== attempt.current) return;
      const r = new AudioRecorder();
      recorder.current = r;
      const ready = r.onAudioReady({ sampleRate, bufferLength, channelCount: 1 }, ({ buffer }) => {
        voice.pushPCM(buffer.getChannelData(0), buffer.sampleRate);
      });
      if (ready.status === 'error') throw new Error(ready.message);
      r.onError((e) => {
        setError(new Error(e.message));
        setState('error');
      });
      const started = await r.start();
      if (id !== attempt.current) {
        // Stopped while starting: make sure this recorder is released.
        if (recorder.current === r) release();
        else r.stop().catch(() => {});
        return;
      }
      if (started.status === 'error') throw new Error(started.message);
      setState('live');
    } catch (e) {
      if (id !== attempt.current) return;
      release();
      setError(e instanceof Error ? e : new Error(String(e)));
      setState('error');
    }
  }, [bufferLength, release, sampleRate, session, voice]);

  const stop = useCallback(() => {
    attempt.current++;
    release();
    voice.reset();
    setState('idle');
  }, [release, voice]);

  useEffect(
    () => () => {
      attempt.current++;
      release();
    },
    [release]
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
