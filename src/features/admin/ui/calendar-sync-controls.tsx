"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input, Label } from "@/components/ui/input";
import {
  addCalendarSyncAccount,
  removeCalendarSyncAccount,
  setCalendarSyncDate,
  setCalendarSyncMode,
  type CalendarSyncResult,
} from "../server/calendar-sync-actions";

export type SyncAccount = { id: string; label: string; email: string | null };

type Props = {
  everyone: boolean;
  /** The day (YYYY-MM-DD, administration's zone) for the date input, or "". */
  dateValue: string;
  /** The same day formatted for reading, or null when nobody is let in by date. */
  dateText: string | null;
  accounts: SyncAccount[];
  readOnly: boolean;
};

/** The calendar sync switch, its date and the hand-added accounts (step 28.10). */
export function CalendarSyncControls({ everyone, dateValue, dateText, accounts, readOnly }: Props) {
  const t = useTranslations("admin.integrations");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [date, setDate] = useState(dateValue);
  const [query, setQuery] = useState("");

  const run = (action: () => Promise<CalendarSyncResult>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      onDone?.();
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6" id="propojeni-kalendaru">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">{t("sync.mode")}</p>
        <p className="text-sm text-ink-soft" data-testid="calendar-sync-mode">
          {everyone ? t("sync.modeEveryone") : t("sync.modeAllowlist")}
        </p>
        {!readOnly && (
          <div>
            {everyone ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => setCalendarSyncMode(false))}
                data-testid="calendar-sync-selected"
              >
                {t("sync.selectedOnly")}
              </Button>
            ) : (
              <Button disabled={pending} onClick={() => setConfirming(true)} data-testid="calendar-sync-everyone">
                {t("sync.everyone")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2" id="propojeni-datum">
        <Label htmlFor="calendar-sync-date">
          {dateText ? t("sync.createdBefore", { date: dateText }) : t("sync.createdBeforeNone")}
        </Label>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="calendar-sync-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="max-w-48"
              disabled={pending}
            />
            <Button
              variant="secondary"
              disabled={pending || !date || date === dateValue}
              onClick={() => run(() => setCalendarSyncDate(date))}
            >
              {t("sync.saveDate")}
            </Button>
            {dateText && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => setCalendarSyncDate(null), () => setDate(""))}
              >
                {t("sync.clearDate")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2" id="propojeni-ucty">
        <p className="text-sm font-semibold text-ink">{t("sync.accounts")}</p>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("sync.noAccounts")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-1">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-ink">{account.label}</span>
                  {account.email && (
                    <span className="truncate text-xs text-ink-muted">{account.email}</span>
                  )}
                </span>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => removeCalendarSyncAccount(account.id))}
                  >
                    {t("sync.remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!query.trim()) return;
              run(() => addCalendarSyncAccount(query), () => setQuery(""));
            }}
          >
            <div className="flex min-w-56 flex-1 flex-col gap-1">
              <Label htmlFor="calendar-sync-add">{t("sync.addLabel")}</Label>
              <Input
                id="calendar-sync-add"
                value={query}
                maxLength={200}
                placeholder={t("sync.addPlaceholder")}
                onChange={(event) => setQuery(event.target.value)}
                disabled={pending}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={pending || !query.trim()}>
              {t("sync.add")}
            </Button>
          </form>
        )}
      </div>

      {readOnly && <p className="text-xs text-ink-muted">{t("readOnly")}</p>}
      {error && <FormAlert>{error}</FormAlert>}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("sync.confirmTitle")}
        description={t("sync.confirmText")}
        confirmLabel={t("sync.everyone")}
        cancelLabel={t("cancel")}
        closeLabel={t("cancel")}
        pending={pending}
        error={error}
        onConfirm={() => run(() => setCalendarSyncMode(true))}
      />
    </div>
  );
}
