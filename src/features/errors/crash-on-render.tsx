"use client";

import { useSyncExternalStore } from "react";
import { CRASH_TEST_MESSAGE } from "./crash-test";

const subscribe = () => () => {};

/**
 * Throws as soon as it renders in the browser (the server's render passes, so
 * the error is the browser's own, like most real ones), inside the page, where
 * the app's error boundary catches it.
 */
export function CrashOnRender(): null {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (inBrowser) throw new Error(CRASH_TEST_MESSAGE);
  return null;
}
