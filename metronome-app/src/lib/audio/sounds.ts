/** Sound settings shared by the UI and the audio worklet. */

export type Timbre = 'beep' | 'wood' | 'click' | 'bell';

export interface LevelSound {
  /** 0..1, 0 mutes the level. */
  gain: number;
  /** Frequency in Hz. */
  pitch: number;
}

export interface SoundConfig {
  timbre: Timbre;
  volume: number;
  /** Indexed by click level (bar, beat, pulse, sub, count-in bar, count-in beat). */
  levels: LevelSound[];
}

export const LEVEL_NAMES = ['Downbeat', 'Beat', 'Pulse', 'Subdivision', 'Count-in bar', 'Count-in beat'];

export const DEFAULT_SOUND: SoundConfig = {
  timbre: 'wood',
  volume: 0.8,
  levels: [
    { gain: 1, pitch: 1760 },
    { gain: 0.7, pitch: 1100 },
    { gain: 0.45, pitch: 1100 },
    { gain: 0.3, pitch: 880 },
    { gain: 0.9, pitch: 2349 },
    { gain: 0.7, pitch: 1568 },
  ],
};
