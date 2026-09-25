"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toneFill } from "@/components/ui/tone";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { cn } from "@/lib/utils";
import { fieldErrors, TABLE_NAME_MAX, tableSchema, type ContactErrorKey } from "./schemas";
import { useCreateTable, useRemoveTable } from "./table-queries";
import { TABLE_TONES, tableTone, type ContactTable } from "./types";

type TableTone = (typeof TABLE_TONES)[number];

/** Colour chips; the value is a design tone, never a hex. */
export function TableColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (tone: TableTone) => void;
  label: string;
}) {
  const t = useTranslations("contacts.tableEditor.colors");
  const current = tableTone(value);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-soft">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {TABLE_TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            aria-pressed={current === tone}
            aria-label={t(tone)}
            onClick={() => onChange(tone)}
            className={cn(
              "grid size-11 cursor-pointer place-items-center rounded-full border outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-9",
              current === tone ? "border-ink" : "border-line",
            )}
          >
            <span className={cn("size-5 rounded-full", toneFill[tone])} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function AddTableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("contacts.tableEditor");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("addTitle")}
      closeLabel={t("close")}
    >
      <AddTableFields key={generation} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function AddTableFields({ onDone }: { onDone: () => void }) {
  const t = useTranslations("contacts");
  const create = useCreateTable();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TableTone>("violet");
  const [errors, setErrors] = useState<Partial<Record<string, ContactErrorKey>>>({});
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = tableSchema.safeParse({ name, color });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await create.mutateAsync(parsed.data);
      onDone();
    } catch {
      setFailed(true);
    }
  }

  const nameError = errors.name && t(`errors.${errors.name}`);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="table-name" label={t("tableEditor.name")} error={nameError}>
        <Input
          {...fieldA11y("table-name", nameError)}
          value={name}
          autoFocus
          maxLength={TABLE_NAME_MAX + 10}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <TableColorPicker value={color} onChange={setColor} label={t("tableEditor.color")} />
      {failed && <FormAlert>{t("tableEditor.saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("tableEditor.cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {t("tableEditor.add")}
        </Button>
      </div>
    </form>
  );
}

/** A table with contacts asks where they go; Clients is never offered. */
export function RemoveTableDialog({
  table,
  tables,
  contactCount,
  onClose,
}: {
  table: ContactTable | null;
  tables: ContactTable[];
  contactCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("contacts.tableEditor");
  const generation = useFreshOnOpen(table !== null);
  return (
    <ResponsiveDialog
      open={table !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("removeTitle")}
      closeLabel={t("close")}
    >
      {table && (
        <RemoveFields
          key={generation}
          table={table}
          targets={tables.filter((item) => item.id !== table.id && item.system_key !== "clients")}
          contactCount={contactCount}
          onClose={onClose}
        />
      )}
    </ResponsiveDialog>
  );
}

function RemoveFields({
  table,
  targets,
  contactCount,
  onClose,
}: {
  table: ContactTable;
  targets: ContactTable[];
  contactCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("contacts.tableEditor");
  const remove = useRemoveTable();
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const items = useMemo(
    () => targets.map((item) => ({ value: item.id, label: item.name })),
    [targets],
  );

  async function confirm() {
    try {
      await remove.mutateAsync({ id: table.id, moveTo: contactCount > 0 ? target : null });
      onClose();
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        {contactCount > 0
          ? t("removeWithContacts", { name: table.name, count: contactCount })
          : t("removeEmpty", { name: table.name })}
      </p>
      {contactCount > 0 && (
        <FormField id="remove-table-target" label={t("moveTo")}>
          <Select value={target} items={items} onValueChange={(next) => next && setTarget(next)}>
            <SelectTrigger id="remove-table-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {remove.isError && <FormAlert>{t("removeFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={remove.isPending || (contactCount > 0 && !target)}
          onClick={() => void confirm()}
        >
          {t("remove")}
        </Button>
      </div>
    </div>
  );
}
