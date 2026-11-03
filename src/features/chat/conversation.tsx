"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  BellOffIcon,
  BellRingIcon,
  ChevronLeftIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  MegaphoneOffIcon,
  PinIcon,
  PinOffIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatNumber } from "@/lib/format";
import { usePageScrollLock } from "@/lib/scroll-lock";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { setActiveChannel } from "./chat-sync";
import { Composer, type ComposerHandle } from "./composer";
import { firstUnreadId, isSilenced, mergeMessages, newestCreatedAt } from "./logic";
import { MessageList, type MessageListHandle } from "./message-list";
import type { BubbleActions } from "./message-bubble";
import { removeItem, retryItem, useOutbox } from "./outbox-store";
import type { OutboxItem } from "./outbox";
import { ChannelAvatar, useChannelTitle, usePeople } from "./people";
import {
  flattenPages,
  useChannelMembers,
  useChannelMessages,
  useChatMe,
  useDeleteMessage,
  useEditMessage,
  useMarkRead,
  useMemberFlags,
  useMuteAll,
  useTrashedFiles,
} from "./queries";
import { RecordNamesContext, useRecordNames } from "./record-chips";
import type { ChatChannel, ChatMessage } from "./types";

function pendingMessage(item: OutboxItem, me: string): ChatMessage {
  return {
    id: item.id,
    channel_id: item.channelId ?? "",
    sender: me,
    body: item.body,
    attachments: item.files.map((file) => ({
      path: `${item.space}/${item.id}/${file.id}`,
      name: file.name,
      size: file.size,
      mime: file.mime,
      ...(file.width && file.height ? { width: file.width, height: file.height } : {}),
    })),
    reply_to_id: item.replyTo,
    created_at: item.createdAt,
    edited_at: null,
    deleted_at: null,
    pending: item.failed ? "failed" : "sending",
  };
}

/**
 * One conversation: its header (who, how many, pin, mute, and for the owner
 * silencing a group for everyone and the CSV export), the messages and the
 * composer. A new direct conversation (`to`) has no messages until the first
 * one is sent. What the reader has in view is marked read.
 */
export function Conversation({
  channel,
  to,
  onBack,
}: {
  channel: ChatChannel | null;
  to: string | null;
  onBack?: () => void;
}) {
  const t = useTranslations("messages");
  const settings = useFormatSettings();
  const { me, space, isOwner, readOnly } = useChatMe();
  const { byMember, nameOf } = usePeople();
  const titleOf = useChannelTitle();
  const channelId = channel?.id ?? null;
  const kind = channel?.kind ?? "direct";
  const peer = channel ? channel.peer : to;
  const peerPerson = peer ? byMember.get(peer) : undefined;

  const pages = useChannelMessages(channelId);
  const members = useChannelMembers(channelId);
  const outbox = useOutbox();
  const markRead = useMarkRead();
  const editMessage = useEditMessage(kind);
  const deleteMessage = useDeleteMessage(kind);

  const pending = useMemo(
    () =>
      outbox
        .filter((item) =>
          channelId ? item.channelId === channelId || (!item.channelId && item.to === peer && kind === "direct") : item.to === to,
        )
        .map((item) => pendingMessage(item, me)),
    [outbox, channelId, to, peer, kind, me],
  );
  const loaded = useMemo(() => flattenPages(pages.data), [pages.data]);
  const messages = useMemo(() => mergeMessages(loaded, pending), [loaded, pending]);
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  const allFiles = useMemo(() => loaded.flatMap((message) => message.attachments), [loaded]);
  const trashed = useTrashedFiles(allFiles);
  const records = useRecordNames(useMemo(() => loaded.map((message) => message.body), [loaded]));

  // The unread divider: where the reader stopped when they opened it.
  const [unreadFrom, setUnreadFrom] = useState<string | null>(null);
  const divided = useRef<string | null>(null);
  useEffect(() => {
    if (!channelId || divided.current === channelId || !pages.data) return;
    divided.current = channelId;
    setUnreadFrom(firstUnreadId(loaded, me, channel?.lastReadAt ?? null));
  }, [channelId, pages.data, loaded, me, channel?.lastReadAt]);

  useEffect(() => {
    setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId]);

  // Marks read what is in view, once the newest message is on screen.
  const [atEnd, setAtEnd] = useState(true);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const newest = newestCreatedAt(loaded);
  const lastRead = channel?.lastReadAt ?? null;
  const { mutate: mark } = markRead;
  useEffect(() => {
    if (!channelId || !newest || !atEnd || !visible) return;
    if (lastRead && Date.parse(lastRead) >= Date.parse(newest)) return;
    const timer = window.setTimeout(() => mark({ channelId, until: newest }), 400);
    return () => window.clearTimeout(timer);
  }, [channelId, newest, atEnd, visible, lastRead, mark]);

  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [image, setImage] = useState<{ src: string; name: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const list = useRef<MessageListHandle>(null);
  const composer = useRef<ComposerHandle>(null);

  useEffect(() => {
    setReply(null);
    setEditing(null);
  }, [channelId, to]);

  const actions = useMemo<BubbleActions>(
    () => ({
      onReply: (message) => {
        setEditing(null);
        setReply(message);
        composer.current?.focus();
      },
      onEdit: (message) => {
        setReply(null);
        setEditing(message);
        composer.current?.focus();
      },
      onDelete: (message) => setDeleting(message),
      onRetry: (message) => retryItem(message.id),
      onDiscard: (message) => removeItem(message.id),
      onOpenImage: setImage,
      onJumpTo: (id) => {
        if (list.current?.scrollToMessage(id)) {
          setHighlight(id);
          window.setTimeout(() => setHighlight((current) => (current === id ? null : current)), 1600);
        }
      },
    }),
    [],
  );
  const replyOf = useCallback((id: string) => byId.get(id) ?? null, [byId]);
  const onAtEnd = useCallback((value: boolean) => setAtEnd(value), []);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = pages;
  const loadOlder = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  const memberTokens = useMemo(
    () => (members.data ?? []).map((row) => row.member),
    [members.data],
  );
  const candidates = useMemo(
    () =>
      (channel ? memberTokens : peer ? [peer] : []).filter(
        (member) => member !== me && byMember.get(member)?.status !== "inactive",
      ),
    [channel, memberTokens, peer, me, byMember],
  );

  const title = channel ? titleOf(channel) : nameOf(to);
  const peerGone = kind === "direct" && peerPerson?.status === "inactive";
  const blocked = readOnly
    ? t("readOnlyNotice")
    : channel?.archived
      ? t("archivedNotice")
      : peerGone
        ? t("peerGone")
        : null;
  const subtitle =
    kind === "group"
      ? t("memberCount", {
          count: channel?.memberCount ?? 0,
          formatted: formatNumber(channel?.memberCount ?? 0, {}, settings),
        })
      : peerPerson?.status === "invited"
        ? t("invitedPeer")
        : peerGone
          ? t("removedPeer")
          : (peerPerson?.jobTitle ?? (peer === space ? t("owner") : ""));

  return (
    <RecordNamesContext.Provider value={records.data ?? EMPTY_NAMES}>
      <section
        aria-label={title}
        data-testid="chat-conversation"
        data-channel-id={channelId ?? undefined}
        className="flex h-full min-h-0 flex-col"
      >
        <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-line px-2 py-2 md:px-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("back")}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl text-violet outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              <ChevronLeftIcon aria-hidden className="size-6" />
            </button>
          )}
          <ChannelAvatar channel={channel ?? { kind: "direct", color: null, peer: to }} className="size-10" />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1.5 truncate text-base font-semibold text-ink">
              <span className="truncate">{title}</span>
              {channel && isSilenced(channel) && (
                <BellOffIcon aria-label={t("muted")} className="size-3.5 shrink-0 text-ink-muted" />
              )}
            </h2>
            {subtitle && <p className="truncate text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {channel && <HeaderMenu channel={channel} isOwner={isOwner} />}
        </header>

        {channel && pages.isError ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-ink-muted">
            {t("loadFailed")}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-ink-muted">
            {channel && pages.isPending ? t("loading") : t("emptyConversation")}
          </div>
        ) : (
          <MessageList
            key={channelId ?? `to:${to}`}
            ref={list}
            messages={messages}
            me={me}
            isSpaceOwner={isOwner}
            writable={!blocked}
            kind={kind}
            members={members.data ?? []}
            unreadFrom={unreadFrom}
            trashed={trashed.data ?? EMPTY_SET}
            highlight={highlight}
            hasOlder={Boolean(hasNextPage)}
            loadingOlder={isFetchingNextPage}
            onLoadOlder={loadOlder}
            onAtEndChange={onAtEnd}
            actions={actions}
            replyOf={replyOf}
          />
        )}

        <Composer
          ref={composer}
          channelId={channelId}
          to={channel ? null : to}
          space={space}
          candidates={candidates}
          reply={reply}
          onCancelReply={() => setReply(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSaveEdit={(message, body) => {
            setEditing(null);
            if (body !== message.body) editMessage.mutate({ message, body });
          }}
          onSent={() => list.current?.scrollToEnd()}
          blocked={blocked}
        />
      </section>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle")}
        description={deleting && deleting.sender !== me ? t("deleteOthers") : t("deleteDescription")}
        confirmLabel={t("actions.delete")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={deleteMessage.isPending}
        onConfirm={() => {
          if (deleting) deleteMessage.mutate(deleting);
          setDeleting(null);
        }}
      />
      {image && <ImageViewer image={image} onClose={() => setImage(null)} />}
    </RecordNamesContext.Provider>
  );
}

const EMPTY_NAMES: ReadonlyMap<string, string> = new Map();
const EMPTY_SET: ReadonlySet<string> = new Set();

function HeaderMenu({ channel, isOwner }: { channel: ChatChannel; isOwner: boolean }) {
  const t = useTranslations("messages.menu");
  const flags = useMemberFlags();
  const muteAll = useMuteAll();
  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("label")}
        data-testid="chat-conversation-menu"
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40"
      >
        <EllipsisVerticalIcon aria-hidden className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-popover">
          <Menu.Popup className="min-w-56 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            <Menu.Item
              className={itemClass}
              onClick={() => flags.mutate({ channelId: channel.id, pinned: !channel.pinnedAt })}
            >
              {channel.pinnedAt ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
              {channel.pinnedAt ? t("unpin") : t("pin")}
            </Menu.Item>
            <Menu.Item
              className={itemClass}
              onClick={() => flags.mutate({ channelId: channel.id, muted: !channel.muted })}
            >
              {channel.muted ? <BellRingIcon aria-hidden /> : <BellOffIcon aria-hidden />}
              {channel.muted ? t("unmute") : t("mute")}
            </Menu.Item>
            {isOwner && channel.kind === "group" && !channel.archived && (
              <Menu.Item
                className={itemClass}
                data-testid="chat-mute-all"
                onClick={() => muteAll.mutate({ channelId: channel.id, muted: !channel.mutedAll })}
              >
                <MegaphoneOffIcon aria-hidden />
                {channel.mutedAll ? t("unmuteAll") : t("muteAll")}
              </Menu.Item>
            )}
            {isOwner && (
              <Menu.Item
                className={itemClass}
                render={<a href={`/api/chat/export?c=${channel.id}`} download />}
              >
                <DownloadIcon aria-hidden />
                {t("export")}
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ImageViewer({
  image,
  onClose,
}: {
  image: { src: string; name: string };
  onClose: () => void;
}) {
  const t = useTranslations("messages");
  usePageScrollLock(true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      data-capture-ignore=""
      className="fixed inset-0 z-overlay flex items-center justify-center bg-canvas/90 p-4 backdrop-blur"
      onClick={onClose}
    >
      <button
        type="button"
        autoFocus
        aria-label={t("close")}
        onClick={onClose}
        className={cn(
          "absolute top-[max(12px,env(safe-area-inset-top))] right-[max(12px,env(safe-area-inset-right))] grid size-11 cursor-pointer place-items-center rounded-xl border border-line bg-surface text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
        )}
      >
        <XIcon aria-hidden className="size-5" />
      </button>
      {/* A signed link valid for a minute; next/image would keep it longer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.name}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-xl object-contain shadow-popover"
      />
    </div>
  );
}
