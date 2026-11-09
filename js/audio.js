// Letter playback. Pre-decoded audio buffers through Web Audio for near-zero
// latency, with speech synthesis as a fallback if a file fails to load.

export const SFX = ['good', 'bad', 'missed', 'tick', 'go', 'levelup', 'complete', 'achievement'];

export class LetterAudio {
  constructor(letters, basePath = 'audio/') {
    this.letters = letters;
    this.basePath = basePath;
    this.buffers = new Map();
    this.sfxBuffers = new Map();
    this.sfxReady = false;
    this.sfxGain = null;
    this.ctx = null;
    this.gain = null;
    this.volume = 0.9;
    this.muted = false;
    this.ready = false;
    this.failed = false;
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.failed = true;
      return null;
    }
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.volume * 0.8;
    this.sfxGain.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Call from a user gesture so mobile browsers let the context run. */
  async unlock() {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
  }

  async preload() {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    const results = await Promise.allSettled(this.letters.map(async (letter) => {
      const res = await fetch(`${this.basePath}${letter}.mp3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      const buffer = await new Promise((resolve, reject) => {
        // callback form for older Safari
        ctx.decodeAudioData(data, resolve, reject);
      });
      this.buffers.set(letter, buffer);
    }));
    this.ready = results.every(r => r.status === 'fulfilled');
    this.failed = !this.ready;
    return this.ready;
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
    if (this.sfxGain) this.sfxGain.gain.value = this.volume * 0.8;
  }

  /** Load the UI sound effects (generated once with ElevenLabs). */
  async preloadSfx() {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    const results = await Promise.allSettled(SFX.map(async (name) => {
      const res = await fetch(`${this.basePath}sfx/${name}.mp3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      const buffer = await new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
      this.sfxBuffers.set(name, buffer);
    }));
    this.sfxReady = results.some(r => r.status === 'fulfilled');
    return this.sfxReady;
  }

  setMuted(m) {
    this.muted = m;
    if (this.gain) this.gain.gain.value = m ? 0 : this.volume;
  }

  play(letter) {
    if (this.muted) return;
    const buffer = this.buffers.get(letter);
    if (buffer && this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.gain);
      src.start();
      return;
    }
    this.speak(letter);
  }

  speak(letter) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(letter);
      u.lang = 'en-US';
      u.rate = 0.9;
      u.volume = this.volume;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  /** UI sound: the recorded effect when loaded, otherwise a short synthesized tone. */
  sfx(kind) {
    const buffer = this.sfxBuffers.get(kind);
    if (buffer && this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.sfxGain);
      src.start();
      return;
    }
    this.tone(kind);
  }

  /** Short synthesized tones, used until the effects are loaded. */
  tone(kind) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const now = ctx.currentTime;
    const freq = { good: 880, levelup: 880, achievement: 1046, bad: 220, missed: 300, tick: 520, go: 660, complete: 523 }[kind] || 520;
    osc.type = kind === 'bad' ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (kind === 'good' || kind === 'levelup' || kind === 'go') osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18 * this.volume, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }
}
