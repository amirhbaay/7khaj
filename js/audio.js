/**
 * Offline Web Audio Synthesizer for Chahar Barg 11
 * Generates crisp, realistic card and UI sound effects using pure Web Audio API
 * (Zero external audio files required, 100% offline-safe).
 */
(function (global) {
  'use strict';

  let audioCtx = null;
  let muted = false;

  function getContext() {
    if (muted) return null;
    if (!audioCtx && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        try {
          audioCtx = new AudioContextClass();
        } catch (e) {
          audioCtx = null;
        }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  const SoundFX = {
    isMuted() {
      return muted;
    },

    setMuted(val) {
      muted = Boolean(val);
      return muted;
    },

    toggleMute() {
      muted = !muted;
      if (!muted) this.playTap();
      return muted;
    },

    playTap() {
      const ctx = getContext();
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.045);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      } catch (e) {}
    },

    playCardSlide() {
      const ctx = getContext();
      if (!ctx) return;
      try {
        // Short filtered noise burst resembling a card snap on felt
        const bufferSize = ctx.sampleRate * 0.065;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, ctx.currentTime);
        filter.Q.setValueAtTime(1.8, ctx.currentTime);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.065);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start();
      } catch (e) {}
    },

    playCapture() {
      const ctx = getContext();
      if (!ctx) return;
      try {
        const now = ctx.currentTime;
        const notes = [440, 587.33]; // A4 -> D5 crisp chime
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.06);
          gain.gain.setValueAtTime(0.14, now + idx * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.16);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.06);
          osc.stop(now + idx * 0.06 + 0.17);
        });
      } catch (e) {}
    },

    playSurFanfare() {
      const ctx = getContext();
      if (!ctx) return;
      try {
        const now = ctx.currentTime;
        const chord = [523.25, 659.25, 783.99, 1046.5]; // C5 - E5 - G5 - C6
        chord.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.07);
          gain.gain.setValueAtTime(0.18, now + idx * 0.07);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.07);
          osc.stop(now + idx * 0.07 + 0.36);
        });
      } catch (e) {}
    },

    playRoundEnd() {
      const ctx = getContext();
      if (!ctx) return;
      try {
        const now = ctx.currentTime;
        const notes = [392.0, 493.88, 587.33, 783.99];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.09);
          gain.gain.setValueAtTime(0.14, now + idx * 0.09);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.28);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.09);
          osc.stop(now + idx * 0.09 + 0.3);
        });
      } catch (e) {}
    }
  };

  global.SoundFX = SoundFX;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SoundFX;
  }
})(typeof window !== 'undefined' ? window : globalThis);
