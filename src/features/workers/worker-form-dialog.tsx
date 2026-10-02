"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
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
};

/** Add or edit a worker. Adding ends on the invite to send. */
export function WorkerFormDialog({ open, onOpenChange, worker, permissions }: Props) {
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
  onCancel,
  onCreated,
  onSaved,
}: {
  worker: Worker | null;
  permissions?: PermissionDraft;
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
