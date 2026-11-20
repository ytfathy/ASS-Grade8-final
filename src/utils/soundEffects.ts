import { useEffect, useState } from 'react';
import { EvaluationStatus } from '../types/assessment.ts';

export type SoundEffectType =
  | 'correct'
  | 'partially_correct'
  | 'incorrect'
  | 'quiz_complete'
  | 'level_up'
  | 'click';

const SOUND_PATHS: Record<SoundEffectType, string> = {
  correct: '/assets/sounds/correct.wav',
  partially_correct: '/assets/sounds/partially_correct.wav',
  incorrect: '/assets/sounds/incorrect.wav',
  quiz_complete: '/assets/sounds/quiz_complete.wav',
  level_up: '/assets/sounds/level_up.wav',
  click: '/assets/sounds/click.wav',
};

const MUTE_STORAGE_KEY = 'iee_sound_muted_v1';

class SoundEffectsManager {
  private muted: boolean = false;
  private listeners: Set<(muted: boolean) => void> = new Set();
  private activeAudio: HTMLAudioElement | null = null;
  private activeType: SoundEffectType | null = null;
  private activeStartedAt: number = 0;
  private audioCache: Partial<Record<SoundEffectType, HTMLAudioElement>> = {};
  private audioCtx: AudioContext | null = null;
  private bufferCache: Partial<Record<SoundEffectType, AudioBuffer>> = {};
  private activeBufferSource: AudioBufferSourceNode | null = null;

  constructor() {
    this.muted = this.readStoredMuteState();
  }

  private readStoredMuteState(): boolean {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
      }
    } catch {
      // Ignore storage access restrictions
    }
    return false;
  }

  private writeStoredMuteState(muted: boolean): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
      }
    } catch {
      // Ignore storage access restrictions
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.writeStoredMuteState(muted);
    if (muted) {
      this.stopCurrent();
    }
    this.listeners.forEach(cb => cb(this.muted));
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  subscribe(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stops any currently playing sound cleanly to prevent overlapping audio.
   */
  stopCurrent(): void {
    if (this.activeBufferSource) {
      try {
        this.activeBufferSource.stop();
        this.activeBufferSource.disconnect();
      } catch {
        // Ignore already stopped source
      }
      this.activeBufferSource = null;
    }

    if (this.activeAudio) {
      try {
        this.activeAudio.pause();
        this.activeAudio.currentTime = 0;
      } catch {
        // Ignore media reset errors
      }
      this.activeAudio = null;
    }

    this.activeType = null;
  }

  private getOrCreateAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  private async loadAndPlayWithWebAudio(type: SoundEffectType): Promise<boolean> {
    const ctx = this.getOrCreateAudioContext();
    if (!ctx) return false;

    try {
      let buffer = this.bufferCache[type];
      if (!buffer) {
        const res = await fetch(SOUND_PATHS[type]);
        if (!res.ok) return false;
        const arr = await res.arrayBuffer();
        buffer = await ctx.decodeAudioData(arr);
        this.bufferCache[type] = buffer;
      }

      // Check mute again after async fetch
      if (this.muted) return true;

      this.stopCurrent();

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gain = ctx.createGain();
      gain.gain.value = type === 'click' ? 0.5 : 0.85;

      source.connect(gain);
      gain.connect(ctx.destination);

      source.onended = () => {
        if (this.activeBufferSource === source) {
          this.activeBufferSource = null;
          this.activeType = null;
        }
      };

      this.activeBufferSource = source;
      this.activeType = type;
      this.activeStartedAt = Date.now();
      source.start(0);
      return true;
    } catch {
      return false;
    }
  }

  private playWithHtmlAudio(type: SoundEffectType): void {
    if (typeof Audio === 'undefined') return;
    try {
      let audio = this.audioCache[type];
      if (!audio) {
        audio = new Audio(SOUND_PATHS[type]);
        audio.preload = 'auto';
        this.audioCache[type] = audio;
      }

      this.stopCurrent();
      audio.volume = type === 'click' ? 0.4 : 0.85;
      audio.currentTime = 0;

      this.activeAudio = audio;
      this.activeType = type;
      this.activeStartedAt = Date.now();

      audio.onended = () => {
        if (this.activeAudio === audio) {
          this.activeAudio = null;
          this.activeType = null;
        }
      };

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Autoplay or headless audio unavailable; fail gracefully without console noise
        });
      }
    } catch {
      // Ignore environments without Audio support
    }
  }

  /**
   * Plays a sound effect with overlap prevention.
   * Priority protection: a subtle button click will not interrupt a freshly playing
   * achievement/evaluation chime during its first 700ms.
   */
  play(type: SoundEffectType): void {
    if (this.muted || typeof window === 'undefined') return;

    if (
      type === 'click' &&
      this.activeType &&
      this.activeType !== 'click' &&
      Date.now() - this.activeStartedAt < 700
    ) {
      return;
    }

    // Try Web Audio decoded asset first for zero-latency mobile/desktop playback,
    // falling back cleanly to HTMLAudioElement.
    if (typeof fetch === 'function' && this.getOrCreateAudioContext()) {
      void this.loadAndPlayWithWebAudio(type).then((ok) => {
        if (!ok && !this.muted) {
          this.playWithHtmlAudio(type);
        }
      });
    } else {
      this.playWithHtmlAudio(type);
    }
  }

  playForEvaluation(status: EvaluationStatus): void {
    this.play(status);
  }
}

export const soundEffects = new SoundEffectsManager();

export function useSoundSettings(): {
  muted: boolean;
  toggleMute: () => boolean;
  setMuted: (muted: boolean) => void;
} {
  const [muted, setMutedState] = useState<boolean>(() => soundEffects.isMuted());

  useEffect(() => {
    return soundEffects.subscribe(setMutedState);
  }, []);

  return {
    muted,
    toggleMute: () => soundEffects.toggleMute(),
    setMuted: (m: boolean) => soundEffects.setMuted(m),
  };
}
