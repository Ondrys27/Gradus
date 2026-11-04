"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocale, useTranslations } from "next-intl";
import { formatCalendarDate, formatWeekdayLong, isoDateToLocal, todayIsoDate } from "@/lib/format";
import { addDaysIso } from "@/features/calendar/calendar-logic";
import { useFormatSettings } from "@/lib/use-format-settings";
import { messageRows, readCount, canDeleteMessage, canEditMessage } from "./logic";
import { MessageBubble, type BubbleActions } from "./message-bubble";
import type { ChatKind, ChatMemberRead, ChatMessage } from "./types";

export type MessageListHandle = {
  scrollToEnd: () => void;
  scrollToMessage: (id: string) => boolean;
};

type MessageListProps = {
  messages: readonly ChatMessage[];
  me: string;
  isSpaceOwner: boolean;
  /** Nothing can be written here (read only, an archived group, a removed person). */
  writable: boolean;
  kind: ChatKind;
  members: readonly ChatMemberRead[];
  /** The unread divider goes above this message. */
  unreadFrom: string | null;
  trashed: ReadonlySet<string>;
  highlight: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Whether the newest message is in view (marking read waits for it). */
  onAtEndChange: (atEnd: boolean) => void;
  actions: BubbleActions;
  replyOf: (id: string) => ChatMessage | null | undefined;
};

/**
 * The messages of a conversation, oldest at the top. Virtualised: only the
 * rows near the view are in the page, measured as they come; older pages
 * load when the top comes near, keeping what is on screen where it was; a new
 * message follows only when the reader is at the bottom.
 */
export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  {
    messages,
    me,
    isSpaceOwner,
    writable,
    kind,
    members,
    unreadFrom,
    trashed,
    highlight,
    hasOlder,
    loadingOlder,
    onLoadOlder,
    onAtEndChange,
    actions,
    replyOf,
  },
  ref,
) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const settings = useFormatSettings();
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => messageRows([...messages], settings.timeZone, unreadFrom),
    [messages, settings.timeZone, unreadFrom],
  );
  const others = Math.max(0, members.length - 1);
  const now = Date.now();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (rows[index]?.type === "message" ? 56 : 40),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 10,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 48,
    paddingStart: 8,
    paddingEnd: 12,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToEnd: () => {
        requestAnimationFrame(() => virtualizer.scrollToEnd());
      },
      scrollToMessage: (id) => {
        const index = rows.findIndex((row) => row.key === id);
        if (index < 0) return false;
        virtualizer.scrollToIndex(index, { align: "center" });
        return true;
      },
    }),
    [rows, virtualizer],
  );

  // First view of a conversation: at the unread divider, or at the bottom.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || rows.length === 0) return;
    placed.current = true;
    const unread = rows.findIndex((row) => row.type === "unread");
    if (unread > 0) virtualizer.scrollToIndex(unread, { align: "start" });
    else virtualizer.scrollToEnd();
  }, [rows, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const atEnd = virtualizer.isAtEnd(48);
  useEffect(() => onAtEndChange(atEnd || rows.length === 0), [atEnd, rows.length, onAtEndChange]);

  // Older messages when the top comes near.
  const firstIndex = items[0]?.index ?? 0;
  useEffect(() => {
    if (placed.current && hasOlder && !loadingOlder && firstIndex < 4) onLoadOlder();
  }, [firstIndex, hasOlder, loadingOlder, onLoadOlder]);

  const today = todayIsoDate(settings);
  const yesterday = addDaysIso(today, -1);
  const dayLabel = (day: string) => {
    if (day === today) return t("today");
    if (day === yesterday) return t("yesterday");
    const date = isoDateToLocal(day);
    const weekday = formatWeekdayLong(date, locale);
    return `${weekday.charAt(0).toLocaleUpperCase(locale)}${weekday.slice(1)} ${formatCalendarDate(day, settings)}`;
  };

  return (
    <div
      ref={scroller}
      data-testid="chat-messages"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      aria-label={t("messagesLabel")}
      role="log"
    >
      {loadingOlder && (
        <p className="py-2 text-center text-xs text-ink-muted" aria-live="polite">
          {t("loadingOlder")}
        </p>
      )}
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const row = rows[item.index]!;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.type === "day" ? (
                <div className="flex justify-center py-2">
                  <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
                    {dayLabel(row.day)}
                  </span>
                </div>
              ) : row.type === "unread" ? (
                <div className="flex items-center gap-3 px-4 py-2" data-testid="chat-unread-divider">
                  <span className="h-px flex-1 bg-gold/40" />
                  <span className="text-xs font-semibold text-gold">{t("unreadDivider")}</span>
                  <span className="h-px flex-1 bg-gold/40" />
                </div>
              ) : (
                <MessageBubble
                  message={row.message}
                  me={me}
                  kind={kind}
                  own={row.message.sender === me}
                  first={row.first}
                  last={row.last}
                  readers={row.message.sender === me ? readCount(row.message, members) : 0}
                  others={others}
                  writable={writable}
                  canEdit={writable && canEditMessage(row.message, me, now)}
                  canDelete={writable && canDeleteMessage(row.message, me, isSpaceOwner, now)}
                  reply={row.message.reply_to_id ? replyOf(row.message.reply_to_id) : null}
                  trashed={trashed}
                  highlight={highlight === row.message.id}
                  actions={actions}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
