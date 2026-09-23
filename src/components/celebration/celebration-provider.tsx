"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CelebrationCard } from "./celebration-card";

export type CelebrationOptions = {
  title: string;
  subtitle?: string;
  /** XP awarded; the +XP badge is hidden when missing or zero. */
  xp?: number;
};

type QueuedCelebration = CelebrationOptions & { id: number };

const CelebrationContext = createContext<((options: CelebrationOptions) => void) | null>(null);

/**
 * Full-screen celebration for big moments only (won deal, finished milestone, level up).
 * Small wins get a small animation in place, not this.
 */
export function useCelebration() {
  const celebrate = useContext(CelebrationContext);
  if (!celebrate) throw new Error("useCelebration must be used inside <CelebrationProvider>");
  return { celebrate };
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedCelebration[]>([]);
  const nextId = useRef(0);
  const current = queue[0] ?? null;

  // Keep the last card on screen while the dialog fades out.
  const [shown, setShown] = useState<QueuedCelebration | null>(null);
  if (current && current !== shown) setShown(current);

  const celebrate = useCallback((options: CelebrationOptions) => {
    setQueue((q) => [...q, { ...options, id: nextId.current++ }]);
  }, []);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  return (
    <CelebrationContext.Provider value={celebrate}>
      {children}
      <Dialog.Root
        open={current !== null}
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
        disablePointerDismissal
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-60 bg-canvas/75 backdrop-blur-md transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup
            initialFocus={false}
            className="fixed inset-0 z-60 grid place-items-center overflow-y-auto p-4 outline-none transition-opacity duration-200 data-ending-style:opacity-0"
          >
            {shown && <CelebrationCard key={shown.id} {...shown} onContinue={dismiss} />}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </CelebrationContext.Provider>
  );
}
