"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { ContactFormDialog } from "./contact-form-dialog";
import { ContactList } from "./contact-list";
import { useContactList, useContactTables } from "./queries";

export function ContactsView() {
  const t = useTranslations("contacts");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const debounced = useDebouncedValue(term.trim(), 250);

  const tablesQuery = useContactTables();
  const listQuery = useContactList({ term: debounced, tableId: null });

  const tables = useMemo(
    () => new Map((tablesQuery.data ?? []).map((table) => [table.id, table])),
    [tablesQuery.data],
  );
  const contacts = useMemo(() => listQuery.data?.pages.flat() ?? [], [listQuery.data]);
  const searching = debounced !== "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tNav("contacts")}
        description={t("description")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("actions.newContact")}
          </Button>
        }
      />

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

      {listQuery.isPending ? (
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
        ) : (
          <EmptyState
            icon={<UsersIcon />}
            title={t("empty.title")}
            description={t("empty.description")}
            action={
              <Button onClick={() => setCreating(true)}>
                <PlusIcon aria-hidden data-icon="inline-start" />
                {t("actions.newContact")}
              </Button>
            }
          />
        )
      ) : (
        <>
          <ContactList contacts={contacts} tables={tables} />
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

      <ContactFormDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(contact) => router.push(`/contacts/${contact.id}`)}
      />
    </div>
  );
}
