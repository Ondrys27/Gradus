"use client";

import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import Mention from "@tiptap/extension-mention";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { SuggestionProps } from "@tiptap/suggestion";
import { useTranslations } from "next-intl";
import { KIND_ICONS } from "@/features/search/use-search-rows";
import { track } from "@/lib/analytics/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { mentionHref } from "./mention-queries";
import {
  isMentionKind,
  mentionKey,
  type MentionAttrs,
  type MentionTarget,
} from "./mentions";

// ---------------------------------------------------------------------------
// The @ menu: the suggestion plugin reports what is typed after @, the menu
// (mention-menu.tsx) renders the choices and takes the arrow keys and Enter.
// ---------------------------------------------------------------------------

export type MentionMenuState = {
  query: string;
  rect: DOMRect | null;
  command: (attrs: MentionAttrs) => void;
} | null;

/** The link between the editor's suggestion plugin and the React menu. */
export class MentionMenuBridge {
  private state: MentionMenuState = null;
  private listeners = new Set<() => void>();
  /** The open menu's keyboard: true when it took the key. */
  keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  /** How the menu was opened, for analytics: typed @ or the toolbar's "Link to…". */
  via: "typed" | "button" = "typed";

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): MentionMenuState => this.state;

  set(next: MentionMenuState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  fromProps(props: SuggestionProps<unknown, MentionAttrs>) {
    this.set({ query: props.query, rect: props.clientRect?.() ?? null, command: props.command });
  }
}

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

/** The current state of the mentioned records, given by the open editor. */
export const MentionTargetsContext = createContext<ReadonlyMap<string, MentionTarget> | undefined>(
  undefined,
);

function MentionChip({ node }: ReactNodeViewProps) {
  const t = useTranslations("notes.mention");
  const router = useRouter();
  const settings = useFormatSettings();
  const targets = useContext(MentionTargetsContext);
  const { type, id, label: stored } = node.attrs as Partial<MentionAttrs>;
  const kind = isMentionKind(type) ? type : null;
  const target = kind && id ? targets?.get(mentionKey(kind, id)) : undefined;
  const label = (target?.exists ? target.label : stored) || t("unnamed");
  const missing = !kind || !id || target?.exists === false;
  const Icon = kind ? KIND_ICONS[kind] : KIND_ICONS.contact;

  const chip = "inline-flex max-w-full items-baseline gap-1 rounded-md px-1.5 align-baseline text-[0.94em] font-medium leading-snug";

  return (
    <NodeViewWrapper
      as="span"
      data-testid="note-mention"
      data-mention-type={kind ?? undefined}
      data-state={missing ? "missing" : "live"}
    >
      {missing ? (
        <span
          title={t("missing")}
          aria-label={t("missingLabel", { label })}
          className={cn(chip, "cursor-default bg-surface text-ink-muted")}
        >
          <Icon aria-hidden className="size-[0.9em] shrink-0 self-center" />
          <s className="truncate">{label}</s>
        </span>
      ) : (
        <button
          type="button"
          title={t(`open.${kind}`)}
          onClick={(event) => {
            event.preventDefault();
            track("note_mention_opened", { target: kind });
            router.push(mentionHref(kind, id, settings, target?.exists ? target.startsAt : null));
          }}
          className={cn(
            chip,
            "cursor-pointer bg-violet/14 text-ink outline-none transition-colors hover:bg-violet/24 focus-visible:ring-2 focus-visible:ring-violet/50",
          )}
        >
          <Icon aria-hidden className="size-[0.9em] shrink-0 self-center text-violet" />
          <span className="truncate">{label}</span>
        </button>
      )}
    </NodeViewWrapper>
  );
}

/**
 * A mention of a contact, deal, event or worker: an inline atom with
 * { type, id, label }, typed with @ (or "Link to…" in the toolbar). Backspace
 * right after a chip removes it whole.
 */
export function createRecordMention(bridge: MentionMenuBridge) {
  return Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        type: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("data-mention-type"),
          renderHTML: (attributes: Record<string, unknown>) =>
            typeof attributes.type === "string" ? { "data-mention-type": attributes.type } : {},
        },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(MentionChip, { as: "span" });
    },
  }).configure({
    deleteTriggerWithBackspace: true,
    renderText: ({ node }) => `@${(node.attrs.label as string | null) ?? ""}`,
    renderHTML: ({ options, node }) => [
      "span",
      options.HTMLAttributes,
      `@${(node.attrs.label as string | null) ?? ""}`,
    ],
    suggestion: {
      char: "@",
      items: () => [],
      render: () => ({
        onStart: (props) => bridge.fromProps(props as SuggestionProps<unknown, MentionAttrs>),
        onUpdate: (props) => bridge.fromProps(props as SuggestionProps<unknown, MentionAttrs>),
        onKeyDown: ({ event }) => {
          if (event.key === "Escape") return true;
          return bridge.keyHandler?.(event) ?? false;
        },
        onExit: () => {
          bridge.set(null);
          bridge.via = "typed";
        },
      }),
    },
  });
}

