"use client";

import { useCallback, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { JarvisButton } from "@/components/layout/jarvis-button";
import { useJarvisSuggestions } from "@/features/jarvis/queries";
import { useJarvisChat } from "@/features/jarvis/use-jarvis-chat";
import { AutoActionNotice } from "./auto-action-notice";
import { JarvisPanel } from "./jarvis-panel";

/**
 * Jarvis in the bottom-right corner: the button and its panel. The chat lives
 * here, so an answer keeps streaming (and is saved) when the panel closes.
 * Unseen suggestions make the button's ring pulse; a task Jarvis marked done
 * is announced next to the button with Undo, never silently.
 */
export function JarvisDock() {
  const [open, setOpen] = useState(false);
  const chat = useJarvisChat();
  const suggestions = useJarvisSuggestions();
  const close = useCallback(() => setOpen(false), []);

  const list = suggestions.data ?? [];
  const unseen = list.filter((item) => !item.seen).length;
  const autoActions = list.filter((item) => item.type === "taskCompleted" && !item.seen);

  return (
    <>
      <AnimatePresence>
        {!open && autoActions.length > 0 && (
          <AutoActionNotice
            key="notice"
            suggestions={autoActions}
            onOpenPanel={() => setOpen(true)}
          />
        )}
      </AnimatePresence>
      <JarvisButton
        state={chat.pending ? "thinking" : "idle"}
        expanded={open}
        attention={unseen}
        onClick={() => setOpen((value) => !value)}
      />
      <AnimatePresence>{open && <JarvisPanel chat={chat} onClose={close} />}</AnimatePresence>
    </>
  );
}
