"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { contactLabel } from "./board-logic";
import { useContactSearch, useCreateContact } from "./queries";
import type { DealContact } from "./types";

type Props = {
  id: string;
  value: DealContact | null;
  onChange: (contact: DealContact | null) => void;
};

/** Finds an existing contact as you type, or creates one from the name typed in. */
export function ContactPicker({ id, value, onChange }: Props) {
  const t = useTranslations("pipeline.form");
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), 250);
  const search = useContactSearch(debounced);
  const create = useCreateContact();
  const [failed, setFailed] = useState(false);

  if (value) {
    return (
      <div className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface-hover px-3 py-1.5">
        <Avatar name={contactLabel(value)} className="size-7 text-xs" />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{contactLabel(value)}</span>
        <button
          type="button"
          aria-label={t("contactClear")}
          onClick={() => onChange(null)}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </div>
    );
  }

  const name = term.trim();
  const suggestions = name && debounced === name ? (search.data ?? []) : [];
  const exact = suggestions.some(
    (contact) => contactLabel(contact).toLowerCase() === name.toLowerCase(),
  );
  const settled = name !== "" && debounced === name && !search.isFetching;

  async function createFromName() {
    setFailed(false);
    try {
      onChange(await create.mutateAsync(name));
      setTerm("");
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        value={term}
        autoComplete="off"
        placeholder={t("contactPlaceholder")}
        onChange={(event) => setTerm(event.target.value)}
      />
      {name && (
        <ul
          aria-label={t("contactResults")}
          className="flex flex-col overflow-hidden rounded-xl border border-line"
        >
          {suggestions.map((contact) => (
            <li key={contact.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(contact);
                  setTerm("");
                }}
                className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 text-left text-sm text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover mouse:min-h-9"
              >
                <Avatar name={contactLabel(contact)} className="size-6 text-[10px]" />
                <span className="truncate">{contactLabel(contact)}</span>
              </button>
            </li>
          ))}
          {settled && !exact && (
            <li>
              <button
                type="button"
                disabled={create.isPending}
                onClick={() => void createFromName()}
                className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 text-left text-sm text-violet outline-none hover:bg-surface-hover focus-visible:bg-surface-hover disabled:opacity-50 mouse:min-h-9"
              >
                <PlusIcon aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{t("contactCreate", { name })}</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {failed && <p className="text-xs text-pink">{t("contactCreateFailed")}</p>}
    </div>
  );
}
