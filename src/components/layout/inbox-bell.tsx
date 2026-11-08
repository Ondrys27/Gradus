"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { BellIcon, LogOutIcon, MailPlusIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  inboxCount,
  inviterName,
  useInbox,
  useMarkInboxRead,
  type AccountNotification,
} from "@/features/account/inbox";
import { useCloseOnErrorScreen } from "@/features/errors/error-screen-state";
import { formatDate, formatNumber } from "@/lib/format";
import { COMPANY_PATH, INVITES_PATH } from "@/lib/routes";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";

const NOTE_ICON: Record<AccountNotification["kind"], typeof BellIcon> = {
  invite_accepted: UserCheckIcon,
  invite_declined: UserXIcon,
  worker_left: LogOutIcon,
};

const itemClass =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink";

/**
 * Top right: invites into other companies and what the owner hears about
 * their people (accepted, declined, left). The badge counts open invites and
 * unread notifications; opening the bell marks the notifications read.
 */
export function InboxBell({ className }: { className?: string }) {
  const t = useTranslations("inbox");
  const settings = useFormatSettings();
  const inbox = useInbox();
  const markRead = useMarkInboxRead();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useCloseOnErrorScreen(close);
  const count = inboxCount(inbox.data);
  const invites = inbox.data?.invites ?? [];
  const notes = inbox.data?.notifications ?? [];
  const unread = notes.some((note) => !note.read);

  function change(next: boolean) {
    setOpen(next);
    // Seen once the list was open; the next poll keeps it that way.
    if (!next && unread && !markRead.isPending) markRead.mutate();
  }

  return (
    <Menu.Root open={open} onOpenChange={change}>
      <Menu.Trigger
        aria-label={count ? t("openCount", { count, shown: formatNumber(count, {}, settings) }) : t("open")}
        data-testid="inbox-bell"
        className={cn(
          "relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface/60 text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9",
          className,
        )}
      >
        <BellIcon aria-hidden className="size-4.5" />
        {count > 0 && (
          <span
            aria-hidden
            data-testid="inbox-count"
            className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-pink px-1 text-[11px] font-bold text-canvas tabular-nums"
          >
            {count > 9 ? "9+" : formatNumber(count, {}, settings)}
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-popover">
          <Menu.Popup
            className={cn(
              "max-h-[min(70vh,28rem)] w-[min(calc(100vw-24px),22rem)] origin-(--transform-origin) overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none",
              "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            )}
          >
            <p className="micro-label px-3 py-1.5">{t("title")}</p>
            {invites.length === 0 && notes.length === 0 && (
              <p className="px-3 py-3 text-sm text-ink-muted">{t("empty")}</p>
            )}
            {invites.map((invite) => (
              <Menu.LinkItem
                key={invite.id}
                closeOnClick
                className={itemClass}
                render={<Link href={INVITES_PATH} prefetch={false} />}
                data-testid="inbox-invite"
              >
                <MailPlusIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-violet" />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-ink">{t("invite", { who: inviterName(invite) ?? t("someone") })}</span>
                  <span className="text-xs text-ink-muted">{t("inviteHint")}</span>
                </span>
              </Menu.LinkItem>
            ))}
            {notes.map((note) => {
              const Icon = NOTE_ICON[note.kind];
              return (
                <Menu.LinkItem
                  key={note.id}
                  closeOnClick
                  className={itemClass}
                  render={
                    <Link
                      href={note.workerId ? `${COMPANY_PATH}?worker=${note.workerId}` : COMPANY_PATH}
                      prefetch={false}
                    />
                  }
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      note.kind === "invite_accepted" ? "text-green" : "text-ink-muted",
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className={cn(note.read ? "text-ink-soft" : "font-medium text-ink")}>
                      {t(`notes.${note.kind}`, { name: note.workerName ?? t("someone") })}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {formatDate(new Date(note.createdAt), settings)}
                    </span>
                  </span>
                </Menu.LinkItem>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
