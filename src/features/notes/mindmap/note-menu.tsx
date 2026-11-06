"use client";

import { Fragment, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { EllipsisIcon } from "lucide-react";
import { downloadBlob } from "@/lib/download";
import { mapFileName } from "@/features/milestones/map-io";
import { toFreeMind, toMarkdown, toOpml, type MindMapTree } from "@/lib/mindmap/formats";
import { cn } from "@/lib/utils";

export type NoteMenuItem = {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  testId?: string;
};
export type NoteMenuGroup = { label?: string; items: NoteMenuItem[] };

const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-disabled:cursor-default data-disabled:opacity-50 data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";

/** The "…" of an open note: import, export and turning it into the other kind. */
export function NoteMenu({ label, groups }: { label: string; groups: NoteMenuGroup[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        title={label}
        data-testid="note-more"
        className="grid size-11 cursor-pointer place-items-center rounded-xl text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8 [&_svg]:size-4"
      >
        <EllipsisIcon aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-popover">
          <Menu.Popup className="min-w-56 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            {groups.map((group, index) => (
              <Fragment key={index}>
                {index > 0 && <Menu.Separator className="my-1 h-px bg-line" />}
                <Menu.Group>
                  {group.label && (
                    <Menu.GroupLabel className="micro-label px-3 pt-1.5 pb-1">{group.label}</Menu.GroupLabel>
                  )}
                  {group.items.map((item) => (
                    <Menu.Item
                      key={item.key}
                      disabled={item.disabled}
                      className={cn(itemClass)}
                      onClick={item.onSelect}
                      data-testid={item.testId}
                    >
                      {item.icon}
                      {item.label}
                    </Menu.Item>
                  ))}
                </Menu.Group>
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export const TEXT_EXPORTS = ["markdown", "opml", "freemind"] as const;
export type TextExport = (typeof TEXT_EXPORTS)[number];

const WRITERS: Record<TextExport, { extension: string; type: string; write: (tree: MindMapTree) => string }> = {
  markdown: {
    extension: "md",
    type: "text/markdown",
    write: (tree) => toMarkdown(tree, { checkboxes: false }),
  },
  opml: { extension: "opml", type: "text/x-opml", write: toOpml },
  freemind: { extension: "mm", type: "application/x-freemind", write: toFreeMind },
};

/** Downloads a note's tree as Markdown, OPML or FreeMind; made in the browser, nothing is sent. */
export function downloadTree(format: TextExport, tree: MindMapTree, fallbackName: string) {
  const { extension, type, write } = WRITERS[format];
  downloadBlob(
    new Blob([write(tree)], { type: `${type};charset=utf-8` }),
    mapFileName(tree.title, extension, fallbackName),
  );
}
