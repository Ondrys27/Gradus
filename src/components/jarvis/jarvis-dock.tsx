"use client";

import { useCallback, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { JarvisButton } from "@/components/layout/jarvis-button";
import { useJarvisChat } from "@/features/jarvis/use-jarvis-chat";
import { JarvisPanel } from "./jarvis-panel";

/**
 * Jarvis in the bottom-right corner: the button and its panel. The chat lives
 * here, so an answer keeps streaming (and is saved) when the panel closes.
 */
export function JarvisDock() {
  const [open, setOpen] = useState(false);
  const chat = useJarvisChat();
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <JarvisButton
        state={chat.pending ? "thinking" : "idle"}
        expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      <AnimatePresence>{open && <JarvisPanel chat={chat} onClose={close} />}</AnimatePresence>
    </>
  );
}
