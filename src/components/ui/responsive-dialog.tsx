"use client";

import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./bottom-sheet";

type ResponsiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  closeLabel: string;
  className?: string;
  children: ReactNode;
};

/** A centred dialog on larger screens, a bottom sheet on phones. */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  closeLabel,
  className,
  children,
}: ResponsiveDialogProps) {
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
        <Dialog.Backdrop className="fixed inset-0 z-overlay bg-canvas/70 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-overlay max-h-[85dvh] w-[min(100vw-32px,440px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-line-strong bg-surface p-6 shadow-popover outline-none",
            "transition-[opacity,scale] duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="-mr-2 grid size-10 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
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
