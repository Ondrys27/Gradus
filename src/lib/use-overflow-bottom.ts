import { useEffect, useState, type RefObject } from "react";

/** Below this many pixels of remaining scroll, the end counts as reached. */
const THRESHOLD = 4;

/**
 * Whether a scrollable element still has content below the fold — for a
 * fade hint at the bottom of a list that nudges "there's more, scroll me".
 * Re-checks on scroll, on resize and whenever the element's content changes
 * size (a list that loads in, say), never assuming a size the first paint
 * hasn't measured yet.
 */
export function useOverflowBottom(ref: RefObject<HTMLElement | null>): boolean {
  const [moreBelow, setMoreBelow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const check = () => {
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      setMoreBelow(remaining > THRESHOLD);
    };

    check();
    element.addEventListener("scroll", check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);

    return () => {
      element.removeEventListener("scroll", check);
      observer.disconnect();
    };
  });

  return moreBelow;
}
