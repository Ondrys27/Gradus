"use client";

import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { useIsPhone } from "@/lib/use-media-query";
import { BottomSheet } from "./bottom-sheet";

type SidePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
};

/** A panel sliding in from the right on larger screens, a bottom sheet on phones. */
export function SidePanel({ open, onOpenChange, title, closeLabel, children }: SidePanelProps) {
  const isPhone = useIsPhone();

  if (isPhone) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title={title} closeLabel={closeLabel}>
        {children}
      </BottomSheet>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-canvas/60 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw,440px)] flex-col overflow-y-auto border-l border-line-strong bg-surface p-6 shadow-popover outline-none transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog.Title className="min-w-0 truncate text-lg font-semibold text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="-mr-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
