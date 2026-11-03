"use client";

import { useMemo, useState } from "react";
import { CrownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { cn } from "@/lib/utils";
import { managerChoices, OWNER_ROOT, type CompanyPerson } from "./tree";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: CompanyPerson[];
  /** The worker to move; kept while the dialog closes. */
  worker: CompanyPerson | null;
  ownerName: string;
  ownerAvatar: string | null;
  /** The new manager: a worker's id, or null for right under the owner. */
  onMove: (managerId: string | null) => void;
};

/** Indent per level in the picker; deep trees stay readable on a phone. */
const INDENT = 16;
const MAX_INDENT_LEVELS = 8;

/**
 * "Move under…": the same move as dragging, without a pointer. Every manager
 * the worker can go under, as an indented tree with the owner first; the
 * worker's own branch is never offered.
 */
export function MoveWorkerDialog({
  open,
  onOpenChange,
  people,
  worker,
  ownerName,
  ownerAvatar,
  onMove,
}: Props) {
  const t = useTranslations("workers.company.moveDialog");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={worker ? t("title", { name: worker.name }) : ""}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      {worker && (
        <Picker
          key={generation}
          people={people}
          worker={worker}
          ownerName={ownerName}
          ownerAvatar={ownerAvatar}
          onMove={(managerId) => {
            onMove(managerId);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      )}
    </ResponsiveDialog>
  );
}

function Picker({
  people,
  worker,
  ownerName,
  ownerAvatar,
  onMove,
  onCancel,
}: {
  people: CompanyPerson[];
  worker: CompanyPerson;
  ownerName: string;
  ownerAvatar: string | null;
  onMove: (managerId: string | null) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("workers.company.moveDialog");
  // Nobody goes under a person who left the company.
  const choices = useMemo(
    () =>
      managerChoices(people, worker.id).filter(
        (choice) => !choice.person || choice.person.status !== "inactive",
      ),
    [people, worker.id],
  );
  const current = worker.managerId ?? OWNER_ROOT;
  const [picked, setPicked] = useState<string>(current);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">{t("description")}</p>
      <div
        role="radiogroup"
        aria-label={t("title", { name: worker.name })}
        className="flex max-h-[50dvh] flex-col gap-0.5 overflow-y-auto rounded-2xl border border-line/70 p-1"
      >
        {choices.map((choice) => {
          const selected = picked === choice.id;
          const name = choice.person ? choice.person.name : t("owner");
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPicked(choice.id)}
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl pr-3 text-left text-[15px] text-ink-soft outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                selected && "bg-violet/15 text-ink",
              )}
              style={{
                paddingLeft: 8 + Math.min(choice.depth, MAX_INDENT_LEVELS) * INDENT,
              }}
            >
              {choice.person ? (
                <Avatar
                  src={choice.person.avatarUrl}
                  name={choice.person.name}
                  className="size-7 text-[11px]"
                />
              ) : (
                <Avatar src={ownerAvatar} name={ownerName} className="size-7 text-[11px]" />
              )}
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {!choice.person && <CrownIcon aria-hidden className="size-4 text-gold" />}
              {choice.id === current && (
                <span className="shrink-0 text-xs text-ink-muted">{t("current")}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          disabled={picked === current}
          onClick={() => onMove(picked === OWNER_ROOT ? null : picked)}
        >
          {t("confirm")}
        </Button>
      </div>
    </div>
  );
}
