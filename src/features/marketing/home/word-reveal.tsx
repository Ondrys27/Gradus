import type { CSSProperties } from "react";

/** Seconds between two words. */
export const WORD_STAGGER = 0.06;

/**
 * Text whose words rise in one after another. A CSS animation, not Framer
 * Motion: it starts with the first paint, before any JavaScript, so the
 * headline (the largest element in view) is never held back by hydration.
 * Reduced motion shows the text at once.
 */
export function WordReveal({
  text,
  startDelay = 0,
  stagger = WORD_STAGGER,
  className,
}: {
  text: string;
  /** Seconds before the first word. */
  startDelay?: number;
  /** Seconds between two words. */
  stagger?: number;
  className?: string;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <span className={className}>
      {words.map((word, index) => (
        <span key={index}>
          <span
            className="inline-block animate-word-in motion-reduce:animate-none"
            style={
              { animationDelay: `${(startDelay + index * stagger).toFixed(3)}s` } as CSSProperties
            }
          >
            {word}
          </span>
          {index < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}

/** When the last word of a text has started, for chaining the next element. */
export function wordRevealEnd(text: string, startDelay = 0, stagger = WORD_STAGGER): number {
  return startDelay + text.split(/\s+/).filter(Boolean).length * stagger;
}
