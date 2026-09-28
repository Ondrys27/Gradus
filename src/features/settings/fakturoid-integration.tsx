"use client";

import { useState, type FormEvent } from "react";
import { LinkIcon, LoaderCircleIcon, RefreshCwIcon, UnplugIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { errorFromCode } from "@/features/finance/fakturoid/errors";
import { fakturoidConnectSchema, type FakturoidStatus } from "@/features/finance/fakturoid/schema";
import { useInvoiceErrorText } from "@/features/finance/fakturoid/use-invoice-error";
import {
  useConnectFakturoid,
  useDisconnectFakturoid,
  useFakturoidStatus,
  useSetMoveDealOnPaid,
  useSyncFakturoid,
} from "@/features/finance/queries";
import { APP_NAME } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";

type Field = "clientId" | "clientSecret" | "slug";
const FIELD_ERRORS = ["required", "tooLong", "invalidSlug"] as const;
type FieldError = (typeof FIELD_ERRORS)[number];

/** Settings → Integrations: connect Fakturoid, or manage the connection. */
export function FakturoidIntegration() {
  const t = useTranslations("settings.integrations.fakturoid");
  const status = useFakturoidStatus();
  const errorText = useInvoiceErrorText();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{t("name")}</h3>
        {status.data?.connected && (
          <StatusPill tone="green" dot>
            {t("connected", { slug: status.data.slug })}
          </StatusPill>
        )}
      </div>
      <p className="text-sm text-ink-soft">{t("description")}</p>
      {status.isError ? (
        <FormAlert>{errorText(status.error)}</FormAlert>
      ) : !status.data ? (
        <Skeleton className="h-40 w-full" aria-hidden />
      ) : status.data.connected ? (
        <Connected status={status.data} />
      ) : (
        <ConnectForm />
      )}
    </div>
  );
}

function ConnectForm() {
  const t = useTranslations("settings.integrations.fakturoid");
  const connect = useConnectFakturoid();
  const errorText = useInvoiceErrorText();
  const [values, setValues] = useState<Record<Field, string>>({
    clientId: "",
    clientSecret: "",
    slug: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, FieldError>>>({});

  function change(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = fakturoidConnectSchema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<Field, FieldError>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        const key = FIELD_ERRORS.find((code) => code === issue.message) ?? "required";
        next[field] ??= key;
      }
      setErrors(next);
      return;
    }
    connect.mutate(parsed.data, {
      onSuccess: () => setValues({ clientId: "", clientSecret: "", slug: "" }),
    });
  }

  const error = (field: Field) => (errors[field] ? t(`errors.${errors[field]}`) : undefined);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{t("notConnected", { appName: APP_NAME })}</p>
      <p className="rounded-xl border border-line bg-canvas-deep/60 px-3.5 py-3 text-sm text-ink-soft">
        {t("help")}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="fakturoid-client-id" label={t("clientId")} error={error("clientId")}>
          <Input
            {...fieldA11y("fakturoid-client-id", errors.clientId)}
            value={values.clientId}
            onChange={(event) => change("clientId", event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <FormField
          id="fakturoid-client-secret"
          label={t("clientSecret")}
          error={error("clientSecret")}
          hint={t("secretHint")}
        >
          <PasswordInput
            {...fieldA11y("fakturoid-client-secret", errors.clientSecret, true)}
            value={values.clientSecret}
            onChange={(event) => change("clientSecret", event.target.value)}
            autoComplete="off"
            spellCheck={false}
            showLabel={t("showSecret")}
            hideLabel={t("hideSecret")}
          />
        </FormField>
        <FormField id="fakturoid-slug" label={t("slug")} error={error("slug")}>
          <Input
            {...fieldA11y("fakturoid-slug", errors.slug)}
            value={values.slug}
            onChange={(event) => change("slug", event.target.value)}
            placeholder={t("slugPlaceholder")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </FormField>
      </div>
      {connect.isError && <FormAlert>{errorText(connect.error)}</FormAlert>}
      <Button type="submit" disabled={connect.isPending} className="self-start">
        {connect.isPending ? (
          <LoaderCircleIcon
            aria-hidden
            data-icon="inline-start"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <LinkIcon aria-hidden data-icon="inline-start" />
        )}
        {connect.isPending ? t("connecting") : t("connect")}
      </Button>
    </form>
  );
}

function Connected({ status }: { status: Extract<FakturoidStatus, { connected: true }> }) {
  const t = useTranslations("settings.integrations.fakturoid");
  const settings = useFormatSettings();
  const errorText = useInvoiceErrorText();
  const setMove = useSetMoveDealOnPaid();
  const sync = useSyncFakturoid();
  const disconnect = useDisconnectFakturoid();
  const [confirming, setConfirming] = useState(false);
  const moveDeal = setMove.isPending ? setMove.variables : status.moveDealOnPaid;
  const lastError = status.lastSyncError ? errorText(errorFromCode(status.lastSyncError)) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm text-ink-muted">
        <p>
          {t("connectedSince", { date: formatDateTime(new Date(status.connectedAt), settings) })}
        </p>
        <p role="status">
          {status.lastSyncedAt
            ? t("lastSynced", { date: formatDateTime(new Date(status.lastSyncedAt), settings) })
            : t("neverSynced")}
        </p>
      </div>
      {lastError && !sync.isSuccess && (
        <FormAlert>{t("lastError", { message: lastError })}</FormAlert>
      )}

      <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-canvas-deep/60 px-4 py-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[15px] font-medium text-ink">{t("moveDeal")}</span>
          <span className="text-xs text-ink-muted">{t("moveDealHint")}</span>
        </span>
        <Switch
          checked={moveDeal}
          disabled={setMove.isPending}
          onCheckedChange={(checked) => setMove.mutate(checked)}
        />
      </label>
      {setMove.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
      {sync.isError && <FormAlert>{errorText(sync.error)}</FormAlert>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCwIcon
            aria-hidden
            data-icon="inline-start"
            className={cn(sync.isPending && "animate-spin motion-reduce:animate-none")}
          />
          {sync.isPending ? t("syncing") : t("sync")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
          <UnplugIcon aria-hidden data-icon="inline-start" />
          {t("disconnect")}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("disconnectTitle")}
        description={t("disconnectDescription", { appName: APP_NAME })}
        confirmLabel={t("disconnect")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={disconnect.isPending}
        error={disconnect.isError ? t("disconnectFailed") : null}
        onConfirm={() => disconnect.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      />
    </div>
  );
}
