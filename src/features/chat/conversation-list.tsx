"use client";

import { useMemo, useState } from "react";
import { BellOffIcon, PaperclipIcon, PinIcon, SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatEditedAt } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { badgeText, isSilenced, matchesSearch, plainBody, sortChannels } from "./logic";
import { ChannelAvatar, PersonAvatar, useChannelTitle, usePeople } from "./people";
import { useChatMe } from "./queries";
import type { ChatChannel } from "./types";

type Selection = { channelId: string | null; to: string | null };

/**
 * The left column: the conversations (groups and people, newest first,
 * pinned on top) with their last message, time and unread count, then the
 * people one has not written to yet. The search looks at names and the last
 * message, without diacritics.
 */
export function ConversationList({
  channels,
  selected,
  onSelect,
  loading,
}: {
  channels: readonly ChatChannel[];
  selected: Selection;
  onSelect: (selection: Selection) => void;
  loading: boolean;
}) {
  const t = useTranslations("messages");
  const settings = useFormatSettings();
  const { me, space, isOwner } = useChatMe();
  const { people, byMember, nameOf } = usePeople();
  const titleOf = useChannelTitle();
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => sortChannels(channels), [channels]);
  const shown = sorted.filter((channel) =>
    matchesSearch(query, titleOf(channel), channel.last ? plainBody(channel.last.body, nameOf) : null),
  );
  const talkedTo = new Set(channels.filter((c) => c.kind === "direct").map((c) => c.peer));
  const others = people.filter(
    (person) =>
      person.member !== me &&
      !talkedTo.has(person.member) &&
      (person.status === "active" || person.isOwner || (isOwner && person.status === "invited")) &&
      matchesSearch(query, nameOf(person.member), person.jobTitle),
  );

  const preview = (channel: ChatChannel) => {
    const last = channel.last;
    if (!last) return t("noMessages");
    if (last.deleted) return t("deleted");
    const text = plainBody(last.body, nameOf).replace(/\s+/g, " ").trim();
    const content = text || t("attachmentCount", { count: last.attachments });
    if (last.sender === me) return t("youWrote", { text: content });
    if (channel.kind === "group") return `${nameOf(last.sender)}: ${content}`;
    return content;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <label className="relative block">
          <span className="sr-only">{t("search")}</span>
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            data-testid="chat-search"
            className="h-11 w-full rounded-xl border border-line bg-canvas-deep/60 pr-10 pl-9 text-base text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/25 md:text-sm"
          />
          {query && (
            <button
              type="button"
              aria-label={t("clearSearch")}
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 cursor-pointer place-items-center text-ink-muted outline-none hover:text-ink"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {loading && channels.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">{t("loading")}</p>
        ) : null}
        <ul aria-label={t("conversations")} className="flex flex-col gap-0.5">
          {shown.map((channel) => {
            const active = selected.channelId === channel.id;
            const silenced = isSilenced(channel);
            const title = titleOf(channel);
            return (
              <li key={channel.id}>
                <button
                  type="button"
                  data-testid="chat-channel"
                  data-channel-id={channel.id}
                  data-kind={channel.kind}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect({ channelId: channel.id, to: null })}
                  className={cn(
                    "flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-violet/40",
                    active ? "bg-violet/15" : "hover:bg-surface-hover",
                  )}
                >
                  <ChannelAvatar channel={channel} className="size-11" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("truncate text-[15px] font-semibold", channel.archived ? "text-ink-muted" : "text-ink")}>
                        {title}
                      </span>
                      <span className={cn("ml-auto shrink-0 text-xs", channel.unread > 0 && !silenced ? "text-teal" : "text-ink-muted")}>
                        {channel.last ? formatEditedAt(new Date(channel.last.at), settings) : ""}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      {channel.last && channel.last.attachments > 0 && !channel.last.deleted && (
                        <PaperclipIcon aria-hidden className="size-3.5 shrink-0 text-ink-muted" />
                      )}
                      <span className={cn("truncate text-sm", channel.unread > 0 ? "text-ink-soft" : "text-ink-muted")}>
                        {preview(channel)}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {silenced && <BellOffIcon aria-label={t("muted")} className="size-3.5 text-ink-muted" />}
                        {channel.pinnedAt && <PinIcon aria-label={t("pinned")} className="size-3.5 text-ink-muted" />}
                        {channel.mentioned && (
                          <span aria-label={t("mentionedYou")} className="grid size-5 place-items-center rounded-full bg-gold text-[11px] font-bold text-canvas">
                            @
                          </span>
                        )}
                        {channel.unread > 0 && (
                          <span
                            data-testid="chat-channel-unread"
                            aria-label={t("unreadCount", { count: channel.unread })}
                            className={cn(
                              "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold",
                              silenced ? "bg-ink-muted/40 text-ink" : "bg-teal text-canvas",
                            )}
                          >
                            {badgeText(channel.unread)}
                          </span>
                        )}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {others.length > 0 && (
          <>
            <h3 className="micro-label px-3 pt-4 pb-1.5">{t("people")}</h3>
            <ul aria-label={t("people")} className="flex flex-col gap-0.5">
              {others.map((person) => {
                const active = selected.to === person.member;
                const name = nameOf(person.member);
                return (
                  <li key={person.member}>
                    <button
                      type="button"
                      data-testid="chat-person"
                      data-member={person.member}
                      aria-current={active ? "true" : undefined}
                      onClick={() => onSelect({ channelId: null, to: person.member })}
                      className={cn(
                        "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-violet/40",
                        active ? "bg-violet/15" : "hover:bg-surface-hover",
                      )}
                    >
                      <PersonAvatar person={byMember.get(person.member)} name={name} className="size-10" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-ink">{name}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {person.status === "invited"
                            ? t("invitedPeer")
                            : person.isOwner
                              ? t("owner")
                              : (person.jobTitle ?? t("startConversation"))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {!loading && shown.length === 0 && others.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">
            {query ? t("noResults") : space === me ? t("emptyOwner") : t("emptyWorker")}
          </p>
        )}
      </div>
    </div>
  );
}
