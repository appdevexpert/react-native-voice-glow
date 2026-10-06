import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceInput } from './input';
import type { Microphone, MicrophoneState } from './microphone';

const BANDS: ReadonlyArray<readonly [number, number]> = [
  [80, 300],
  [300, 2000],
  [2000, 6000],
];

/**
 * The microphone on React Native Web: getUserMedia into a Web Audio
 * AnalyserNode, read once per animation frame, as the web component does.
 */
export function useWebMicrophone(): Microphone {
  const voice = useVoiceInput();
  const [state, setState] = useState<MicrophoneState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const live = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  /** Bumped by every start and stop, so a start that was overtaken gives up. */
  const attempt = useRef(0);

  const release = useCallback(() => {
    const l = live.current;
    live.current = null;
    if (!l) return;
    cancelAnimationFrame(l.raf);
    l.stream.getTracks().forEach((t) => t.stop());
    l.ctx.close().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (live.current) return;
    const id = ++attempt.current;
    const g = globalThis as unknown as {
      navigator?: { mediaDevices?: MediaDevices };
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!g.navigator?.mediaDevices?.getUserMedia || !Ctor) {
      setState('unsupported');
      return;
    }
    setError(null);
    setState('requesting');
    try {
      // The browser's voice processing flattens the dynamics the glow reacts to.
      const stream = await g.navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (id !== attempt.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new Ctor();
      if (ctx.state === 'suspended') await ctx.resume();
      if (id !== attempt.current) {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        return;
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const time = new Float32Array(analyser.fftSize);
      const freq = new Uint8Array(analyser.frequencyBinCount);
      const binHz = ctx.sampleRate / analyser.fftSize;
      const read = () => {
        if (!live.current) return;
        analyser.getFloatTimeDomainData(time);
        let sum = 0;
        for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
        analyser.getByteFrequencyData(freq);
        const bands = [0, 0, 0];
        for (let b = 0; b < 3; b++) {
          const from = Math.max(0, Math.floor(BANDS[b][0] / binHz));
          const to = Math.min(freq.length - 1, Math.ceil(BANDS[b][1] / binHz));
          let acc = 0;
          for (let i = from; i <= to; i++) acc += freq[i];
          bands[b] = acc / (to - from + 1) / 255;
        }
        voice.source.input.value = {
          kind: 2,
          level: Math.sqrt(sum / time.length),
          low: bands[0],
          mid: bands[1],
          high: bands[2],
        };
        live.current.raf = requestAnimationFrame(read);
      };
      live.current = { stream, ctx, raf: requestAnimationFrame(read) };
      setState('live');
    } catch (e) {
      if (id !== attempt.current) return;
      release();
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      setState(err.name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }, [release, voice]);

  const stop = useCallback(() => {
    attempt.current++;
    release();
    voice.reset();
    setState('idle');
  }, [release, voice]);

  useEffect(() => release, [release]);

  return { source: voice.source, state, error, start, stop };
}
