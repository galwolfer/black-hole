export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;

  async enable(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;
      this.master = this.context.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    this.enabled = true;
    this.tone(220, 0.08, 'sine', 0.02);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.master = null;
    this.enabled = false;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, gainValue: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.enabled) {
      return;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(18, frequency * 0.2),
      context.currentTime + duration,
    );
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(1200, frequency * 8), context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(gainValue, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.03);
    oscillator.onended = () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  playSpawn(span: number): void {
    this.tone(96 + span * 600, 0.14, 'sine', 0.05);
    window.setTimeout(() => this.tone(320 + span * 1400, 0.12, 'triangle', 0.025), 24);
  }

  playGrab(): void {
    this.tone(180, 0.07, 'sine', 0.03);
  }

  playFlick(): void {
    this.tone(420, 0.18, 'triangle', 0.035);
  }

  playSlash(): void {
    this.tone(620, 0.1, 'sawtooth', 0.02);
  }
}
