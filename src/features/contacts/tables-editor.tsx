"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  TableIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toneFill } from "@/components/ui/tone";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { FieldFormDialog } from "./field-form-dialog";
import { byPosition, fieldOptions, reorder } from "./field-logic";
import { useContactTables, useTableCounts } from "./queries";
import { TABLE_NAME_MAX } from "./schemas";
import { SortableList } from "./sortable-list";
import { AddTableDialog, RemoveTableDialog, TableColorPicker } from "./table-dialogs";
import {
  useDeleteField,
  useFields,
  useReorderFields,
  useReorderTables,
  useUpdateTable,
} from "./table-queries";
import { MEETING_FIELD_KEY, tableTone, type ContactField, type ContactTable } from "./types";

export function TablesEditor() {
  const t = useTranslations("contacts.tableEditor");
  const tablesQuery = useContactTables();
  const fieldsQuery = useFields();
  const countsQuery = useTableCounts();
  const reorderTables = useReorderTables();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ContactTable | null>(null);
  const [fieldTarget, setFieldTarget] = useState<{ tableId: string; field?: ContactField } | null>(
    null,
  );

  const tables = useMemo(() => byPosition(tablesQuery.data ?? []), [tablesQuery.data]);
  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);
  const fieldsOf = (tableId: string) =>
    byPosition(fields.filter((field) => field.table_id === tableId));

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/contacts"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
      >
        <ArrowLeftIcon aria-hidden data-icon="inline-start" />
        {t("back")}
      </Link>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("addTable")}
          </Button>
        }
      />

      {reorderTables.isError && <FormAlert>{t("reorderFailed")}</FormAlert>}

      {tablesQuery.isPending || fieldsQuery.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-16 rounded-card" />
          ))}
        </div>
      ) : tablesQuery.isError || fieldsQuery.isError ? (
        <EmptyState
          icon={<TableIcon />}
          title={t("loadFailed")}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void tablesQuery.refetch();
                void fieldsQuery.refetch();
              }}
            >
              {t("retry")}
            </Button>
          }
        />
      ) : (
        <SortableList
          items={tables}
          nameOf={(table) => table.name}
          onReorder={(activeId, overId) =>
            reorderTables.mutate({
              activeId,
              overId,
              changes: reorder(tables, activeId, overId).changes,
            })
          }
          renderItem={(table, handle) => (
            <TableCard
              table={table}
              handle={handle}
              fields={fieldsOf(table.id)}
              count={countsQuery.data?.get(table.id)}
              onRemove={() => {
                void countsQuery.refetch();
                setRemoving(table);
              }}
              onAddField={() => setFieldTarget({ tableId: table.id })}
              onEditField={(field) => setFieldTarget({ tableId: table.id, field })}
            />
          )}
        />
      )}

      <AddTableDialog open={adding} onOpenChange={setAdding} />
      <RemoveTableDialog
        table={removing}
        tables={tables}
        contactCount={removing ? (countsQuery.data?.get(removing.id) ?? 0) : 0}
        onClose={() => setRemoving(null)}
      />
      <FieldFormDialog
        target={fieldTarget}
        siblings={fieldTarget ? fieldsOf(fieldTarget.tableId) : []}
        onClose={() => setFieldTarget(null)}
      />
    </div>
  );
}

function TableCard({
  table,
  handle,
  fields,
  count,
  onRemove,
  onAddField,
  onEditField,
}: {
  table: ContactTable;
  handle: ReactNode;
  fields: ContactField[];
  count: number | undefined;
  onRemove: () => void;
  onAddField: () => void;
  onEditField: (field: ContactField) => void;
}) {
  const t = useTranslations("contacts.tableEditor");
  const update = useUpdateTable();
  const [open, setOpen] = useState(false);
  const isClients = table.system_key === "clients";
  const panelId = `table-${table.id}-panel`;
  const settings = useFormatSettings();
  const toggleLabel = isClients ? t("settings") : t("questionCount", { count: fields.length });

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center gap-2 p-2 pr-3">
        {handle}
        <span
          aria-hidden
          className={cn("size-2.5 shrink-0 rounded-full", toneFill[tableTone(table.color)])}
        />
        <TableNameInput
          table={table}
          onRename={(name) => update.mutate({ id: table.id, patch: { name } })}
        />
        {count !== undefined && (
          <span className="hidden shrink-0 text-xs text-ink-muted tabular-nums sm:inline">
            {t("contactCount", { count })}
          </span>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          aria-label={toggleLabel}
          className="inline-flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 text-sm text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 sm:px-3 mouse:h-8"
        >
          {/* On a phone the label would squeeze the table name; the count alone is enough. */}
          <span aria-hidden className="hidden sm:inline">
            {toggleLabel}
          </span>
          {!isClients && (
            <span aria-hidden className="tabular-nums sm:hidden">
              {formatNumber(fields.length, {}, settings)}
            </span>
          )}
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-4 transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
        {table.is_system ? (
          <span
            title={t("systemTable")}
            className="grid size-11 shrink-0 place-items-center text-ink-muted mouse:size-8"
          >
            <LockIcon aria-label={t("systemTable")} className="size-4" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={t("removeNamed", { name: table.name })}
            onClick={onRemove}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-pink focus-visible:ring-3 focus-visible:ring-pink/40 mouse:size-8"
          >
            <Trash2Icon aria-hidden className="size-4" />
          </button>
        )}
      </div>

      {update.isError && <FormAlert className="mx-3 mb-3">{t("saveFailed")}</FormAlert>}

      {open && (
        <div id={panelId} className="flex flex-col gap-5 border-t border-line p-4">
          <TableColorPicker
            value={table.color}
            label={t("color")}
            onChange={(color) => update.mutate({ id: table.id, patch: { color } })}
          />
          {isClients ? (
            <p className="text-sm text-ink-muted">{t("clientsNoQuestions")}</p>
          ) : (
            <FieldsPanel
              tableId={table.id}
              fields={fields}
              onAdd={onAddField}
              onEdit={onEditField}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Renames on blur or Enter; Escape or an empty name puts the old one back. */
function TableNameInput({
  table,
  onRename,
}: {
  table: ContactTable;
  onRename: (name: string) => void;
}) {
  const t = useTranslations("contacts.tableEditor");
  const [value, setValue] = useState(table.name);
  useEffect(() => setValue(table.name), [table.name]);

  function commit() {
    const name = value.trim();
    if (!name) setValue(table.name);
    else if (name !== table.name) onRename(name);
  }

  return (
    <Input
      value={value}
      maxLength={TABLE_NAME_MAX}
      aria-label={t("rename", { name: table.name })}
      className="h-11 min-w-0 flex-1 border-transparent bg-transparent px-2 font-semibold hover:border-line focus:border-line mouse:h-9"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(table.name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function FieldsPanel({
  tableId,
  fields,
  onAdd,
  onEdit,
}: {
  tableId: string;
  fields: ContactField[];
  onAdd: () => void;
  onEdit: (field: ContactField) => void;
}) {
  const t = useTranslations("contacts");
  const reorderFields = useReorderFields();
  const remove = useDeleteField();
  const [deleting, setDeleting] = useState<ContactField | null>(null);
  const byId = new Map(fields.map((field) => [field.id, field]));

  function dependencyText(field: ContactField) {
    const parent = field.depends_on_field_id ? byId.get(field.depends_on_field_id) : undefined;
    if (!parent) return null;
    const option = fieldOptions(parent.options).find((item) => item.key === field.depends_on_value);
    return t("tableEditor.dependsOn", { question: parent.label, answer: option?.label ?? "" });
  }

  const dependantCount = deleting
    ? fields.filter((field) => field.depends_on_field_id === deleting.id).length
    : 0;

  return (
    <section aria-label={t("tableEditor.questions")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="micro-label">{t("tableEditor.questions")}</h3>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <PlusIcon aria-hidden data-icon="inline-start" />
          {t("tableEditor.addQuestion")}
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
          {t("tableEditor.noQuestions")}
        </p>
      ) : (
        <SortableList
          items={fields}
          nameOf={(field) => field.label}
          onReorder={(activeId, overId) =>
            reorderFields.mutate({
              tableId,
              activeId,
              overId,
              changes: reorder(fields, activeId, overId).changes,
            })
          }
          renderItem={(field, handle) => {
            const dependency = dependencyText(field);
            return (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-hover/40 py-1 pr-2 pl-1">
                {handle}
                <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5">
                  <span className="truncate text-sm font-medium text-ink">{field.label}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusPill>{t(`fieldTypes.${field.type}`)}</StatusPill>
                    {field.required && (
                      <StatusPill tone="gold">{t("tableEditor.required")}</StatusPill>
                    )}
                    {field.system_key === MEETING_FIELD_KEY && (
                      <StatusPill tone="teal">{t("tableEditor.meeting")}</StatusPill>
                    )}
                    {dependency && <span className="text-xs text-ink-muted">{dependency}</span>}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={t("tableEditor.editQuestion", { name: field.label })}
                  onClick={() => onEdit(field)}
                  className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
                >
                  <PencilIcon aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={t("tableEditor.deleteQuestion", { name: field.label })}
                  onClick={() => setDeleting(field)}
                  className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-pink focus-visible:ring-3 focus-visible:ring-pink/40 mouse:size-8"
                >
                  <Trash2Icon aria-hidden className="size-4" />
                </button>
              </div>
            );
          }}
        />
      )}
      {reorderFields.isError && <FormAlert>{t("tableEditor.reorderFailed")}</FormAlert>}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("tableEditor.deleteQuestionTitle")}
        description={
          deleting
            ? t("tableEditor.deleteQuestionDescription", {
                name: deleting.label,
                count: dependantCount,
              })
            : ""
        }
        confirmLabel={t("tableEditor.delete")}
        cancelLabel={t("tableEditor.cancel")}
        closeLabel={t("tableEditor.close")}
        pending={remove.isPending}
        error={remove.isError ? t("tableEditor.deleteQuestionFailed") : null}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </section>
  );
}
