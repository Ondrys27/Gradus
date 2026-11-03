"use client";

import { useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2Icon, MessageCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useKeyboardInset } from "@/features/notes/use-keyboard-inset";
import { COMPANY_PATH } from "@/lib/routes";
import { usePageScrollLock } from "@/lib/scroll-lock";
import { useIsPhone } from "@/lib/use-media-query";
import { Conversation } from "./conversation";
import { ConversationList } from "./conversation-list";
import { usePeople } from "./people";
import { useChatMe, useChatOverview } from "./queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Messages: the company chat laid out like WhatsApp Web. On a computer the
 * conversations on the left and the open one on the right; on a phone the
 * list, and a conversation over it full screen with the composer right above
 * the keyboard. The open conversation is in the address (?c=, or ?to= for a
 * first message to someone).
 */
export function MessagesView() {
  const t = useTranslations("messages");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const isPhone = useIsPhone();
  const { me, isOwner } = useChatMe();
  const overview = useChatOverview();
  const { people, loading: peopleLoading } = usePeople();
  const channels = useMemo(() => overview.data ?? [], [overview.data]);

  const rawChannel = params.get("c");
  const rawTo = params.get("to");
  const channelId = rawChannel && UUID.test(rawChannel) ? rawChannel.toLowerCase() : null;
  const to = !channelId && rawTo && UUID.test(rawTo) ? rawTo.toLowerCase() : null;
  const channel = channelId ? (channels.find((item) => item.id === channelId) ?? null) : null;

  const select = useCallback(
    (selection: { channelId: string | null; to: string | null }) => {
      const next = new URLSearchParams();
      if (selection.channelId) next.set("c", selection.channelId);
      else if (selection.to) next.set("to", selection.to);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  // A first message made the direct conversation: open it instead of ?to=.
  useEffect(() => {
    if (!to) return;
    const existing = channels.find((item) => item.kind === "direct" && item.peer === to);
    if (existing) select({ channelId: existing.id, to: null });
  }, [to, channels, select]);

  // A conversation that is not (or no longer) the reader's: back to the list.
  useEffect(() => {
    if (channelId && overview.isSuccess && !channel) select({ channelId: null, to: null });
  }, [channelId, channel, overview.isSuccess, select]);

  const open = Boolean(channel || to);
  const back = useCallback(() => select({ channelId: null, to: null }), [select]);
  const nobody =
    overview.isSuccess && !peopleLoading && channels.length === 0 && people.every((p) => p.member === me);

  const list = (
    <ConversationList
      channels={channels}
      selected={{ channelId, to }}
      onSelect={select}
      loading={overview.isPending}
    />
  );
  const conversation = open ? (
    <Conversation key={channelId ?? `to:${to}`} channel={channel} to={channel ? null : to} onBack={isPhone ? back : undefined} />
  ) : null;

  if (nobody) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="page-title">{t("title")}</h1>
        <EmptyState
          icon={<MessageCircleIcon />}
          title={t("nobodyTitle")}
          description={isOwner ? t("nobodyOwner") : t("nobodyWorker")}
          action={
            isOwner ? (
              <Link href={COMPANY_PATH} className={buttonVariants()}>
                <Building2Icon aria-hidden />
                {t("openCompany")}
              </Link>
            ) : null
          }
        />
      </div>
    );
  }

  if (isPhone) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="page-title">{t("title")}</h1>
        <div className="-mx-2">{list}</div>
        {conversation && <PhoneConversation>{conversation}</PhoneConversation>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:-mb-4">
      <h1 className="sr-only">{t("title")}</h1>
      <div
        data-testid="chat-layout"
        className="grid h-[calc(100dvh-12.5rem)] min-h-[28rem] grid-cols-[18rem_minmax(0,1fr)] overflow-hidden rounded-card border border-line bg-surface/50 lg:grid-cols-[21rem_minmax(0,1fr)]"
      >
        <aside className="flex min-h-0 flex-col border-r border-line">
          <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
            <MessageCircleIcon aria-hidden className="size-5 text-violet" />
            <h2 className="text-lg font-semibold text-ink">{t("title")}</h2>
          </div>
          {list}
        </aside>
        <div className="min-h-0 min-w-0">
          {conversation ?? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="grid size-14 place-items-center rounded-2xl border border-violet/30 bg-violet/12 text-violet shadow-glow">
                <MessageCircleIcon aria-hidden className="size-6" />
              </span>
              <p className="max-w-xs text-sm text-ink-muted">{t("pickConversation")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A conversation on a phone: the whole screen, its bottom right above the keyboard. */
function PhoneConversation({ children }: { children: React.ReactNode }) {
  const inset = useKeyboardInset(true);
  usePageScrollLock(true);
  return (
    <div
      className="fixed inset-x-0 top-0 z-overlay flex flex-col bg-canvas pt-[env(safe-area-inset-top)]"
      style={{ bottom: inset }}
    >
      {children}
    </div>
  );
}
