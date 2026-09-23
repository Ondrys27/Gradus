/** C5 → E5 → G5: a short rising major arpeggio. */
export const CELEBRATION_NOTES = [523.25, 659.25, 783.99] as const;
const NOTE_GAP = 0.11;
const NOTE_LENGTH = 0.32;

let context: AudioContext | null = null;

/** Synthesised with Web Audio so there is no sound file to load. Silently does nothing if audio is unavailable. */
export function playCelebrationSound() {
  try {
    context ??= new AudioContext();
    const ctx = context;
    if (ctx.state === "suspended") void ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);

    const start = ctx.currentTime + 0.02;
    CELEBRATION_NOTES.forEach((frequency, index) => {
      const at = start + index * NOTE_GAP;
      const length = index === CELEBRATION_NOTES.length - 1 ? NOTE_LENGTH * 1.8 : NOTE_LENGTH;

      // A triangle body with a quiet sine an octave up for sparkle.
      for (const [type, multiple, level] of [
        ["triangle", 1, 1],
        ["sine", 2, 0.25],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = frequency * multiple;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(level, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
        osc.connect(gain).connect(master);
        osc.start(at);
        osc.stop(at + length + 0.05);
      }
    });
  } catch {
    // No audio support: the celebration stays silent.
  }
}
