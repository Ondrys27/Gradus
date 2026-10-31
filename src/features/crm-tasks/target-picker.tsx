"use client";

import { useState, type ReactNode } from "react";
import { ContactRoundIcon, HandshakeIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { contactName } from "@/features/contacts/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { useTargetSearch, type TargetOption } from "./queries";
import type { TaskTarget } from "./types";

type Props = {
  id: string;
  value: TaskTarget;
  onChange: (next: TaskTarget) => void;
  /** Made from a deal or a contact: what it belongs to is shown, not changed. */
  locked?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placeholder: string;
};

/**
 * "U čeho": a deal (with its contact) or a contact, found as you type. Picking
 * a deal brings its contact along; either chip can be taken off again.
 */
export function TargetPicker({
  id,
  value,
  onChange,
  locked,
  invalid,
  describedBy,
  placeholder,
}: Props) {
  const t = useTranslations("crmTasks.form");
  const empty = !value.deal && !value.contact;

  return (
    <div className="flex flex-col gap-2">
      {!empty && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("target")}>
          {value.deal && (
            <TargetChip
              icon={<HandshakeIcon aria-hidden className="size-3.5" />}
              label={value.deal.title}
              removeLabel={locked ? null : t("targetRemove", { name: value.deal.title })}
              onRemove={() => onChange({ ...value, deal: null })}
            />
          )}
          {value.contact && (
            <TargetChip
              icon={<ContactRoundIcon aria-hidden className="size-3.5" />}
              label={contactName(value.contact)}
              removeLabel={locked ? null : t("targetRemove", { name: contactName(value.contact) })}
              onRemove={() => onChange({ ...value, contact: null })}
            />
          )}
        </ul>
      )}
      {!locked && empty && (
        <TargetSearch
          id={id}
          invalid={invalid}
          describedBy={describedBy}
          placeholder={placeholder}
          onPick={(option) =>
            onChange(
              option.kind === "deal"
                ? { deal: { id: option.id, title: option.title }, contact: option.contact }
                : { deal: null, contact: option.contact },
            )
          }
        />
      )}
    </div>
  );
}

function TargetChip({
  icon,
  label,
  removeLabel,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  removeLabel: string | null;
  onRemove: () => void;
}) {
  return (
    <li className="flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface-hover pl-2.5 text-sm text-ink">
      {icon}
      <span className={cn("min-w-0 truncate", !removeLabel && "pr-2.5")}>{label}</span>
      {removeLabel && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      )}
    </li>
  );
}

/** The search box with its results right under it. */
export function TargetSearch({
  id,
  invalid,
  describedBy,
  placeholder,
  onPick,
}: {
  id: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder: string;
  onPick: (option: TargetOption) => void;
}) {
  const t = useTranslations("crmTasks.form");
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), 250);
  const search = useTargetSearch(debounced);
  const results = term.trim() && debounced === term.trim() ? (search.data ?? []) : [];
  const settled = term.trim() !== "" && debounced === term.trim() && !search.isFetching;

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        value={term}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          // Enter picks the first result instead of sending the form.
          if (event.key !== "Enter" || !term.trim()) return;
          event.preventDefault();
          if (results[0]) {
            onPick(results[0]);
            setTerm("");
          }
        }}
      />
      {results.length > 0 && (
        <ul className="flex flex-col rounded-xl border border-line bg-surface p-1">
          {results.map((option) => {
            const label = option.kind === "deal" ? option.title : contactName(option.contact);
            const detail =
              option.kind === "deal" && option.contact ? contactName(option.contact) : null;
            return (
              <li key={`${option.kind}:${option.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(option);
                    setTerm("");
                  }}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-sm text-ink outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9"
                >
                  {option.kind === "deal" ? (
                    <HandshakeIcon aria-hidden className="size-4 shrink-0 text-gold" />
                  ) : (
                    <ContactRoundIcon aria-hidden className="size-4 shrink-0 text-teal" />
                  )}
                  <span className="min-w-0 truncate">{label}</span>
                  {detail && <span className="min-w-0 truncate text-ink-muted">· {detail}</span>}
                  <span className="ml-auto shrink-0 text-xs text-ink-muted">
                    {t(option.kind === "deal" ? "kindDeal" : "kindContact")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {settled && results.length === 0 && (
        <p className="px-1 text-xs text-ink-muted">{t("targetNone")}</p>
      )}
    </div>
  );
}
