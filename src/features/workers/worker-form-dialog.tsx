"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckIcon } from "lucide-react";
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
import { toneFill, toneSoft } from "@/components/ui/tone";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { cn } from "@/lib/utils";
import { useCompanyGroups, useCompanyTree } from "./company/queries";
import { managerChoices, OWNER_ROOT, type CompanyGroup } from "./company/tree";
import { InviteCard } from "./invite-card";
import {
  emptyPermissions,
  JOB_TITLE_MAX,
  NAME_MAX,
  validate,
  workerSchema,
  type PermissionDraft,
  type WorkerErrorKey,
} from "./logic";
import { PermissionsEditor } from "./permissions-editor";
import { useCreateWorker, useUpdateWorker } from "./queries";
import type { Worker, WorkerInvite } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this worker, or adding a new one when null. */
  worker: Worker | null;
  permissions?: PermissionDraft;
  /** A new worker starts under this manager (null = right under the owner). */
  defaultManagerId?: string | null;
};

/**
 * Add (invite) or edit a worker. Inviting also places them in the company: a
 * manager and any groups. Adding ends on the invite to send.
 */
export function WorkerFormDialog({
  open,
  onOpenChange,
  worker,
  permissions,
  defaultManagerId = null,
}: Props) {
  const t = useTranslations("workers.form");
  const generation = useFreshOnOpen(open);
  const [created, setCreated] = useState<{ name: string; invite: WorkerInvite } | null>(null);

  function change(next: boolean) {
    if (!next) setCreated(null);
    onOpenChange(next);
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={change}
      title={created ? t("inviteReady") : worker ? t("editTitle") : t("newTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <InviteCard invite={created.invite} workerName={created.name} />
          <Button onClick={() => change(false)} className="self-end">
            {t("done")}
          </Button>
        </div>
      ) : (
        <Fields
          key={generation}
          worker={worker}
          permissions={permissions}
          defaultManagerId={defaultManagerId}
          onCancel={() => change(false)}
          onCreated={setCreated}
          onSaved={() => change(false)}
        />
      )}
    </ResponsiveDialog>
  );
}

function Fields({
  worker,
  permissions: initialPermissions,
  defaultManagerId,
  onCancel,
  onCreated,
  onSaved,
}: {
  worker: Worker | null;
  permissions?: PermissionDraft;
  defaultManagerId: string | null;
  onCancel: () => void;
  onCreated: (result: { name: string; invite: WorkerInvite }) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("workers.form");
  const tErrors = useTranslations("workers.errors");
  const create = useCreateWorker();
  const update = useUpdateWorker(worker?.id ?? "");
  const [name, setName] = useState(worker?.name ?? "");
  const [email, setEmail] = useState(worker?.email ?? "");
  const [jobTitle, setJobTitle] = useState(worker?.job_title ?? "");
  const [permissions, setPermissions] = useState<PermissionDraft>(
    () => initialPermissions ?? emptyPermissions(),
  );
  const [managerId, setManagerId] = useState<string>(defaultManagerId ?? OWNER_ROOT);
  const [groupIds, setGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Partial<Record<string, WorkerErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const pending = create.isPending || update.isPending;
  const err = (key: string) => (errors[key] ? tErrors(errors[key]) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const result = validate(workerSchema, { name, email, job_title: jobTitle });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      if (worker) {
        // Rights of an existing worker are switched live on their page, not here.
        await update.mutateAsync({ worker: result.data });
        onSaved();
      } else {
        const { worker: saved, invite } = await create.mutateAsync({
          worker: result.data,
          permissions,
          managerId: managerId === OWNER_ROOT ? null : managerId,
          groupIds: [...groupIds],
        });
        onCreated({ name: saved.name, invite });
      }
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="worker-name" label={t("name")} error={err("name")}>
        <Input
          {...fieldA11y("worker-name", err("name"))}
          value={name}
          maxLength={NAME_MAX + 10}
          autoComplete="off"
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField
        id="worker-email"
        label={t("email")}
        error={err("email")}
        hint={worker ? undefined : t("emailHint")}
      >
        <Input
          {...fieldA11y("worker-email", err("email"), !worker)}
          value={email}
          type="email"
          inputMode="email"
          autoComplete="off"
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <FormField id="worker-job" label={t("jobTitle")} error={err("job_title")}>
        <Input
          {...fieldA11y("worker-job", err("job_title"))}
          value={jobTitle}
          maxLength={JOB_TITLE_MAX + 10}
          placeholder={t("jobTitlePlaceholder")}
          autoComplete="off"
          onChange={(event) => setJobTitle(event.target.value)}
        />
      </FormField>
      {!worker && (
        <PlaceInCompany
          managerId={managerId}
          onManagerChange={setManagerId}
          groupIds={groupIds}
          onGroupsChange={setGroupIds}
        />
      )}
      {!worker && <PermissionsEditor value={permissions} onChange={setPermissions} />}
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {worker ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}

/** Where a new worker goes: under whom, and into which groups. */
function PlaceInCompany({
  managerId,
  onManagerChange,
  groupIds,
  onGroupsChange,
}: {
  managerId: string;
  onManagerChange: (id: string) => void;
  groupIds: ReadonlySet<string>;
  onGroupsChange: (ids: ReadonlySet<string>) => void;
}) {
  const t = useTranslations("workers.company.invite");
  const people = useCompanyTree();
  const groups = useCompanyGroups();
  // Everyone can be a manager of a worker who does not exist yet.
  const managers = useMemo(
    () =>
      managerChoices(people.data ?? [], "").map((choice) => ({
        value: choice.id,
        label: choice.person
          ? `${"\u2002".repeat(Math.max(choice.depth - 1, 0))}${choice.person.name}`
          : t("managerOwner"),
      })),
    [people.data, t],
  );

  function toggle(group: CompanyGroup) {
    const next = new Set(groupIds);
    if (!next.delete(group.id)) next.add(group.id);
    onGroupsChange(next);
  }

  return (
    <>
      {managers.length > 1 && (
        <div className="flex flex-col gap-2">
          <span id="worker-manager-label" className="text-sm font-medium text-ink-soft">
            {t("manager")}
          </span>
          <Select
            value={managerId}
            items={managers}
            onValueChange={(next) => {
              if (typeof next === "string") onManagerChange(next);
            }}
          >
            <SelectTrigger aria-labelledby="worker-manager-label" data-testid="worker-manager">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {managers.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {(groups.data?.length ?? 0) > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-soft">{t("groups")}</legend>
          <div className="flex flex-wrap gap-2">
            {groups.data!.map((group) => {
              const selected = groupIds.has(group.id);
              return (
                <button
                  key={group.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(group)}
                  className={cn(
                    "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8",
                    selected ? toneSoft[group.color] : "border-line text-ink-soft hover:text-ink",
                  )}
                >
                  {selected ? (
                    <CheckIcon aria-hidden className="size-3.5" />
                  ) : (
                    <span
                      aria-hidden
                      className={cn("size-2 rounded-full", toneFill[group.color])}
                    />
                  )}
                  {group.name}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink-muted">{t("groupsHint")}</p>
        </fieldset>
      )}
    </>
  );
}
