"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { JarvisButton } from "@/components/layout/jarvis-button";
import { useJarvisSuggestions } from "@/features/jarvis/queries";
import { useJarvisChat } from "@/features/jarvis/use-jarvis-chat";
import { track } from "@/lib/analytics/client";
import { whenIdle } from "@/lib/idle";
import { AutoActionNotice } from "./auto-action-notice";
import { ProactiveJarvis } from "./proactive-jarvis";

const loadPanel = () => import("./jarvis-panel");

/** The chat panel is not part of the first load; it is fetched when idle. */
const JarvisPanel = dynamic(() => loadPanel().then((module) => module.JarvisPanel), {
  ssr: false,
});

/**
 * Jarvis in the bottom-right corner: the button and its panel. The chat lives
 * here, so an answer keeps streaming (and is saved) when the panel closes.
 * Unseen suggestions make the button's ring pulse; a task Jarvis marked done
 * is announced next to the button with Undo, never silently. Now and then
 * Jarvis also flies in on his own (bottom left) when he has something to say.
 */
export function JarvisDock() {
  const [open, setOpen] = useState(false);
  const chat = useJarvisChat();
  const suggestions = useJarvisSuggestions();
  const close = useCallback(() => setOpen(false), []);
  const send = chat.send;
  const ask = useCallback(
    (prompt: string) => {
      setOpen(true);
      void send(prompt);
    },
    [send],
  );

  // Fetched once the browser is idle, so the first tap on Jarvis opens at once.
  useEffect(() => whenIdle(loadPanel), []);
  useEffect(() => {
    if (open) track("jarvis_opened", {});
  }, [open]);

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
      <ProactiveJarvis panelOpen={open} onAsk={ask} />
    </>
  );
}
