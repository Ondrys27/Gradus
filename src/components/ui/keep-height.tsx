"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Keeps a region as tall as it was when its content is swapped (a tab, a
 * filter) until the new content has loaded. Without it the short loading
 * skeleton shrinks the page for a moment, the browser pulls the scroll
 * position up with it and it never comes back: the page "jumps to the top".
 *
 * The content says it is still loading with `useHoldHeight(loading)`; the
 * region releases the old height once nothing holds it (at the latest after
 * `maxHoldMs`). A first render has no old height and holds nothing.
 */

type Holder = { hold: () => () => void };

const KeepHeightContext = createContext<Holder | null>(null);

/** The longest a region keeps its old height, should the content never say it is done. */
export const KEEP_HEIGHT_MAX_MS = 8_000;

export function KeepHeight({
  token,
  children,
  className,
  maxHoldMs = KEEP_HEIGHT_MAX_MS,
  ...props
}: {
  /** Changes when the content is swapped (e.g. the active tab). */
  token: string;
  children: ReactNode;
  className?: string;
  maxHoldMs?: number;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  const holds = useRef(0);
  const locked = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const seenToken = useRef(token);

  const holder = useMemo<Holder>(() => {
    const release = () => {
      locked.current = false;
      window.clearTimeout(timer.current);
      if (ref.current) ref.current.style.minHeight = "";
    };
    return {
      hold() {
        holds.current += 1;
        let done = false;
        return () => {
          if (done) return;
          done = true;
          holds.current -= 1;
          if (holds.current === 0 && locked.current) release();
        };
      },
    };
  }, []);

  // Remember the height while nothing is held; never a zero (a hidden region).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (locked.current) return;
      const height = element.getBoundingClientRect().height;
      if (height > 0) lastHeight.current = height;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Children's layout effects (their holds) run before this one, so a new
  // content still loading is already counted when the token changes.
  useLayoutEffect(() => {
    if (seenToken.current === token) return;
    seenToken.current = token;
    const element = ref.current;
    if (!element || holds.current === 0 || lastHeight.current <= 0) return;
    locked.current = true;
    element.style.minHeight = `${lastHeight.current}px`;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      locked.current = false;
      if (ref.current) ref.current.style.minHeight = "";
    }, maxHoldMs);
  }, [token, maxHoldMs]);

  useLayoutEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <KeepHeightContext.Provider value={holder}>
      <div ref={ref} className={className} {...props}>
        {children}
      </div>
    </KeepHeightContext.Provider>
  );
}

/** Inside a `KeepHeight`: holds its old height while `loading`. Outside it does nothing. */
export function useHoldHeight(loading: boolean) {
  const holder = useContext(KeepHeightContext);
  useLayoutEffect(() => {
    if (!loading || !holder) return;
    return holder.hold();
  }, [loading, holder]);
}
