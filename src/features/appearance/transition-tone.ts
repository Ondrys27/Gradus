import type { DayPeriod } from "./schedule";

/**
 * A short, gentle tone for each time of day, synthesised with Web Audio (no
 * sound file): morning rises bright, afternoon is a warm open fifth, evening
 * falls softly, night is low and slow. About a second and a half, quiet.
 */
export const PERIOD_TONES: Record<DayPeriod, { notes: number[]; gap: number; length: number; type: OscillatorType }> = {
  // D5 → F#5 → A5 → D6
  morning: { notes: [587.33, 739.99, 880, 1174.66], gap: 0.09, length: 0.7, type: "sine" },
  // F4 + C5, then A5
  afternoon: { notes: [349.23, 523.25, 880], gap: 0.12, length: 0.9, type: "triangle" },
  // A5 → E5 → C5
  evening: { notes: [880, 659.25, 523.25], gap: 0.16, length: 1.0, type: "sine" },
  // G3 → D4
  night: { notes: [196, 293.66], gap: 0.28, length: 1.3, type: "sine" },
};

/** When the name of the block has arrived in the transition (transition-overlay.tsx: delay + half the ease). */
const NAME_LANDS_S = 0.34;

let context: AudioContext | null = null;

export function playPeriodTone(period: DayPeriod) {
  try {
    context ??= new AudioContext();
    const ctx = context;
    if (ctx.state === "suspended") void ctx.resume();
    const tone = PERIOD_TONES[period];
    const master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);
    // The last note lands as the block's name settles on the screen (about a third of a second in).
    const start = ctx.currentTime + Math.max(0.03, NAME_LANDS_S - (tone.notes.length - 1) * tone.gap);
    tone.notes.forEach((frequency, index) => {
      const at = start + index * tone.gap;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(index === 0 ? 0.9 : 0.7, at + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.length);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + tone.length + 0.05);
    });
  } catch {
    // No audio: the transition stays silent.
  }
}
