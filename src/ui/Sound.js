// Quiet synthesized cues, off until the player explicitly enables audio.
export class Sound {
  constructor({ AudioContext = globalThis.AudioContext } = {}) {
    this.AudioContext = AudioContext;
    this.enabled = false;
    this.lastCue = -Infinity;
    this.active = new Set();
    this.closed = false;
  }

  async enable() {
    if (!this.AudioContext || this.closed) return false;
    try {
      this.context ??= new this.AudioContext();
      await this.context.resume();
      if (this.closed) return false;
      this.enabled = true;
      return true;
    } catch { return false; }
  }

  mute() {
    this.enabled = false;
    for (const oscillator of this.active) { try { oscillator.stop(); } catch { /* Already ended. */ } }
    this.active.clear();
  }

  play(event) {
    if (!this.enabled || this.context?.state !== 'running') return;
    const alarm = ['raid', 'drought', 'start_war'].includes(event.action);
    if (!alarm && !['create_rain', 'create_forest', 'bless_village', 'increase_food', 'prepare_defense',
      'build_temple', 'build_house', 'form_alliance'].includes(event.action)) return;
    const now = this.context.currentTime;
    if (now - this.lastCue < 0.25 || this.active.size >= 4) return;
    this.lastCue = now;
    try {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(alarm ? 220 : 523.25, now);
      oscillator.frequency.exponentialRampToValueAtTime(alarm ? 164.81 : 783.99, now + 0.18);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      oscillator.connect(gain); gain.connect(this.context.destination);
      this.active.add(oscillator);
      oscillator.onended = () => { this.active.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now); oscillator.stop(now + 0.32);
    } catch { this.mute(); }
  }

  stop() { this.closed = true; this.mute(); void this.context?.close().catch(() => {}); }
}
