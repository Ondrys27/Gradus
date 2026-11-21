import type { CaptionCue } from "./player";

/**
 * The captions of a recording as SubRip (.srt), from the times the player
 * measured (step 27.4). `offset` moves every cue, for a video whose first
 * seconds (loading, the countdown) were not part of the playing time.
 */

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(hours)}:${two(minutes)}:${two(seconds)},${String(millis).padStart(3, "0")}`;
}

export function toSrt(cues: readonly CaptionCue[], offset = 0): string {
  return cues
    .filter((cue) => cue.end > cue.start && cue.caption.trim())
    .map(
      (cue, index) =>
        `${index + 1}\n${timestamp(cue.start + offset)} --> ${timestamp(cue.end + offset)}\n${cue.caption.trim()}\n`,
    )
    .join("\n");
}
