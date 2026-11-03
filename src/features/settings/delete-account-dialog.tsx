"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircleIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { deleteAccountAction, type DeleteAccountState } from "@/features/account/data-actions";
import { useSession } from "@/features/account/queries";
import { sameEmail } from "@/features/account/same-email";
import { loginPath } from "@/lib/auth/routes";

const WORKERS_PATH = "/app/pracovnici";

/**
 * Settings → Privacy and data: delete the account for good after typing its
 * e-mail. The server decides; this only explains and asks.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("settings.data.delete");
  const locale = useLocale();
  const { user, worker } = useSession();
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(
    deleteAccountAction,
    {},
  );
  const matches = sameEmail(typed, user.email);

  // The account is gone: a full load, so nothing of it stays in memory.
  useEffect(() => {
    if (state.deleted) window.location.replace(`${loginPath(locale)}?deleted=1`);
  }, [state.deleted, locale]);

  const error = state.error && state.error !== "emailMismatch" ? state.error : null;
  const fieldError = state.error === "emailMismatch" ? t("errors.emailMismatch") : undefined;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (pending || state.deleted) return;
        if (!next) setTyped("");
        onOpenChange(next);
      }}
      title={t("title")}
      closeLabel={t("close")}
    >
      <form action={action} className="flex flex-col gap-5">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-ink-soft">
          <li>{t("point1")}</li>
          {worker && <li>{t("pointWorker")}</li>}
          <li>{t("point2")}</li>
          <li>{t("point3")}</li>
        </ul>
        <FormField
          id="delete-account-email"
          label={t("emailLabel", { email: user.email })}
          error={fieldError}
        >
          <Input
            {...fieldA11y("delete-account-email", fieldError)}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </FormField>
        {error && (
          <FormAlert>
            {t(`errors.${error}`)}
            {error === "active_workers" && (
              <>
                {" "}
                <Link href={WORKERS_PATH} className="font-semibold underline underline-offset-2">
                  {t("openWorkers")}
                </Link>
              </>
            )}
          </FormAlert>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setTyped("");
              onOpenChange(false);
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={!matches || pending || state.deleted}
            aria-busy={pending}
          >
            {pending && (
              <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
            )}
            {t("confirm")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
