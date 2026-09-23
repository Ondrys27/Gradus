export type Tone = "neutral" | "violet" | "teal" | "gold" | "green" | "pink";

/** Static class maps so Tailwind can see every class name. */
export const toneText: Record<Tone, string> = {
  neutral: "text-ink-soft",
  violet: "text-violet",
  teal: "text-teal",
  gold: "text-gold",
  green: "text-green",
  pink: "text-pink",
};

export const toneSoft: Record<Tone, string> = {
  neutral: "border-line bg-surface-hover text-ink-soft",
  violet: "border-violet/30 bg-violet/12 text-violet",
  teal: "border-teal/30 bg-teal/10 text-teal",
  gold: "border-gold/30 bg-gold/10 text-gold",
  green: "border-green/30 bg-green/10 text-green",
  pink: "border-pink/30 bg-pink/10 text-pink",
};

export const toneFill: Record<Tone, string> = {
  neutral: "bg-ink-muted",
  violet: "bg-violet",
  teal: "bg-teal",
  gold: "bg-gold",
  green: "bg-green",
  pink: "bg-pink",
};
