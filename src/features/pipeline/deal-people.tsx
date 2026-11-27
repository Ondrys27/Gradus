"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { MemberAvatar } from "@/features/account/member-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useSession } from "@/features/account/queries";
import { useCan } from "@/features/account/workspace-queries";
import { useAssignees } from "@/features/crm-tasks/queries";
import { useAssigneeName } from "@/features/crm-tasks/use-assignee-name";
import { cn } from "@/lib/utils";
import { canSaveAssignees } from "./assignees";

/** At most this many faces in a row; the rest is "+N". */
const FACES = 3;

/** Overlapping faces of the people on a deal. */
export function PeopleFaces({
  ids,
  className,
  size = "size-5 text-[9px]",
}: {
  ids: readonly string[];
  className?: string;
  size?: string;
}) {
  const nameOf = useAssigneeName();
  const shown = ids.slice(0, FACES);
  const more = ids.length - shown.length;
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center -space-x-1.5", className)}>
      {shown.map((id) => (
        <MemberAvatar
          key={id}
          userId={id}
          name={nameOf(id)}
          className={cn(size, "ring-2 ring-surface")}
        />
      ))}
      {more > 0 && (
        <span
          className={cn(
            size,
            "grid place-items-center rounded-full border border-line-strong bg-surface-hover font-semibold text-ink-soft ring-2 ring-surface",
          )}
        >
          +{more}
        </span>
      )}
    </span>
  );
}

/** "Jana", "Jana, Petr", "Jana a 2 další". */
export function usePeopleLabel() {
  const t = useTranslations("pipeline.people");
  const nameOf = useAssigneeName();
  return (ids: readonly string[]) => {
    if (ids.length === 0) return t("nobody");
    if (ids.length <= 2) return ids.map(nameOf).join(", ");
    return t("andMore", { name: nameOf(ids[0]!), count: ids.length - 1 });
  };
}

/**
 * Everyone who works on a deal, all equal: the owner and the active workers
 * of the space, ticked in one list. Never empty; without "all deals" the
 * person stays on it themself (or it would leave their sight).
 */
export function DealPeopleSelect({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("pipeline.people");
  const { user } = useSession();
  const assignees = useAssignees();
  const nameOf = useAssigneeName();
  const label = usePeopleLabel();
  const viewAll = useCan("pipeline", "view_all");

  const items = useMemo(() => {
    const list = (assignees.data ?? []).map((person) => ({
      value: person.userId,
      label: nameOf(person.userId),
    }));
    // Whoever is on it stays listed, even after leaving the space.
    for (const person of value) {
      if (!list.some((item) => item.value === person)) {
        list.push({ value: person, label: nameOf(person) });
      }
    }
    return list;
  }, [assignees.data, nameOf, value]);

  const rules = { me: user.id, viewAll };
  /** The one ticked person can not be unticked; nor can a worker untick themself without "all deals". */
  const locked = (person: string) =>
    value.includes(person) && !canSaveAssignees(value.filter((other) => other !== person), rules);

  return (
    <Select
      multiple
      value={[...value]}
      items={items}
      disabled={disabled}
      onValueChange={(next) => {
        const ids = next as string[];
        if (canSaveAssignees(ids, rules)) onChange(ids);
      }}
    >
      <SelectTrigger
        id={id}
        data-tutorial="deal-people"
        aria-label={t("label", { people: label(value) })}
        className={cn("text-sm mouse:min-h-9", className)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <PeopleFaces ids={value} />
          <span className="truncate">{label(value)}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {items.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={locked(option.value)}>
            <span className="flex min-w-0 items-center gap-2">
              <MemberAvatar
                userId={option.value}
                name={option.label}
                className="size-5 text-[9px]"
              />
              <span className="truncate">{option.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
