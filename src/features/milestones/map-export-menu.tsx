"use client";

import { Menu } from "@base-ui/react/menu";
import { DownloadIcon, FileCodeIcon, FileTextIcon, ImageIcon, NetworkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { captureMindMap } from "@/components/mindmap/capture";
import { track } from "@/lib/analytics/client";
import { downloadBlob } from "@/lib/download";
import { toFreeMind, toMarkdown, toOpml, type MindMapTree } from "@/lib/mindmap/formats";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { EXPORT_FORMATS, mapFileName, tasksToMindMap, type ExportFormat } from "./map-io";
import type { TaskView } from "./task-view-preference";
import type { Milestone, Task } from "./types";

type Props = {
  milestone: Milestone;
  tasks: Task[];
  view: TaskView;
  /** Where the map is drawn; the PNG is taken from it. */
  mapContainer: () => HTMLElement | null;
  /** The PNG needs the map on screen: from the list it switches to the map first. */
  showMap: () => void;
  onFailed: () => void;
};

const ICONS = {
  markdown: FileTextIcon,
  opml: FileCodeIcon,
  freemind: NetworkIcon,
  png: ImageIcon,
} as const;

type TextFormat = { extension: string; type: string; write: (tree: MindMapTree) => string };

const TEXT_FORMATS: Record<Exclude<ExportFormat, "png">, TextFormat> = {
  // Every task carries its state, so the boxes are always written.
  markdown: {
    extension: "md",
    type: "text/markdown",
    write: (tree) => toMarkdown(tree, { checkboxes: true }),
  },
  opml: { extension: "opml", type: "text/x-opml", write: toOpml },
  freemind: { extension: "mm", type: "application/x-freemind", write: toFreeMind },
};

/** "Export": the milestone's map as Markdown, OPML, FreeMind or a picture. */
export function MapExportMenu({ milestone, tasks, view, mapContainer, showMap, onFailed }: Props) {
  const t = useTranslations("milestones.mapIo.export");
  const tio = useTranslations("milestones.mapIo");
  const reduceMotion = useReducedMotionSafe() ?? false;
  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";

  async function run(format: ExportFormat) {
    const fileName = (extension: string) =>
      mapFileName(milestone.title, extension, tio("fileFallback"));
    try {
      if (format === "png") {
        const justShown = view !== "map";
        if (justShown) showMap();
        // The map mounts on the next render; the capture waits for its canvas.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const container = mapContainer();
        if (!container) throw new Error("no map");
        downloadBlob(await captureMindMap(container, { justShown, reduceMotion }), fileName("png"));
      } else {
        const { extension, type, write } = TEXT_FORMATS[format];
        const text = write(tasksToMindMap(milestone, tasks));
        downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), fileName(extension));
      }
      track("mindmap_exported", { format, from: view });
    } catch {
      onFailed();
    }
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("label")}
        className="flex h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8"
      >
        <DownloadIcon aria-hidden className="size-4" />
        <span className="max-sm:sr-only">{t("button")}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-popover">
          <Menu.Popup className="min-w-52 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            {EXPORT_FORMATS.map((format) => {
              const Icon = ICONS[format];
              return (
                <Menu.Item key={format} className={itemClass} onClick={() => void run(format)}>
                  <Icon aria-hidden />
                  {t(format)}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
