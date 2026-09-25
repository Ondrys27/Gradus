"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { PhoneOffIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { MoveResult } from "@/features/contacts/move-contact-dialog";
import { useContactList, useContactTables, useTableCounts } from "@/features/contacts/queries";
import { TableSwitcher } from "@/features/contacts/table-switcher";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { CallContactPanel } from "./call-contact-panel";
import { CallList } from "./call-list";
import { BestTimeCard } from "./best-time-card";
import { TimerCard } from "./timer-card";

// The charts library is large; the list and the timer never wait for it.
const StatsCard = dynamic(() => import("./stats-card").then((module) => module.StatsCard), {
  ssr: false,
  loading: () => <Skeleton className="h-[34rem] rounded-card" />,
});

export function ColdCallingView() {
  const t = useTranslations("coldCalling");
  const tNav = useTranslations("nav");
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), 250);
  const [picked, setPicked] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [moved, setMoved] = useState<MoveResult | null>(null);

  const tablesQuery = useContactTables();
  const counts = useTableCounts().data;
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const unreached = tables.find((table) => table.system_key === "unreached");
  // Unreached is the work list; the others are a quick look.
  const tableId = picked && tables.some((table) => table.id === picked) ? picked : unreached?.id;

  const listQuery = useContactList({ term: debounced, tableId: tableId ?? null });
  const contacts = useMemo(() => listQuery.data?.pages.flat() ?? [], [listQuery.data]);
  const pending = tablesQuery.isPending || !tableId || listQuery.isPending;

  /** The moved contact slides out of the list and the next one opens, so calling goes on. */
  function handleMoved(contactId: string, result: MoveResult) {
    setMoved(result);
    if (result.table.id === tableId) return;
    const index = contacts.findIndex((contact) => contact.id === contactId);
    const next = contacts[index + 1] ?? contacts[index - 1] ?? null;
    setOpenId(next && next.id !== contactId ? next.id : null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tNav("coldCalling")} description={t("description")} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section aria-label={t("list.label")} className="flex min-w-0 flex-col gap-3">
          {tables.length > 0 && (
            <TableSwitcher
              tables={tables.filter((table) => table.system_key !== "clients")}
              counts={counts}
              value={tableId ?? null}
              showAll={false}
              onChange={(id) => {
                setPicked(id);
                setOpenId(null);
              }}
            />
          )}
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
            />
            <Input
              type="search"
              aria-label={t("list.search")}
              placeholder={t("list.searchPlaceholder")}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              className="pl-10"
            />
          </div>

          <p role="status" aria-live="polite" className="min-h-5 text-sm text-green">
            {moved &&
              (moved.meetingBooked
                ? t("list.movedWithMeeting", { name: moved.table.name })
                : t("list.moved", { name: moved.table.name }))}
          </p>

          {pending ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3, 4, 5].map((key) => (
                <Skeleton key={key} className="h-15 rounded-card" />
              ))}
            </div>
          ) : listQuery.isError || tablesQuery.isError ? (
            <FormAlert>{t("list.loadFailed")}</FormAlert>
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={debounced ? <SearchIcon /> : <PhoneOffIcon />}
              title={debounced ? t("list.noMatch") : t("list.emptyTitle")}
              description={debounced ? undefined : t("list.emptyDescription")}
            />
          ) : (
            <>
              <CallList
                contacts={contacts}
                openId={openId}
                onOpen={(contact) => setOpenId(contact.id)}
              />
              {listQuery.hasNextPage && (
                <Button
                  variant="outline"
                  className="self-center"
                  disabled={listQuery.isFetchingNextPage}
                  onClick={() => void listQuery.fetchNextPage()}
                >
                  {listQuery.isFetchingNextPage ? t("list.loadingMore") : t("list.loadMore")}
                </Button>
              )}
            </>
          )}
        </section>

        <aside aria-label={t("aside")} className="order-first flex flex-col gap-6 lg:order-none">
          <TimerCard />
          <StatsCard />
          <BestTimeCard />
        </aside>
      </div>

      <CallContactPanel
        contactId={openId}
        tables={tables}
        onClose={() => setOpenId(null)}
        onMoved={handleMoved}
      />
    </div>
  );
}
