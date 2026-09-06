/** Procedural skate/wind audio. No downloads; the context starts only on a gesture. */
export class RaceAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        const ctx = this.context;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.3;
        this.master.connect(ctx.destination);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) { last = (last + (Math.random() * 2 - 1) * 0.025) / 1.025; data[i] = last * 3.5; }
        const source = ctx.createBufferSource();
        source.buffer = this.noise; source.loop = true;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1800;
        this.wind = ctx.createGain(); this.wind.gain.value = 0;
        source.connect(filter).connect(this.wind).connect(this.master);
        source.start();
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    } catch { /* Audio support is optional; racing must remain available. */ }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.context && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.3, this.context.currentTime, 0.025);
  }

  update(speed: number, moving: boolean, boosting: boolean) {
    if (this.context && this.wind) this.wind.gain.setTargetAtTime(moving ? 0.12 + speed * 0.014 + (boosting ? 0.12 : 0) : 0, this.context.currentTime, 0.1);
  }

  tone(frequency: number, duration = 0.13, delay = 0, volume = 0.19) {
    if (!this.context || !this.master || this.muted) return;
    const ctx = this.context, start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start); oscillator.stop(start + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  stride(perfect: boolean) {
    if (!this.context || !this.master || !this.noise || this.muted) return;
    const ctx = this.context, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noise;
    filter.type = 'highpass'; filter.frequency.value = 900;
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.17);
    source.connect(filter).connect(gain).connect(this.master); source.start(); source.stop(ctx.currentTime + 0.18);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    if (perfect) this.tone(990, 0.065, 0, 0.09);
  }

  finish(won: boolean) {
    (won ? [523, 659, 784, 1047] : [440, 554, 659]).forEach((frequency, i) => this.tone(frequency, 0.28, i * 0.13));
  }
  dispose() { if (this.context) void this.context.close().catch(() => undefined); this.context = null; }
}
