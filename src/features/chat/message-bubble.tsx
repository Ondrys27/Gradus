"use client";

import { memo, useMemo } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  AlertCircleIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  FileTextIcon,
  PencilIcon,
  ReplyIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { formatNumber, formatTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { bodySegments, isImageType, plainBody } from "./logic";
import { filePreview } from "./outbox-store";
import { PersonAvatar, usePeople } from "./people";
import { RecordChip } from "./record-chips";
import type { ChatAttachment, ChatKind, ChatMessage } from "./types";

export type BubbleActions = {
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
  onDiscard: (message: ChatMessage) => void;
  onOpenImage: (image: { src: string; name: string }) => void;
  onJumpTo: (id: string) => void;
};

type BubbleProps = {
  message: ChatMessage;
  me: string;
  kind: ChatKind;
  own: boolean;
  first: boolean;
  last: boolean;
  /** How many of the others read it (own messages). */
  readers: number;
  /** Everybody else in the conversation. */
  others: number;
  /** Replying is possible (not read only, not archived). */
  writable: boolean;
  canEdit: boolean;
  canDelete: boolean;
  reply: ChatMessage | null | undefined;
  trashed: ReadonlySet<string>;
  highlight: boolean;
  actions: BubbleActions;
};

/** One message: own on the right, the others' on the left with their name at the start of a run. */
export const MessageBubble = memo(function MessageBubble({
  message,
  me,
  kind,
  own,
  first,
  last,
  readers,
  others,
  writable,
  canEdit,
  canDelete,
  reply,
  trashed,
  highlight,
  actions,
}: BubbleProps) {
  const t = useTranslations("messages");
  const settings = useFormatSettings();
  const { byMember, nameOf } = usePeople();
  const sender = message.sender;
  const senderName = nameOf(sender);
  const deleted = Boolean(message.deleted_at);
  const showName = kind === "group" && !own && first;
  const showAvatar = kind === "group" && !own;

  return (
    <div
      data-testid="chat-message"
      data-message-id={message.id}
      data-own={own ? "true" : "false"}
      data-pending={message.pending ?? undefined}
      className={cn(
        "group/bubble flex items-end gap-2 px-3 md:px-5",
        own ? "justify-end" : "justify-start",
        first ? "pt-2" : "pt-0.5",
      )}
    >
      {showAvatar && (
        <span className="w-8 shrink-0">
          {last && (
            <PersonAvatar
              person={sender ? byMember.get(sender) : undefined}
              name={senderName}
              className="size-8 text-xs"
            />
          )}
        </span>
      )}
      <div className={cn("flex max-w-[min(80%,36rem)] min-w-0 items-center gap-1", own && "flex-row-reverse")}>
        <div
          className={cn(
            "relative min-w-0 rounded-2xl px-3 py-2 text-[15px] leading-snug shadow-sm transition-colors",
            own
              ? "bg-primary text-primary-foreground"
              : "border border-line bg-surface text-ink",
            own && last && "rounded-br-md",
            !own && last && "rounded-bl-md",
            deleted && "border border-dashed border-line bg-transparent text-ink-muted shadow-none",
            message.pending === "failed" && "ring-2 ring-pink/60",
            highlight && "ring-2 ring-gold/70",
          )}
        >
          {showName && (
            <p className="mb-0.5 truncate text-xs font-semibold text-teal">{senderName}</p>
          )}
          {deleted ? (
            <p className="text-sm italic">{t("deleted")}</p>
          ) : (
            <>
              {message.reply_to_id && (
                <ReplyQuote
                  reply={reply}
                  own={own}
                  nameOf={nameOf}
                  onJump={() => message.reply_to_id && actions.onJumpTo(message.reply_to_id)}
                />
              )}
              {message.attachments.length > 0 && (
                <Attachments
                  message={message}
                  own={own}
                  trashed={trashed}
                  onOpenImage={actions.onOpenImage}
                />
              )}
              {message.body.trim() && <Body body={message.body} me={me} own={own} />}
            </>
          )}
          <p
            className={cn(
              "mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-none",
              own && !deleted ? "text-primary-foreground/75" : "text-ink-muted",
            )}
          >
            {message.edited_at && !deleted && <span>{t("edited")}</span>}
            <time dateTime={message.created_at}>{formatTime(new Date(message.created_at), settings)}</time>
            {own && !deleted && (
              <Receipt message={message} kind={kind} readers={readers} others={others} />
            )}
          </p>
        </div>
        {!deleted && (writable || message.pending) && (
          <BubbleMenu
            message={message}
            own={own}
            canEdit={canEdit}
            canDelete={canDelete}
            actions={actions}
          />
        )}
      </div>
    </div>
  );
});

function Receipt({
  message,
  kind,
  readers,
  others,
}: {
  message: ChatMessage;
  kind: ChatKind;
  readers: number;
  others: number;
}) {
  const t = useTranslations("messages");
  const settings = useFormatSettings();
  if (message.pending === "sending") {
    return <ClockIcon aria-label={t("sending")} className="size-3" />;
  }
  if (message.pending === "failed") {
    return <AlertCircleIcon aria-label={t("failed")} className="size-3 text-pink" />;
  }
  if (kind === "direct") {
    return readers > 0 ? (
      <CheckCheckIcon aria-label={t("read")} data-testid="chat-read" className="size-3.5 text-teal" />
    ) : (
      <CheckIcon aria-label={t("delivered")} className="size-3.5" />
    );
  }
  if (readers === 0) return <CheckIcon aria-label={t("delivered")} className="size-3.5" />;
  return (
    <span data-testid="chat-read" className="inline-flex items-center gap-0.5" title={t("readBy", { count: readers, total: others })}>
      <CheckCheckIcon aria-hidden className="size-3.5 text-teal" />
      {t("readCount", { count: formatNumber(readers, {}, settings) })}
    </span>
  );
}

function Body({ body, me, own }: { body: string; me: string; own: boolean }) {
  const { nameOf } = usePeople();
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const segments = useMemo(() => bodySegments(body, origin), [body, origin]);
  return (
    <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
      {segments.map((segment, index) => {
        switch (segment.type) {
          case "text":
            return <span key={index}>{segment.text}</span>;
          case "mention":
            return (
              <span
                key={index}
                data-testid="chat-mention"
                data-me={segment.member === me ? "true" : undefined}
                className={cn(
                  "rounded px-0.5 font-semibold",
                  segment.member === me
                    ? own
                      ? "bg-gold/30 text-primary-foreground"
                      : "bg-gold/20 text-gold"
                    : own
                      ? "text-primary-foreground underline decoration-primary-foreground/40"
                      : "text-violet",
                )}
              >
                @{nameOf(segment.member)}
              </span>
            );
          case "record":
            return <RecordChip key={index} link={segment.link} own={own} />;
          case "url":
            return (
              <a
                key={index}
                href={segment.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn("underline underline-offset-2", own ? "text-primary-foreground" : "text-violet")}
              >
                {segment.url}
              </a>
            );
        }
      })}
    </p>
  );
}

function ReplyQuote({
  reply,
  own,
  nameOf,
  onJump,
}: {
  reply: ChatMessage | null | undefined;
  own: boolean;
  nameOf: (member: string | null) => string;
  onJump: () => void;
}) {
  const t = useTranslations("messages");
  const text = !reply
    ? t("replyMissing")
    : reply.deleted_at
      ? t("deleted")
      : plainBody(reply.body, nameOf).trim() ||
        (reply.attachments.length ? t("attachmentCount", { count: reply.attachments.length }) : "");
  return (
    <button
      type="button"
      onClick={onJump}
      className={cn(
        "mb-1 block w-full cursor-pointer rounded-lg border-l-3 px-2 py-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-violet/50",
        own ? "border-primary-foreground/70 bg-canvas/20" : "border-violet bg-violet/10",
      )}
    >
      {reply && <span className="block truncate font-semibold">{nameOf(reply.sender)}</span>}
      <span className="line-clamp-2 opacity-85">{text}</span>
    </button>
  );
}

function fileId(file: ChatAttachment): string {
  return file.path.slice(file.path.lastIndexOf("/") + 1);
}

function Attachments({
  message,
  own,
  trashed,
  onOpenImage,
}: {
  message: ChatMessage;
  own: boolean;
  trashed: ReadonlySet<string>;
  onOpenImage: BubbleActions["onOpenImage"];
}) {
  const t = useTranslations("messages");
  const settings = useFormatSettings();
  const images = message.attachments.filter((file) => isImageType(file.mime) && !trashed.has(file.path));
  const other = message.attachments.filter((file) => !images.includes(file));
  const href = (file: ChatAttachment, download = false) =>
    `/api/chat/files?m=${message.id}&f=${fileId(file)}${download ? "&download=1" : ""}`;
  const size = (bytes: number) =>
    bytes >= 1024 * 1024
      ? t("sizeMb", { size: formatNumber(bytes / (1024 * 1024), { decimals: 1 }, settings) })
      : t("sizeKb", { size: formatNumber(Math.max(1, Math.round(bytes / 1024)), {}, settings) });

  return (
    <div className="mb-1 flex flex-col gap-1">
      {images.length > 0 && (
        <div className={cn("grid gap-1", images.length > 1 && "grid-cols-2")}>
          {images.map((file) => {
            const src = message.pending ? filePreview(fileId(file)) : href(file);
            const ratio = file.width && file.height ? file.width / file.height : 4 / 3;
            return (
              <button
                key={file.path}
                type="button"
                data-testid="chat-image"
                disabled={!src}
                onClick={() => src && onOpenImage({ src, name: file.name })}
                className="relative block w-full max-w-72 cursor-zoom-in overflow-hidden rounded-xl bg-canvas-deep/40 outline-none focus-visible:ring-2 focus-visible:ring-violet/50"
                style={{ aspectRatio: String(Math.min(Math.max(ratio, 0.5), 2)) }}
              >
                {src && (
                  // A signed link the server makes per view; next/image would cache it past its life.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={file.name} loading="lazy" className="size-full object-cover" />
                )}
              </button>
            );
          })}
        </div>
      )}
      {other.map((file) => {
        const inTrash = trashed.has(file.path);
        const body = (
          <>
            <FileTextIcon aria-hidden className="size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{file.name}</span>
              <span className={cn("block text-xs", own ? "text-primary-foreground/75" : "text-ink-muted")}>
                {inTrash ? t("fileTrashed") : size(file.size)}
              </span>
            </span>
          </>
        );
        const className = cn(
          "flex min-h-11 items-center gap-2 rounded-xl px-2.5 py-1.5",
          own ? "bg-canvas/20" : "bg-canvas-deep/40",
        );
        return inTrash || message.pending ? (
          <div key={file.path} className={className}>
            {body}
          </div>
        ) : (
          <a
            key={file.path}
            href={href(file, true)}
            data-testid="chat-file"
            className={cn(className, "outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-violet/50")}
          >
            {body}
          </a>
        );
      })}
    </div>
  );
}

function BubbleMenu({
  message,
  own,
  canEdit,
  canDelete,
  actions,
}: {
  message: ChatMessage;
  own: boolean;
  canEdit: boolean;
  canDelete: boolean;
  actions: BubbleActions;
}) {
  const t = useTranslations("messages.actions");
  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";
  const failed = message.pending === "failed";
  if (message.pending === "sending") return <span className="size-11 shrink-0 mouse:size-8" />;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("label")}
        data-testid="chat-message-menu"
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 data-popup-open:opacity-100 mouse:size-8 mouse:opacity-0 mouse:group-hover/bubble:opacity-100 mouse:focus-visible:opacity-100"
      >
        <EllipsisVerticalIcon aria-hidden className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align={own ? "end" : "start"} className="z-popover">
          <Menu.Popup className="min-w-44 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            {failed ? (
              <>
                <Menu.Item className={itemClass} onClick={() => actions.onRetry(message)}>
                  <RotateCcwIcon aria-hidden />
                  {t("retry")}
                </Menu.Item>
                <Menu.Item className={cn(itemClass, "text-pink")} onClick={() => actions.onDiscard(message)}>
                  <Trash2Icon aria-hidden />
                  {t("discard")}
                </Menu.Item>
              </>
            ) : (
              <>
                <Menu.Item className={itemClass} onClick={() => actions.onReply(message)}>
                  <ReplyIcon aria-hidden />
                  {t("reply")}
                </Menu.Item>
                {canEdit && (
                  <Menu.Item className={itemClass} onClick={() => actions.onEdit(message)}>
                    <PencilIcon aria-hidden />
                    {t("edit")}
                  </Menu.Item>
                )}
                {canDelete && (
                  <Menu.Item
                    className={cn(itemClass, "text-pink data-highlighted:text-pink")}
                    onClick={() => actions.onDelete(message)}
                  >
                    <Trash2Icon aria-hidden />
                    {t("delete")}
                  </Menu.Item>
                )}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
