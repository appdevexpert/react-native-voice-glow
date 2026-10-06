import { useMemo } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { VoiceAnalyser, type VoiceAnalyserOptions } from './analyser';
import type { VoiceInputFrame, VoiceSource } from './types';

export interface VoiceInput {
  /** Pass to `<VoiceGlow source={…}>`. */
  readonly source: VoiceSource;
  /**
   * Feed mono PCM samples (-1…1) from any audio library: the microphone, a
   * WebRTC track, TTS playback. They are analysed on the JS thread exactly
   * as the browser's AnalyserNode would, and the reading is handed to the
   * glow on the UI thread.
   */
  pushPCM(samples: Float32Array, sampleRate: number): void;
  /** Report a raw RMS amplitude (0–1 full scale) when you have a meter but no PCM. */
  setRms(rms: number): void;
  /** Report a level that is already 0–1; no gain is applied. */
  setLevel(level: number): void;
  /** Back to silence. */
  reset(): void;
}

const SILENT: VoiceInputFrame = { kind: 0, level: 0, low: 0, mid: 0, high: 0 };

/**
 * A voice input the glow can listen to. The audio hooks
 * (`react-native-voice-glow/expo`, `react-native-voice-glow/audio-api`) are
 * built on it; use it directly to drive the glow from your own audio.
 *
 * @example
 * const voice = useVoiceInput();
 * useEffect(() => myPlayer.onPcm((pcm, rate) => voice.pushPCM(pcm, rate)), []);
 * <VoiceGlow source={voice.source}>…</VoiceGlow>
 */
export function useVoiceInput(options?: VoiceAnalyserOptions): VoiceInput {
  const input = useSharedValue<VoiceInputFrame>(SILENT);
  return useMemo(() => {
    const analyser = new VoiceAnalyser(options);
    let seq = 0;
    return {
      source: { input },
      pushPCM(samples: Float32Array, sampleRate: number) {
        const batch = analyser.process(samples, sampleRate);
        if (batch.length === 0) return;
        const readings: number[] = [];
        for (const r of batch) readings.push(r.rms, r.low, r.mid, r.high);
        const last = batch[batch.length - 1];
        seq += 1;
        input.value = { kind: 2, level: last.rms, low: last.low, mid: last.mid, high: last.high, readings, seq };
      },
      setRms(rms: number) {
        input.value = { kind: 1, level: rms, low: 0, mid: 0, high: 0 };
      },
      setLevel(level: number) {
        input.value = { kind: 0, level, low: 0, mid: 0, high: 0 };
      },
      reset() {
        analyser.reset();
        input.value = SILENT;
      },
    };
    // The analyser options are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);
}

/** Interleaved PCM to mono: the first channel. */
export function firstChannel(data: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return data;
  const out = new Float32Array(Math.floor(data.length / channels));
  for (let i = 0; i < out.length; i++) out[i] = data[i * channels];
  return out;
}

/** 16-bit little-endian PCM to float. */
export function int16ToFloat(buffer: ArrayBuffer): Float32Array {
  const view = new Int16Array(buffer);
  const out = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) out[i] = view[i] / 32768;
  return out;
}
