"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeftIcon, CheckIcon, MailIcon, SearchIcon, UserRoundCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
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
import { parseAccountTarget, type AccountTarget } from "./invite-target";
import { JOB_TITLE_MAX, NAME_MAX, validate, workerSchema, type WorkerErrorKey } from "./logic";
import { grantsFromRows, type PermissionGrants } from "./permissions-catalog";
import { PermissionsEditor } from "./permissions-editor";
import { InviteActionError, useCreateWorker, useLookupInviteAccount, useUpdateWorker } from "./queries";
import type { FoundAccount, InviteErrorCode } from "./server/invites";
import type { Worker, WorkerInvite } from "./types";

/** What the server says about a username or short id, as the field's error. */
const ACCOUNT_ERRORS: Partial<Record<InviteErrorCode, WorkerErrorKey>> = {
  notFound: "accountNotFound",
  self: "targetSelf",
  alreadyMember: "targetAlreadyMember",
  invalid: "accountInvalid",
  limited: "accountLimited",
};

/** What the server says about an e-mail, as the field's error. */
const EMAIL_ERRORS: Partial<Record<InviteErrorCode, WorkerErrorKey>> = {
  self: "targetSelf",
  alreadyMember: "targetAlreadyMember",
  invalid: "emailInvalid",
};

type Created = {
  name: string;
  invite: WorkerInvite;
  bound: boolean;
  emailed: boolean;
  replaced: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this worker, or adding a new one when null. */
  worker: Worker | null;
  permissions?: PermissionGrants;
  /** A new worker starts under this manager (null = right under the owner). */
  defaultManagerId?: string | null;
};

/**
 * Add (invite) or edit a worker. Inviting (28.1) starts with a choice: somebody
 * who already uses the app (found by their exact @username or short id, shown
 * as a card) or somebody new (a name and an e-mail, a link to register). Then
 * their role, rights, manager and groups. Adding ends on the invite.
 */
export function WorkerFormDialog({
  open,
  onOpenChange,
  worker,
  permissions,
  defaultManagerId = null,
}: Props) {
  const t = useTranslations("workers.form");
  const tInvite = useTranslations("workers.invite");
  const generation = useFreshOnOpen(open);
  const [created, setCreated] = useState<Created | null>(null);

  function change(next: boolean) {
    if (!next) setCreated(null);
    onOpenChange(next);
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={change}
      title={
        created
          ? created.bound
            ? t("inviteSent")
            : t("inviteReady")
          : worker
            ? t("editTitle")
            : t("newTitle")
      }
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      {created ? (
        <div className="flex flex-col gap-4">
          {created.replaced && (
            <p className="text-sm text-ink-soft" data-testid="invite-replaced-old">
              {tInvite("replacedOld")}
            </p>
          )}
          <InviteCard invite={created.invite} workerName={created.name} />
          {created.emailed && (
            <p className="text-sm text-teal" data-testid="invite-emailed">
              {tInvite("emailed")}
            </p>
          )}
          <Button onClick={() => change(false)} className="self-end" data-tutorial="worker-invite-done">
            {t("done")}
          </Button>
        </div>
      ) : worker ? (
        <EditFields key={generation} worker={worker} onCancel={() => change(false)} onSaved={() => change(false)} />
      ) : (
        <InviteFields
          key={generation}
          permissions={permissions}
          defaultManagerId={defaultManagerId}
          onCancel={() => change(false)}
          onCreated={setCreated}
        />
      )}
    </ResponsiveDialog>
  );
}

function EditFields({
  worker,
  onCancel,
  onSaved,
}: {
  worker: Worker;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("workers.form");
  const tErrors = useTranslations("workers.errors");
  const update = useUpdateWorker(worker.id);
  const [name, setName] = useState(worker.name);
  const [email, setEmail] = useState(worker.email ?? "");
  const [jobTitle, setJobTitle] = useState(worker.job_title ?? "");
  const [errors, setErrors] = useState<Partial<Record<string, WorkerErrorKey>>>({});
  const [failed, setFailed] = useState(false);
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
      // Rights of an existing worker are switched live on their page, not here.
      await update.mutateAsync({ worker: result.data });
      onSaved();
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <NameField value={name} onChange={setName} error={err("name")} />
      <FormField id="worker-email" label={t("email")} error={err("email")}>
        <Input
          {...fieldA11y("worker-email", err("email"))}
          value={email}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <JobField value={jobTitle} onChange={setJobTitle} error={err("job_title")} />
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <Actions pending={update.isPending} submitLabel={t("save")} onCancel={onCancel} />
    </form>
  );
}

type Mode = "choose" | "existing" | "new";

function InviteFields({
  permissions: initialPermissions,
  defaultManagerId,
  onCancel,
  onCreated,
}: {
  permissions?: PermissionGrants;
  defaultManagerId: string | null;
  onCancel: () => void;
  onCreated: (result: Created) => void;
}) {
  const t = useTranslations("workers.form");
  const tErrors = useTranslations("workers.errors");
  const create = useCreateWorker();
  const lookup = useLookupInviteAccount();
  const [mode, setMode] = useState<Mode>("choose");
  // Somebody who has the app: what was typed, and who it found.
  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<{ target: AccountTarget; account: FoundAccount } | null>(null);
  // Somebody new.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  // Without a choice a new worker has their own tasks and branch only.
  const [permissions, setPermissions] = useState<PermissionGrants>(
    () => initialPermissions ?? grantsFromRows([]),
  );
  const [managerId, setManagerId] = useState<string>(defaultManagerId ?? OWNER_ROOT);
  const [groupIds, setGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Partial<Record<string, WorkerErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const err = (key: string) => (errors[key] ? tErrors(errors[key]) : undefined);

  function choose(next: Mode) {
    setErrors({});
    setFailed(false);
    setMode(next);
  }

  async function find(event?: FormEvent) {
    event?.preventDefault();
    setFailed(false);
    const parsed = parseAccountTarget(handle);
    if (!parsed.ok) {
      setErrors({ account: parsed.error === "targetRequired" ? "accountRequired" : "accountInvalid" });
      return;
    }
    setErrors({});
    try {
      const account = await lookup.mutateAsync(handle);
      setFound({ target: parsed.target, account });
    } catch (error) {
      const code = error instanceof InviteActionError ? ACCOUNT_ERRORS[error.code] : undefined;
      if (code) setErrors({ account: code });
      else setFailed(true);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const place = {
      grants: permissions,
      managerId: managerId === OWNER_ROOT ? null : managerId,
      groupIds: [...groupIds],
    };
    if (mode === "existing") {
      if (!found) return void find();
      // The worker record is called what the person calls themselves.
      const cardName =
        found.account.name?.trim() ||
        (found.account.username
          ? `@${found.account.username}`
          : found.target.kind === "id"
            ? found.target.publicId
            : `@${found.target.username}`);
      const result = validate(workerSchema.omit({ email: true }), {
        name: cardName.slice(0, NAME_MAX),
        job_title: jobTitle,
      });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      try {
        const saved = await create.mutateAsync({
          worker: { ...result.data, email: null },
          ...place,
          target: found.target,
        });
        onCreated({ name: saved.worker.name, ...saved });
      } catch (error) {
        const code = error instanceof InviteActionError ? ACCOUNT_ERRORS[error.code] : undefined;
        if (code) {
          setFound(null);
          setErrors({ account: code });
        } else setFailed(true);
      }
      return;
    }

    const result = validate(workerSchema, { name, email, job_title: jobTitle });
    if (!result.ok) {
      setErrors({
        ...result.errors,
        ...(result.errors.email && !email.trim() ? { email: "emailRequired" as const } : {}),
      });
      return;
    }
    setErrors({});
    try {
      const saved = await create.mutateAsync({
        worker: result.data,
        ...place,
        target: { kind: "email", email: result.data.email },
      });
      onCreated({ name: saved.worker.name, ...saved });
    } catch (error) {
      const code = error instanceof InviteActionError ? EMAIL_ERRORS[error.code] : undefined;
      if (code) setErrors({ email: code });
      else setFailed(true);
    }
  }

  if (mode === "choose") {
    return (
      <div className="flex flex-col gap-4" data-testid="invite-choice">
        <p className="text-sm text-ink-soft">{t("choice.question")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceButton
            data-tutorial="worker-invite-existing"
            icon={<UserRoundCheckIcon />}
            title={t("choice.existing")}
            description={t("choice.existingHint")}
            onClick={() => choose("existing")}
          />
          <ChoiceButton
            data-tutorial="worker-invite-new"
            icon={<MailIcon />}
            title={t("choice.new")}
            description={t("choice.newHint")}
            onClick={() => choose("new")}
          />
        </div>
        <Button type="button" variant="ghost" className="self-end" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    );
  }

  const back = (
    <button
      type="button"
      onClick={() => choose("choose")}
      className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start rounded-lg text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
      data-testid="invite-back"
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      {t("choice.back")}
    </button>
  );

  // Somebody who already uses the app: first find them, exactly.
  if (mode === "existing" && !found) {
    return (
      <form onSubmit={find} noValidate className="flex flex-col gap-4">
        {back}
        <FormField id="worker-account" label={t("account.label")} error={err("account")} hint={t("account.hint")}>
          <div className="flex gap-2">
            <Input
              {...fieldA11y("worker-account", err("account"), true)}
              value={handle}
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={64}
              placeholder={t("account.placeholder")}
              onChange={(event) => setHandle(event.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={lookup.isPending} data-testid="worker-find">
              <SearchIcon aria-hidden data-icon="inline-start" />
              {t("account.find")}
            </Button>
          </div>
        </FormField>
        {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {back}
      {mode === "existing" && found ? (
        <div
          className="flex items-center gap-3 rounded-2xl border border-teal/40 bg-teal/10 p-3"
          data-testid="invite-found-card"
        >
          <Avatar
            src={found.account.avatarUrl}
            name={found.account.name ?? found.account.username}
            className="size-12 text-base"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold text-ink" data-testid="invite-found-name">
              {found.account.name || t("account.noName")}
            </span>
            {found.account.username && (
              <span className="truncate text-sm text-ink-soft" data-testid="invite-found-username">
                @{found.account.username}
              </span>
            )}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setFound(null)}>
            {t("account.change")}
          </Button>
        </div>
      ) : (
        <>
          <NameField value={name} onChange={setName} error={err("name")} />
          <FormField id="worker-email" label={t("email")} error={err("email")} hint={t("emailHint")}>
            <Input
              {...fieldA11y("worker-email", err("email"), true)}
              value={email}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
        </>
      )}
      {err("account") && <FormAlert>{err("account")}</FormAlert>}
      <JobField value={jobTitle} onChange={setJobTitle} error={err("job_title")} />
      <PlaceInCompany
        managerId={managerId}
        onManagerChange={setManagerId}
        groupIds={groupIds}
        onGroupsChange={setGroupIds}
      />
      <PermissionsEditor value={permissions} onChange={(next) => setPermissions(next)} />
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <Actions pending={create.isPending} submitLabel={t("create")} onCancel={onCancel} />
    </form>
  );
}

function ChoiceButton({
  "data-tutorial": tutorial,
  icon,
  title,
  description,
  onClick,
}: {
  "data-tutorial": string;
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tutorial={tutorial}
      onClick={onClick}
      className="flex min-h-11 cursor-pointer flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-4 text-left outline-none transition-colors hover:border-violet/60 hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40"
    >
      <span className="grid size-9 place-items-center rounded-xl border border-violet/30 bg-violet/10 text-violet [&_svg]:size-4.5">
        {icon}
      </span>
      <span className="font-semibold text-ink">{title}</span>
      <span className="text-sm text-ink-soft">{description}</span>
    </button>
  );
}

function NameField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  const t = useTranslations("workers.form");
  return (
    <FormField id="worker-name" label={t("name")} error={error}>
      <Input
        {...fieldA11y("worker-name", error)}
        value={value}
        maxLength={NAME_MAX + 10}
        autoComplete="off"
        autoFocus
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

function JobField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  const t = useTranslations("workers.form");
  return (
    <FormField id="worker-job" label={t("jobTitle")} error={error}>
      <Input
        {...fieldA11y("worker-job", error)}
        value={value}
        maxLength={JOB_TITLE_MAX + 10}
        placeholder={t("jobTitlePlaceholder")}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

function Actions({
  pending,
  submitLabel,
  onCancel,
}: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  const t = useTranslations("workers.form");
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="ghost" onClick={onCancel}>
        {t("cancel")}
      </Button>
      <Button type="submit" data-tutorial="worker-submit" disabled={pending}>
        {submitLabel}
      </Button>
    </div>
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
  // Everyone can be a manager of a worker who does not exist yet, except who left.
  const managers = useMemo(
    () =>
      managerChoices(people.data ?? [], "")
        .filter((choice) => !choice.person || choice.person.status !== "inactive")
        .map((choice) => ({
          value: choice.id,
          label: choice.person
            ? `${" ".repeat(Math.max(choice.depth - 1, 0))}${choice.person.name}`
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
