"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CurrencyPicker } from "@/components/ui/currency-picker";
import { DatePicker } from "@/components/ui/date-picker";
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
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { formatPrice, todayIsoDate, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useAddManualReward, useCreatePayout, useEditEntry, type ManualRewardInput } from "./queries";
import { useAmountText } from "./amount-text";
import { AMOUNT_MAX, NOTE_MAX } from "./rules";
import type { RewardEntry } from "./types";

/** Something of the person's work a reward by hand may hang on. */
export type LinkOption = { value: string; label: string; link: NonNullable<ManualRewardInput["link"]> };

const NONE = "none";

/** "Add reward": amount (negative = a deduction), reason, day, optionally a task or deal. */
export function AddRewardDialog({
  open,
  onOpenChange,
  workerId,
  currency,
  links,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workerId: string;
  currency: string;
  links: LinkOption[];
}) {
  const t = useTranslations("workers.rewardPlan.add");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      <AddFields
        key={generation}
        workerId={workerId}
        currency={currency}
        links={links}
        onDone={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
}

function AddFields({
  workerId,
  currency: initialCurrency,
  links,
  onDone,
}: {
  workerId: string;
  currency: string;
  links: LinkOption[];
  onDone: () => void;
}) {
  const t = useTranslations("workers.rewardPlan.add");
  const te = useTranslations("workers.rewardPlan.errors");
  const settings = useFormatSettings();
  const amountText = useAmountText();
  const add = useAddManualReward();
  const today = todayIsoDate(settings);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(initialCurrency);
  const [note, setNote] = useState("");
  const [day, setDay] = useState<IsoDate | null>(today);
  const [link, setLink] = useState<string>(NONE);
  const [errors, setErrors] = useState<{ amount?: string; note?: string }>({});
  const [failed, setFailed] = useState(false);
  const items = useMemo(() => [{ value: NONE, label: t("noLink") }, ...links], [links, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = amountText.parse(amount);
    const next: typeof errors = {};
    if (value === null || !Number.isFinite(value) || value === 0 || Math.abs(value) > AMOUNT_MAX) {
      next.amount = te("amountNonZero");
    }
    if (!note.trim()) next.note = te("noteRequired");
    else if (note.trim().length > NOTE_MAX) next.note = te("noteTooLong");
    setErrors(next);
    if (next.amount || next.note || value === null) return;
    setFailed(false);
    try {
      await add.mutateAsync({
        workerId,
        amount: value,
        currency,
        occurredOn: day && day <= today ? day : today,
        note: note.trim(),
        link: links.find((option) => option.value === link)?.link ?? null,
      });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="reward-add-form">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <FormField id="reward-add-amount" label={t("amount")} error={errors.amount} hint={t("amountHint")}>
          <Input
            {...fieldA11y("reward-add-amount", errors.amount, true)}
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            onChange={(event) => setAmount(event.target.value)}
            data-testid="reward-add-amount"
          />
        </FormField>
        <CurrencyPicker id="reward-add-currency" value={currency} onChange={setCurrency} compact ariaLabel={t("currency")} />
      </div>
      <FormField id="reward-add-note" label={t("note")} error={errors.note}>
        <Input
          {...fieldA11y("reward-add-note", errors.note, true)}
          value={note}
          maxLength={NOTE_MAX + 10}
          autoComplete="off"
          placeholder={t("notePlaceholder")}
          onChange={(event) => setNote(event.target.value)}
          data-testid="reward-add-note"
        />
      </FormField>
      <FormField id="reward-add-day" label={t("day")}>
        <DatePicker id="reward-add-day" value={day} onValueChange={setDay} />
      </FormField>
      {links.length > 0 && (
        <FormField id="reward-add-link" label={t("link")}>
          <Select
            value={link}
            items={items}
            onValueChange={(next) => typeof next === "string" && setLink(next)}
          >
            <SelectTrigger id="reward-add-link">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={add.isPending} data-testid="reward-add-submit">
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}

/** Another amount or note on a reward not paid yet. */
export function EditEntryDialog({
  entry,
  onOpenChange,
}: {
  entry: RewardEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("workers.rewardPlan.edit");
  const generation = useFreshOnOpen(entry !== null);
  return (
    <ResponsiveDialog
      open={entry !== null}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,440px)]"
    >
      {entry && <EditFields key={generation} entry={entry} onDone={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  );
}

function EditFields({ entry, onDone }: { entry: RewardEntry; onDone: () => void }) {
  const t = useTranslations("workers.rewardPlan.edit");
  const te = useTranslations("workers.rewardPlan.errors");
  const amountText = useAmountText();
  const edit = useEditEntry();
  const [amount, setAmount] = useState(amountText.show(entry.amount));
  const [note, setNote] = useState(entry.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = amountText.parse(amount);
    if (value === null || !Number.isFinite(value) || value === 0 || Math.abs(value) > AMOUNT_MAX) {
      setError(te("amountNonZero"));
      return;
    }
    setError(null);
    setFailed(false);
    try {
      await edit.mutateAsync({ id: entry.id, amount: value, note: note.trim().slice(0, NOTE_MAX) });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="reward-edit-amount" label={t("amount", { currency: entry.currency })} error={error ?? undefined}>
        <Input
          {...fieldA11y("reward-edit-amount", error ?? undefined, true)}
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          onChange={(event) => setAmount(event.target.value)}
        />
      </FormField>
      <FormField id="reward-edit-note" label={t("note")}>
        <Input
          {...fieldA11y("reward-edit-note", undefined)}
          value={note}
          maxLength={NOTE_MAX + 10}
          autoComplete="off"
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={edit.isPending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

/** One payout to make: whose, which entries, the total and its currency. */
export type PayoutRequest = { workerId: string; name: string; ids: string[]; total: number; currency: string };

/**
 * "Mark paid": a day and a note for one or more payouts. Each becomes an
 * expense in Finance (category Rewards) and a row of the month plan.
 */
export function PayoutDialog({
  requests,
  onOpenChange,
  from,
}: {
  requests: PayoutRequest[];
  onOpenChange: (open: boolean) => void;
  from: "worker" | "company";
}) {
  const t = useTranslations("workers.rewardPlan.payout");
  const open = requests.length > 0;
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      {open && (
        <PayoutFields key={generation} requests={requests} from={from} onDone={() => onOpenChange(false)} />
      )}
    </ResponsiveDialog>
  );
}

function PayoutFields({
  requests,
  from,
  onDone,
}: {
  requests: PayoutRequest[];
  from: "worker" | "company";
  onDone: () => void;
}) {
  const t = useTranslations("workers.rewardPlan.payout");
  const settings = useFormatSettings();
  const create = useCreatePayout(from);
  const today = todayIsoDate(settings);
  const [day, setDay] = useState<IsoDate | null>(today);
  const [note, setNote] = useState("");
  // Only what has not been paid yet: a retry never pays a person twice.
  const [remaining, setRemaining] = useState(requests);
  const [failed, setFailed] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const missed: PayoutRequest[] = [];
    for (const request of remaining) {
      try {
        await create.mutateAsync({
          workerId: request.workerId,
          entryIds: request.ids,
          paidOn: day && day <= today ? day : today,
          note: note.slice(0, NOTE_MAX),
        });
      } catch {
        missed.push(request);
      }
    }
    setPending(false);
    if (missed.length === 0) return onDone();
    setRemaining(missed);
    setFailed(missed.map((request) => request.name));
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="reward-payout-form">
      <ul className="flex flex-col gap-1.5 rounded-2xl border border-line px-4 py-3 text-sm">
        {remaining.map((request) => (
          <li key={`${request.workerId}-${request.currency}`} className="flex justify-between gap-3">
            <span className="truncate text-ink-soft">
              {t("line", { name: request.name, count: request.ids.length })}
            </span>
            <span className="font-semibold text-ink tabular-nums">
              {formatPrice(request.total, request.currency, settings)}
            </span>
          </li>
        ))}
      </ul>
      <FormField id="reward-payout-day" label={t("day")}>
        <DatePicker id="reward-payout-day" value={day} onValueChange={setDay} />
      </FormField>
      <FormField id="reward-payout-note" label={t("note")}>
        <Input
          {...fieldA11y("reward-payout-note", undefined)}
          value={note}
          maxLength={NOTE_MAX + 10}
          autoComplete="off"
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      <p className="text-xs text-ink-muted">{t("financeHint")}</p>
      {failed.length > 0 && <FormAlert>{t("saveFailed", { names: failed.join(", ") })}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending} data-testid="reward-payout-submit">
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
