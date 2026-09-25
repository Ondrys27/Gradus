"use client";

import { useMemo, useState, type FormEvent } from "react";
import { PlusIcon, XIcon } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { dependencyCandidates, fieldOptions, newOptionKey } from "./field-logic";
import {
  FIELD_LABEL_MAX,
  fieldErrors,
  fieldSchema,
  OPTION_LABEL_MAX,
  type ContactErrorKey,
} from "./schemas";
import { useSaveField } from "./table-queries";
import {
  FIELD_TYPES,
  MEETING_FIELD_KEY,
  type ContactField,
  type FieldOption,
  type FieldType,
} from "./types";

type Props = {
  /** Open while there is a target: a table to add to, optionally the question to edit. */
  target: { tableId: string; field?: ContactField } | null;
  /** Questions of the same table, for the dependency choice. */
  siblings: ContactField[];
  onClose: () => void;
};

const NO_DEPENDENCY = "__none__";

export function FieldFormDialog({ target, siblings, onClose }: Props) {
  const t = useTranslations("contacts.fieldForm");
  const generation = useFreshOnOpen(target !== null);
  return (
    <ResponsiveDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={target?.field ? t("editTitle") : t("addTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      {target && (
        <FieldFields
          key={generation}
          tableId={target.tableId}
          field={target.field}
          siblings={siblings}
          onDone={onClose}
        />
      )}
    </ResponsiveDialog>
  );
}

function FieldFields({
  tableId,
  field,
  siblings,
  onDone,
}: {
  tableId: string;
  field?: ContactField;
  siblings: ContactField[];
  onDone: () => void;
}) {
  const t = useTranslations("contacts");
  const save = useSaveField();
  const [label, setLabel] = useState(field?.label ?? "");
  const [type, setType] = useState<FieldType>(field?.type ?? "text");
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState<FieldOption[]>(() => {
    const existing = fieldOptions(field?.options ?? null);
    return existing.length ? existing : [{ key: newOptionKey([]), label: "" }];
  });
  const [dependsOn, setDependsOn] = useState<string | null>(field?.depends_on_field_id ?? null);
  const [dependsValue, setDependsValue] = useState<string | null>(field?.depends_on_value ?? null);
  const [meeting, setMeeting] = useState(field?.system_key === MEETING_FIELD_KEY);
  const [errors, setErrors] = useState<Partial<Record<string, ContactErrorKey>>>({});
  const [failed, setFailed] = useState(false);

  const typeItems = useMemo(
    () => FIELD_TYPES.map((value) => ({ value, label: t(`fieldTypes.${value}`) })),
    [t],
  );
  const candidates = useMemo(
    () => dependencyCandidates(siblings, field?.id ?? null),
    [siblings, field?.id],
  );
  const parentItems = useMemo(
    () => [
      { value: NO_DEPENDENCY, label: t("fieldForm.always") },
      ...candidates.map((candidate) => ({ value: candidate.id, label: candidate.label })),
    ],
    [candidates, t],
  );
  const parent = candidates.find((candidate) => candidate.id === dependsOn);
  const valueItems = useMemo(
    () =>
      fieldOptions(parent?.options ?? null).map((option) => ({
        value: option.key,
        label: option.label,
      })),
    [parent],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = fieldSchema.safeParse({
      label,
      type,
      required,
      options: type === "select" ? options : [],
      depends_on_field_id: parent ? parent.id : null,
      depends_on_value: parent ? dependsValue : null,
      meeting: type === "datetime" && meeting,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ tableId, field, input: parsed.data });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  const labelError = errors.label && t(`errors.${errors.label}`);
  const optionsError = errors.options && t(`errors.${errors.options}`);
  const valueError = errors.depends_on_value && t(`errors.${errors.depends_on_value}`);
  // Questions hanging on a removed option, or on a select that stops being one, go with it.
  const dependants = field ? siblings.filter((item) => item.depends_on_field_id === field.id) : [];
  const losesDependants = dependants.some(
    (item) => type !== "select" || !options.some((option) => option.key === item.depends_on_value),
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="field-label" label={t("fieldForm.label")} error={labelError}>
        <Input
          {...fieldA11y("field-label", labelError)}
          value={label}
          autoFocus
          maxLength={FIELD_LABEL_MAX + 10}
          placeholder={t("fieldForm.labelPlaceholder")}
          onChange={(event) => setLabel(event.target.value)}
        />
      </FormField>

      <FormField id="field-type" label={t("fieldForm.type")}>
        <Select
          value={type}
          items={typeItems}
          onValueChange={(next) => {
            if (next && (FIELD_TYPES as readonly string[]).includes(next))
              setType(next as FieldType);
          }}
        >
          <SelectTrigger id="field-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeItems.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {type === "select" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-soft">
            {t("fieldForm.options")}
          </legend>
          {options.map((option, index) => (
            <div key={option.key} className="flex items-center gap-2">
              <Input
                value={option.label}
                aria-label={t("fieldForm.optionLabel", { number: index + 1 })}
                aria-invalid={optionsError ? true : undefined}
                maxLength={OPTION_LABEL_MAX}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((item) =>
                      item.key === option.key ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label={t("fieldForm.removeOption", { number: index + 1 })}
                disabled={options.length === 1}
                onClick={() =>
                  setOptions((current) => current.filter((item) => item.key !== option.key))
                }
                className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted outline-none hover:text-pink focus-visible:ring-3 focus-visible:ring-pink/40 disabled:cursor-not-allowed disabled:opacity-40 mouse:size-9"
              >
                <XIcon aria-hidden className="size-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              setOptions((current) => [...current, { key: newOptionKey(current), label: "" }])
            }
          >
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("fieldForm.addOption")}
          </Button>
          {optionsError && <p className="text-xs text-pink">{optionsError}</p>}
        </fieldset>
      )}

      <label className="flex min-h-11 items-center justify-between gap-4 text-sm text-ink-soft">
        {t("fieldForm.required")}
        <Switch checked={required} onCheckedChange={setRequired} />
      </label>

      {type === "datetime" && (
        <label className="flex min-h-11 items-center justify-between gap-4 text-sm text-ink-soft">
          <span className="flex flex-col">
            {t("fieldForm.meeting")}
            <span className="text-xs text-ink-muted">{t("fieldForm.meetingHint")}</span>
          </span>
          <Switch checked={meeting} onCheckedChange={setMeeting} />
        </label>
      )}

      {candidates.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="field-depends" label={t("fieldForm.showWhen")}>
            <Select
              value={parent ? parent.id : NO_DEPENDENCY}
              items={parentItems}
              onValueChange={(next) => {
                setDependsOn(next && next !== NO_DEPENDENCY ? next : null);
                setDependsValue(null);
              }}
            >
              <SelectTrigger id="field-depends">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {parentItems.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {parent && (
            <FormField
              id="field-depends-value"
              label={t("fieldForm.isAnswered")}
              error={valueError}
            >
              <Select
                value={dependsValue}
                items={valueItems}
                onValueChange={(next) => setDependsValue(next)}
              >
                <SelectTrigger
                  id="field-depends-value"
                  aria-invalid={valueError ? true : undefined}
                >
                  <SelectValue placeholder={t("fieldForm.pickAnswer")} />
                </SelectTrigger>
                <SelectContent>
                  {valueItems.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        </div>
      )}

      {losesDependants && (
        <p role="status" className="text-sm text-gold">
          {t("fieldForm.dependantsWarning")}
        </p>
      )}
      {failed && <FormAlert>{t("fieldForm.saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("fieldForm.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {field ? t("fieldForm.save") : t("fieldForm.add")}
        </Button>
      </div>
    </form>
  );
}
