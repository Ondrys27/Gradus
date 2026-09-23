import { useState } from "react";

/** Changes every time `open` turns true, so a form keyed by it starts from fresh values. */
export function useFreshOnOpen(open: boolean): number {
  const [wasOpen, setWasOpen] = useState(open);
  const [generation, setGeneration] = useState(0);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setGeneration((value) => value + 1);
  }
  return generation;
}
