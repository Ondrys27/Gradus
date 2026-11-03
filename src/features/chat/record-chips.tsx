"use client";

import { createContext, useContext, useMemo } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ListChecksIcon, SquareKanbanIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { contactName } from "@/features/notes/mentions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { recordHref, recordLinksIn, type RecordKind, type RecordLink } from "./logic";
import { chatKeys, useChatMe } from "./queries";

/**
 * A deal, contact or sales task pasted as an address shows as a chip with
 * the record's current name, like the mentions of notes. The names are read
 * with the reader's own client in their space, so a record they may not see
 * stays a chip without a name.
 */

const ICONS: Record<RecordKind, LucideIcon> = {
  deal: SquareKanbanIcon,
  contact: UserRoundIcon,
  task: ListChecksIcon,
};

export const RecordNamesContext = createContext<ReadonlyMap<string, string>>(new Map());

const recordKey = (link: RecordLink) => `${link.kind}:${link.id}`;

/** The names of every record linked in the loaded messages. */
export function useRecordNames(bodies: readonly string[]) {
  const { user } = useSession();
  const { space } = useChatMe();
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const links = useMemo(() => {
    const all = new Map<string, RecordLink>();
    for (const body of bodies) for (const link of recordLinksIn(body, origin)) all.set(recordKey(link), link);
    return [...all.values()].slice(0, 200);
  }, [bodies, origin]);
  const set = links.map(recordKey).sort().join(",");
  return useQuery({
    queryKey: chatKeys.records(user.id, space, set),
    enabled: links.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createClient();
      const ids = (kind: RecordKind) => links.filter((link) => link.kind === kind).map((link) => link.id);
      const [deals, contacts, tasks] = await Promise.all([
        ids("deal").length
          ? supabase.from("deals").select("id, title").eq("user_id", space).in("id", ids("deal"))
          : null,
        ids("contact").length
          ? supabase
              .from("contacts")
              .select("id, company_name, first_name, last_name")
              .eq("user_id", space)
              .in("id", ids("contact"))
          : null,
        ids("task").length
          ? supabase.from("crm_tasks").select("id, title").eq("user_id", space).in("id", ids("task"))
          : null,
      ]);
      const names = new Map<string, string>();
      for (const row of deals?.data ?? []) names.set(`deal:${row.id}`, row.title);
      for (const row of contacts?.data ?? []) names.set(`contact:${row.id}`, contactName(row));
      for (const row of tasks?.data ?? []) names.set(`task:${row.id}`, row.title);
      return names;
    },
  });
}

export function RecordChip({ link, own }: { link: RecordLink; own: boolean }) {
  const t = useTranslations("messages.record");
  const names = useContext(RecordNamesContext);
  const name = names.get(recordKey(link));
  const Icon = ICONS[link.kind];
  return (
    <Link
      href={recordHref(link)}
      data-testid="chat-record-chip"
      data-record-kind={link.kind}
      title={t(`open.${link.kind}`)}
      className={cn(
        "mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-md px-1.5 align-baseline text-[0.94em] font-medium leading-snug outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet/50",
        own ? "bg-canvas/25 text-ink hover:bg-canvas/40" : "bg-violet/14 text-ink hover:bg-violet/24",
      )}
    >
      <Icon aria-hidden className={cn("size-[0.9em] shrink-0 self-center", !own && "text-violet")} />
      <span className="truncate">{name ?? t(`kind.${link.kind}`)}</span>
    </Link>
  );
}
