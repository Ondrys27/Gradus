"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InfoIcon, PencilIcon, PlusIcon, SearchIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { sumByCurrency } from "@/features/pipeline/board-logic";
import { contactDraftFromText } from "@/features/search/search-logic";
import { formatCurrency } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useUrlIntent } from "@/lib/use-url-intent";
import { useCan } from "@/features/account/workspace-queries";
import { ContactFormDialog } from "./contact-form-dialog";
import { ContactList } from "./contact-list";
import { GenerateContactsDialog } from "./generate-contacts-dialog";
import {
  useContactList,
  useContactTables,
  useTableCounts,
  useWonDeals,
  type WonDealsByContact,
} from "./queries";
import { TableSwitcher } from "./table-switcher";
import type { ContactDraft } from "./schemas";
import type { ContactListItem } from "./types";
import { MarkSeenOnVisit } from "@/features/game/mark-seen-on-visit";

/** The selected table lives in the address, so Back from a contact returns to it. */
const TABLE_PARAM = "table";

export function ContactsView() {
  const t = useTranslations("contacts");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState<Partial<ContactDraft> | undefined>(undefined);
  const [generating, setGenerating] = useState(false);
  // Without the right to edit, adding and changing is hidden; RLS refuses it anyway.
  const canEdit = useCan("contacts", "edit");

  // The search opens a new contact (with what was typed) or contact generation here.
  useUrlIntent(
    "new",
    (value, params) => {
      if (!canEdit) return;
      if (value === "contact") {
        setPrefill(contactDraftFromText(params.get("name") ?? ""));
        setCreating(true);
      } else if (value === "generate") {
        setGenerating(true);
      }
    },
    ["name"],
  );
  const debounced = useDebouncedValue(term.trim(), 250);

  const tablesQuery = useContactTables();
  const counts = useTableCounts().data;
  const tableList = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const tables = useMemo(() => new Map(tableList.map((table) => [table.id, table])), [tableList]);

  const requested = searchParams.get(TABLE_PARAM);
  const tableId = requested && tables.has(requested) ? requested : null;
  const selected = tableId ? tables.get(tableId) : undefined;
  const isClients = selected?.system_key === "clients";

  const listQuery = useContactList({ term: debounced, tableId });
  const contacts = useMemo(() => listQuery.data?.pages.flat() ?? [], [listQuery.data]);
  const wonDealPages = useMemo(
    () =>
      isClients
        ? (listQuery.data?.pages ?? []).map((page) => page.map((contact) => contact.id))
        : [],
    [isClients, listQuery.data],
  );
  const wonDeals = useWonDeals(wonDealPages);
  const searching = debounced !== "";

  function selectTable(id: string | null) {
    const params = new URLSearchParams(searchParams);
    if (id) params.set(TABLE_PARAM, id);
    else params.delete(TABLE_PARAM);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Wait for the tables before trusting a table id from the address.
  const pending = listQuery.isPending || (requested !== null && tablesQuery.isPending);

  return (
    <div className="flex flex-col gap-6">
      <MarkSeenOnVisit section="contacts" />
      <PageHeader
        title={tNav("contacts")}
        description={t("description")}
        actions={
          canEdit && (
            <>
              <Link href="/contacts/tables" className={buttonVariants({ variant: "outline" })}>
                <PencilIcon aria-hidden data-icon="inline-start" />
                {t("actions.editTables")}
              </Link>
              <Button variant="outline" onClick={() => setGenerating(true)}>
                <SparklesIcon aria-hidden data-icon="inline-start" />
                {t("actions.generate")}
              </Button>
              <Button
                onClick={() => {
                  setPrefill(undefined);
                  setCreating(true);
                }}
              >
                <PlusIcon aria-hidden data-icon="inline-start" />
                {t("actions.newContact")}
              </Button>
            </>
          )
        }
      />

      <div className="flex flex-col gap-3">
        {tableList.length > 0 && (
          <TableSwitcher
            tables={tableList}
            counts={counts}
            value={tableId}
            onChange={selectTable}
          />
        )}
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            type="search"
            aria-label={t("search.label")}
            placeholder={t("search.placeholder")}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="pl-10"
          />
        </div>
        {isClients && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <InfoIcon aria-hidden className="size-4 shrink-0" />
            {t("tables.clientsHint")}
          </p>
        )}
      </div>

      {pending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-16 rounded-card" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <EmptyState
          icon={<UsersIcon />}
          title={t("loadFailed")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      ) : contacts.length === 0 ? (
        searching ? (
          <EmptyState
            icon={<SearchIcon />}
            title={t("search.emptyTitle")}
            description={t("search.emptyDescription", { term: debounced })}
          />
        ) : selected ? (
          <EmptyState
            icon={<UsersIcon />}
            title={t("tables.emptyTitle", { name: selected.name })}
            description={isClients ? t("tables.clientsEmpty") : t("tables.emptyDescription")}
          />
        ) : (
          <EmptyState
            icon={<UsersIcon />}
            title={t("empty.title")}
            description={t("empty.description")}
            action={
              canEdit && (
                <Button
                  onClick={() => {
                    setPrefill(undefined);
                    setCreating(true);
                  }}
                >
                  <PlusIcon aria-hidden data-icon="inline-start" />
                  {t("actions.newContact")}
                </Button>
              )
            }
          />
        )
      ) : (
        <>
          <ContactList
            contacts={contacts}
            tables={tables}
            extraLabel={isClients ? t("tables.wonDeals") : undefined}
            renderExtra={
              isClients
                ? (contact) => <ClientDeals contact={contact} deals={wonDeals} />
                : undefined
            }
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

      <GenerateContactsDialog
        open={generating}
        onOpenChange={setGenerating}
        onShowNew={() => {
          const unreached = tableList.find((table) => table.system_key === "unreached");
          setTerm("");
          selectTable(unreached?.id ?? null);
        }}
      />
      <ContactFormDialog
        open={creating}
        onOpenChange={setCreating}
        initial={prefill}
        onCreated={(contact) => router.push(`/contacts/${contact.id}`)}
      />
    </div>
  );
}

/** "2 deals · 45 000 Kč"; currencies are added up separately, never converted. */
function ClientDeals({ contact, deals }: { contact: ContactListItem; deals: WonDealsByContact }) {
  const t = useTranslations("contacts.tables");
  const settings = useFormatSettings();
  const own = deals[contact.id];
  if (!own) return <Skeleton className="h-4 w-20" />;
  const totals = sumByCurrency(own)
    .map(({ currency, total }) => formatCurrency(total, currency, settings))
    .join(" + ");
  return (
    <span className="text-sm text-green">
      {t("dealCount", { count: own.length })}
      {totals && <span className="text-ink-soft"> · {totals}</span>}
    </span>
  );
}
