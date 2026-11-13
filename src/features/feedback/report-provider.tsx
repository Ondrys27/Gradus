"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useCloseOnErrorScreen } from "@/features/errors/error-screen-state";
import { track } from "@/lib/analytics/client";
import { installConsoleBuffer } from "./console-buffer";
import { ReportDialog } from "./report-dialog";

/** `jarvis` = from Grady's panel: DB name kept from Jarvis. */
export type ReportVia = "account_menu" | "more_panel" | "jarvis" | "grady_chat" | "shortcut";

type ReportContextValue = { open: (via: ReportVia) => void };

const ReportContext = createContext<ReportContextValue>({ open: () => {} });

/** Opens the "Report a problem" dialog from the account menu, the More panel and Grady. */
export function useReportProblem(): ReportContextValue {
  return useContext(ReportContext);
}

function isReportShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "b"
  );
}

/**
 * Holds the dialog's open state, starts collecting the console errors and
 * listens for Cmd/Ctrl+Shift+B. The shortcut does nothing while the error page
 * is up (it has its own Send feedback).
 */
export function ReportProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;

  useEffect(() => {
    installConsoleBuffer();
  }, []);

  const show = useCallback((via: ReportVia) => {
    if (!openRef.current) track("bug_report_opened", { via });
    setOpenState(true);
  }, []);
  const close = useCallback(() => setOpenState(false), []);
  useCloseOnErrorScreen(close);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isReportShortcut(event) || event.repeat) return;
      event.preventDefault();
      if (openRef.current) setOpenState(false);
      else show("shortcut");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show]);

  const value = useMemo(() => ({ open: show }), [show]);
  return (
    <ReportContext.Provider value={value}>
      {children}
      <ReportDialog open={open} onOpenChange={setOpenState} />
    </ReportContext.Provider>
  );
}
