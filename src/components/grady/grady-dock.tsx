"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { GradyButton } from "@/components/layout/grady-button";
import { useCloseOnErrorScreen } from "@/features/errors/error-screen-state";
import { useGradySuggestions } from "@/features/grady/queries";
import { useGradyChat } from "@/features/grady/use-grady-chat";
import { track } from "@/lib/analytics/client";
import { whenIdle } from "@/lib/idle";
import { AutoActionNotice } from "./auto-action-notice";
import { NotesIntro } from "./notes-intro";
import { DaySummary } from "./day-summary";
import { ProactiveGrady } from "./proactive-grady";

const loadPanel = () => import("./grady-panel");

/** The chat panel is not part of the first load; it is fetched when idle. */
const GradyPanel = dynamic(() => loadPanel().then((module) => module.GradyPanel), {
  ssr: false,
});

/**
 * Grady in the bottom-right corner: the button and its panel. The chat lives
 * here, so an answer keeps streaming (and is saved) when the panel closes.
 * Unseen suggestions make the button's ring pulse; a task Grady marked done
 * is announced next to the button with Undo, never silently. Now and then
 * Grady also flies in on his own (bottom left) when he has something to say.
 * While the error page is on screen, none of it shows and the panel closes.
 */
export function GradyDock() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Not on the error page; the chat keeps its state for when the page is back.
  const errorShown = useCloseOnErrorScreen(close);
  const chat = useGradyChat();
  const suggestions = useGradySuggestions();
  const send = chat.send;
  const ask = useCallback(
    (prompt: string) => {
      setOpen(true);
      void send(prompt);
    },
    [send],
  );

  // Fetched once the browser is idle, so the first tap on Grady opens at once.
  useEffect(() => whenIdle(loadPanel), []);
  useEffect(() => {
    if (open) track("jarvis_opened", {});
  }, [open]);

  const list = suggestions.data ?? [];
  const unseen = list.filter((item) => !item.seen).length;
  const autoActions = list.filter((item) => item.type === "taskCompleted" && !item.seen);

  if (errorShown) return null;

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
      <GradyButton
        state={chat.pending ? "thinking" : "idle"}
        expanded={open}
        attention={unseen}
        onClick={() => setOpen((value) => !value)}
      />
      <AnimatePresence>{open && <GradyPanel chat={chat} onClose={close} />}</AnimatePresence>
      <DaySummary panelOpen={open} />
      <ProactiveGrady panelOpen={open} onAsk={ask} />
      <NotesIntro panelOpen={open} />
    </>
  );
}
