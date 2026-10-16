"use client";

import {
  MessageSquareQuoteIcon,
  PackageIcon,
  PlusIcon,
  SquarePenIcon,
  SwordsIcon,
  TagIcon,
  Trash2Icon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { NOTE_TEMPLATE_KEYS, type NoteTemplateKey } from "./templates";

const TEMPLATE_ICONS: Record<NoteTemplateKey, LucideIcon> = {
  idealCustomer: UsersRoundIcon,
  offer: PackageIcon,
  pricing: TagIcon,
  competition: SwordsIcon,
  salesScript: MessageSquareQuoteIcon,
};

type Props = {
  readOnly: boolean;
  onTemplate: (key: NoteTemplateKey) => void;
  onBlank: () => void;
  onOpenTrash: () => void;
};

/** No notes yet: five prepared outlines, one tap each, or a blank page. */
export function NotesEmpty({ readOnly, onTemplate, onBlank, onOpenTrash }: Props) {
  const t = useTranslations("notes");
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4 md:py-10">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl font-semibold text-balance text-ink md:text-3xl">
          {t("empty.title")}
        </h2>
        <p className="max-w-xl text-base text-pretty text-ink-soft">{t("empty.text")}</p>
      </div>

      {!readOnly && (
        <ul className="flex flex-col divide-y divide-line/40" data-testid="note-templates">
          {NOTE_TEMPLATE_KEYS.map((key) => {
            const Icon = TEMPLATE_ICONS[key];
            const title = t(`templates.${key}.title`);
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onTemplate(key)}
                  aria-label={t("empty.useTemplate", { title })}
                  data-template={key}
                  className="group flex min-h-16 w-full items-center gap-4 rounded-xl px-2 py-3 text-left transition-colors hover:bg-surface/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Icon aria-hidden className="size-5 shrink-0 text-violet" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold text-ink">{title}</span>
                    <span className="text-sm text-pretty text-ink-muted">
                      {t(`templates.${key}.hint`)}
                    </span>
                  </span>
                  <PlusIcon
                    aria-hidden
                    className="size-5 shrink-0 text-ink-muted transition-colors group-hover:text-ink"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {!readOnly && (
          <button
            type="button"
            onClick={onBlank}
            className="flex min-h-11 items-center gap-2 font-semibold text-violet"
          >
            <SquarePenIcon className="size-4" />
            {t("empty.blank")}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenTrash}
          className="flex min-h-11 items-center gap-2 text-sm text-ink-muted hover:text-ink"
        >
          <Trash2Icon className="size-4" />
          {t("trash.open")}
        </button>
      </div>
    </section>
  );
}
