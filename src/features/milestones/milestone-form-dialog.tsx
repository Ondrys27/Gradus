"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateMilestone, useUpdateMilestone } from "./queries";
import {
  DESCRIPTION_MAX,
  fieldErrors,
  milestoneSchema,
  TAG_MAX,
  TITLE_MAX,
  type MilestoneErrorKey,
} from "./schemas";
import type { Milestone, MilestoneCategory } from "./types";
import { useFreshOnOpen } from "./use-fresh-on-open";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this milestone; without it the dialog creates one. */
  milestone?: Milestone;
  onCreated?: (milestone: Milestone) => void;
};

export function MilestoneFormDialog({ open, onOpenChange, milestone, onCreated }: Props) {
  const t = useTranslations("milestones.form");
  const generation = useFreshOnOpen(open);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={milestone ? t("editTitle") : t("createTitle")}
      closeLabel={t("close")}
    >
      <MilestoneFields
        key={generation}
        milestone={milestone}
        onDone={() => onOpenChange(false)}
        onCreated={onCreated}
      />
    </ResponsiveDialog>
  );
}

function MilestoneFields({
  milestone,
  onDone,
  onCreated,
}: {
  milestone?: Milestone;
  onDone: () => void;
  onCreated?: (milestone: Milestone) => void;
}) {
  const t = useTranslations("milestones");
  const create = useCreateMilestone();
  const update = useUpdateMilestone(milestone?.id ?? "");
  const [title, setTitle] = useState(milestone?.title ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [category, setCategory] = useState<MilestoneCategory>(milestone?.category ?? "work");
  const [tag, setTag] = useState(milestone?.tag ?? "");
  const [targetDate, setTargetDate] = useState<string | null>(milestone?.target_date ?? null);
  const [errors, setErrors] = useState<Partial<Record<string, MilestoneErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const pending = create.isPending || update.isPending;

  const categories = useMemo(
    () => [
      { value: "work", label: t("category.work") },
      { value: "personal", label: t("category.personal") },
    ],
    [t],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = milestoneSchema.safeParse({
      title,
      description,
      category,
      tag,
      target_date: targetDate,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      if (milestone) {
        await update.mutateAsync(parsed.data);
      } else {
        onCreated?.(await create.mutateAsync(parsed.data));
      }
      onDone();
    } catch {
      setFailed(true);
    }
  }

  const titleError = errors.title && t(`errors.${errors.title}`);
  const descriptionError = errors.description && t(`errors.${errors.description}`);
  const tagError = errors.tag && t(`errors.${errors.tag}`);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="milestone-title" label={t("form.name")} error={titleError}>
        <Input
          {...fieldA11y("milestone-title", titleError)}
          value={title}
          maxLength={TITLE_MAX + 20}
          placeholder={t("form.namePlaceholder")}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField id="milestone-description" label={t("form.description")} error={descriptionError}>
        <Textarea
          {...fieldA11y("milestone-description", descriptionError)}
          value={description}
          maxLength={DESCRIPTION_MAX + 100}
          placeholder={t("form.descriptionPlaceholder")}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="milestone-category" label={t("form.category")}>
          <Select
            value={category}
            items={categories}
            onValueChange={(next) => {
              if (next === "work" || next === "personal") setCategory(next);
            }}
          >
            <SelectTrigger id="milestone-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="milestone-date" label={t("form.targetDate")}>
          <DatePicker
            id="milestone-date"
            value={targetDate}
            onValueChange={setTargetDate}
            placeholder={t("form.targetDatePlaceholder")}
          />
        </FormField>
      </div>
      <FormField id="milestone-tag" label={t("form.tag")} error={tagError} hint={t("form.tagHint")}>
        <Input
          {...fieldA11y("milestone-tag", tagError, true)}
          value={tag}
          maxLength={TAG_MAX + 10}
          onChange={(event) => setTag(event.target.value)}
        />
      </FormField>
      {failed && <FormAlert>{t("form.saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {milestone ? t("form.save") : t("form.create")}
        </Button>
      </div>
    </form>
  );
}
