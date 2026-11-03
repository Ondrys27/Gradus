"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckIcon, FilterIcon, PencilIcon, PlusIcon, Trash2Icon, TagsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { GlowCard } from "@/components/ui/glow-card";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toneFill } from "@/components/ui/tone";
import { TonePicker } from "@/components/ui/tone-picker";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { companyErrorOf, useDeleteGroup, useSaveGroup, type CompanyError } from "./queries";
import {
  GROUP_TONES,
  membersByGroup,
  type CompanyGroup,
  type CompanyPerson,
  type GroupTone,
} from "./tree";

export const GROUP_NAME_MAX = 60;
export const GROUP_DESCRIPTION_MAX = 500;

/** How many member avatars a group card shows before "+N". */
const AVATARS_SHOWN = 6;

type Props = {
  people: CompanyPerson[] | undefined;
  groups: CompanyGroup[] | undefined;
  failed: boolean;
  canEdit: boolean;
  /** Shows the group's people in the tree (People tab with the filter). */
  onShow: (groupId: string) => void;
};

/** Groups of the company: create, rename, colour, describe, members, delete. */
export function CompanyGroups({ people, groups, failed, canEdit, onShow }: Props) {
  const t = useTranslations("workers.company.groups");
  const tErrors = useTranslations("workers.company.errors");
  const settings = useFormatSettings();
  const remove = useDeleteGroup();
  const [editing, setEditing] = useState<{ open: boolean; group: CompanyGroup | null }>({
    open: false,
    group: null,
  });
  const [deleting, setDeleting] = useState<{ open: boolean; group: CompanyGroup | null }>({
    open: false,
    group: null,
  });
  const members = useMemo(() => membersByGroup(people ?? []), [people]);
  const byId = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);

  const add = (
    <Button onClick={() => setEditing({ open: true, group: null })}>
      <PlusIcon aria-hidden data-icon="inline-start" />
      {t("add")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-ink-soft">{t("description")}</p>
        {canEdit && groups && groups.length > 0 && add}
      </div>

      {failed ? (
        <FormAlert>{tErrors("loadFailed")}</FormAlert>
      ) : !groups || !people ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
          {[0, 1].map((key) => (
            <Skeleton key={key} className="h-36 w-full rounded-card" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<TagsIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={canEdit ? add : undefined}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="company-groups">
          {groups.map((group) => {
            const ids = members.get(group.id) ?? [];
            const shown = ids.slice(0, AVATARS_SHOWN);
            return (
              <li key={group.id}>
                <GlowCard className="flex h-full flex-col gap-3" data-group={group.id}>
                  <div className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className={cn("mt-1.5 size-3 shrink-0 rounded-full", toneFill[group.color])}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <h3 className="truncate font-semibold text-ink">{group.name}</h3>
                      {group.description && (
                        <p className="text-sm break-words whitespace-pre-line text-ink-soft">
                          {group.description}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <span className="-mt-1 -mr-1 flex shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("edit", { name: group.name })}
                          onClick={() => setEditing({ open: true, group })}
                        >
                          <PencilIcon aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("delete", { name: group.name })}
                          onClick={() => setDeleting({ open: true, group })}
                          className="text-destructive"
                        >
                          <Trash2Icon aria-hidden />
                        </Button>
                      </span>
                    )}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      {shown.length > 0 && (
                        <span className="flex -space-x-2">
                          {shown.map((id) => {
                            const person = byId.get(id);
                            return person ? (
                              <Avatar
                                key={id}
                                src={person.avatarUrl}
                                name={person.name}
                                className="size-7 border-2 border-surface text-[11px]"
                              />
                            ) : null;
                          })}
                        </span>
                      )}
                      <span className="text-xs text-ink-muted">
                        {t("members", {
                          count: group.memberCount,
                          shown: formatNumber(group.memberCount, {}, settings),
                        })}
                      </span>
                    </span>
                    {group.memberCount > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => onShow(group.id)}>
                        <FilterIcon aria-hidden data-icon="inline-start" />
                        {t("show")}
                      </Button>
                    )}
                  </div>
                </GlowCard>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <GroupDialog
          open={editing.open}
          onOpenChange={(open) => setEditing((current) => ({ ...current, open }))}
          group={editing.group}
          memberIds={editing.group ? (members.get(editing.group.id) ?? []) : []}
          people={people ?? []}
          nextPosition={(groups ?? []).reduce((max, group) => Math.max(max, group.position + 1), 0)}
        />
      )}
      {deleting.group && (
        <ConfirmDialog
          open={deleting.open}
          onOpenChange={(open) => {
            setDeleting((current) => ({ ...current, open }));
            if (!open) remove.reset();
          }}
          title={t("deleteTitle", { name: deleting.group.name })}
          description={t("deleteDescription")}
          confirmLabel={t("deleteConfirm")}
          cancelLabel={t("cancel")}
          closeLabel={t("close")}
          pending={remove.isPending}
          error={remove.isError ? t("deleteFailed") : null}
          onConfirm={() => {
            const group = deleting.group!;
            remove.mutate(
              { id: group.id, members: group.memberCount },
              { onSuccess: () => setDeleting({ open: false, group }) },
            );
          }}
        />
      )}
    </div>
  );
}

function GroupDialog({
  open,
  onOpenChange,
  group,
  memberIds,
  people,
  nextPosition,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: CompanyGroup | null;
  memberIds: string[];
  people: CompanyPerson[];
  nextPosition: number;
}) {
  const t = useTranslations("workers.company.groupForm");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={group ? t("editTitle") : t("newTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <GroupFields
        key={generation}
        group={group}
        memberIds={memberIds}
        people={people}
        nextPosition={nextPosition}
        onDone={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
}

type FieldErrors = Partial<
  Record<"name" | "description", "nameRequired" | "nameTooLong" | "descriptionTooLong">
>;

function GroupFields({
  group,
  memberIds,
  people,
  nextPosition,
  onDone,
}: {
  group: CompanyGroup | null;
  memberIds: string[];
  people: CompanyPerson[];
  nextPosition: number;
  onDone: () => void;
}) {
  const t = useTranslations("workers.company.groupForm");
  const tColors = useTranslations("workers.company.colors");
  const tErrors = useTranslations("workers.company.errors");
  const save = useSaveGroup();
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<GroupTone>(group?.color ?? "violet");
  const [description, setDescription] = useState(group?.description ?? "");
  const [members, setMembers] = useState<ReadonlySet<string>>(() => new Set(memberIds));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<CompanyError | null>(null);
  const sorted = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name)), [people]);
  const err = (key: keyof FieldErrors) => (errors[key] ? t(`errors.${errors[key]}`) : undefined);

  function toggle(id: string) {
    setMembers((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const cleanName = name.trim();
    const cleanDescription = description.trim();
    const found: FieldErrors = {};
    if (!cleanName) found.name = "nameRequired";
    else if (cleanName.length > GROUP_NAME_MAX) found.name = "nameTooLong";
    if (cleanDescription.length > GROUP_DESCRIPTION_MAX) found.description = "descriptionTooLong";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await save.mutateAsync({
        group: {
          name: cleanName,
          color,
          description: cleanDescription || null,
          memberIds: [...members],
        },
        existing: group ? { id: group.id, memberIds } : null,
        position: nextPosition,
      });
      onDone();
    } catch (cause) {
      setFailure(companyErrorOf(cause));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="group-name" label={t("name")} error={err("name")}>
        <Input
          {...fieldA11y("group-name", err("name"))}
          value={name}
          maxLength={GROUP_NAME_MAX + 10}
          placeholder={t("namePlaceholder")}
          autoComplete="off"
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <TonePicker
        tones={GROUP_TONES}
        value={color}
        onChange={setColor}
        label={t("color")}
        labelOf={(tone) => tColors(tone)}
      />
      <FormField id="group-description" label={t("description")} error={err("description")}>
        <Textarea
          {...fieldA11y("group-description", err("description"))}
          value={description}
          rows={3}
          maxLength={GROUP_DESCRIPTION_MAX + 20}
          placeholder={t("descriptionPlaceholder")}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-soft">{t("members")}</legend>
        {sorted.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noWorkers")}</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-2xl border border-line/70 p-1">
            {sorted.map((person) => {
              const selected = members.has(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(person.id)}
                  className={cn(
                    "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 text-left text-[15px] text-ink-soft outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                    selected && "bg-teal/10 text-ink",
                  )}
                >
                  <Avatar
                    src={person.avatarUrl}
                    name={person.name}
                    className="size-7 text-[11px]"
                  />
                  <span className="min-w-0 flex-1 truncate">{person.name}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-md border-2",
                      selected ? "border-teal bg-teal text-canvas" : "border-line-strong",
                    )}
                  >
                    {selected && <CheckIcon className="size-3.5" strokeWidth={3.5} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </fieldset>
      {failure && <FormAlert>{tErrors(failure)}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {group ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}
