"use client";

import type { ReactNode, RefObject } from "react";
import { Drawer } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Accessible name of the close button. */
  closeLabel: string;
  /** Where focus returns on close when the sheet has no Drawer.Trigger. */
  finalFocus?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
};

/**
 * Phone dialogs open as a panel from the bottom edge. Swipe down, the backdrop or the
 * close button dismisses it. The bottom-right corner stays Jarvis's once it closes.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  finalFocus,
  className,
  children,
}: BottomSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-canvas/70 opacity-[calc(1-var(--drawer-swipe-progress))] backdrop-blur-sm transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
          <Drawer.Popup
            finalFocus={finalFocus}
            className={cn(
              "max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border-t border-line-strong bg-surface px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-popover outline-none",
              "translate-y-(--drawer-swipe-movement-y) transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-y-full data-starting-style:translate-y-full data-swiping:duration-0 data-swiping:select-none",
              className,
            )}
          >
            <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" />
            <Drawer.Content>
              <div className="mb-3 flex items-center justify-between">
                <Drawer.Title className="micro-label">{title}</Drawer.Title>
                <Drawer.Close
                  aria-label={closeLabel}
                  className="-mr-2 grid size-11 place-items-center rounded-full text-ink-soft outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <XIcon aria-hidden className="size-5" />
                </Drawer.Close>
              </div>
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
