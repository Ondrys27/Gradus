"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CRASH_TEST_EVENT, CRASH_TEST_MESSAGE } from "./crash-test";

const subscribe = () => () => {};

/**
 * Throws as soon as it renders in the browser (the server's render passes, so
 * the error is the browser's own, like most real ones), inside the page, where
 * the app's error boundary catches it. With `later`, the page first renders
 * normally and throws when the window gets CRASH_TEST_EVENT, so a test can
 * open Jarvis (or anything else) before the crash, as a real one happens.
 */
export function CrashOnRender({
  later = false,
  message = CRASH_TEST_MESSAGE,
}: {
  later?: boolean;
  message?: string;
}): null {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    if (!later) return;
    const crash = () => setTriggered(true);
    window.addEventListener(CRASH_TEST_EVENT, crash);
    return () => window.removeEventListener(CRASH_TEST_EVENT, crash);
  }, [later]);

  if (inBrowser && (!later || triggered)) throw new Error(message);
  return null;
}
