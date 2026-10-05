import type { VoiceSource } from './types';

/**
 * Where a microphone hook is: `idle` until `start()`, `requesting` while the
 * permission prompt is up, `live` while audio flows, `denied` if the user
 * said no, `unsupported` where the platform has no capture, `error` if the
 * stream failed to start.
 */
export type MicrophoneState = 'idle' | 'requesting' | 'live' | 'denied' | 'unsupported' | 'error';

export interface Microphone {
  /** Pass to `<VoiceGlow source={…}>`. */
  source: VoiceSource;
  state: MicrophoneState;
  error: Error | null;
  /** Asks for permission (once) and starts listening. Call it from a user action. */
  start: () => Promise<void>;
  /** Stops listening and releases the microphone. */
  stop: () => void;
}
