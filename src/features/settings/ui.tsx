"use client";

import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SaveMark, useSettingsSaveMaybe } from "./save-state";

/**
 * The one look of every settings page: a title, one sentence on what it
 * sets, and a single column no wider than 560 px. Sections inside are
 * separated by a line, never by a card.
 */
export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink">{title}</h1>
        <p className="text-sm text-ink-soft">{description}</p>
      </header>
      {children}
    </div>
  );
}

/** A group of related choices: a 15 px title, an optional sentence, then rows. */
export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      tabIndex={id ? -1 : undefined}
      className={cn(
        "flex scroll-mt-24 flex-col gap-4 border-t border-line pt-6 outline-none first:border-t-0 first:pt-0",
        className,
      )}
    >
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="text-[15px] leading-5 font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="text-[13px] leading-5 text-ink-muted">{description}</p>}
      </header>
      <div className="flex flex-col divide-y divide-line/60">{children}</div>
    </section>
  );
}

type SettingRowProps = {
  /** The id of the control, so the label points at it and a deep link finds it. */
  id: string;
  label: string;
  /** Only where the label alone is not enough. */
  hint?: ReactNode;
  /** Columns of `user_settings` this row saves; shows "Saved" when they land. */
  fields?: readonly string[];
  /** An explicit save state for rows with their own mutation. */
  state?: "saving" | "saved" | "failed" | null;
  /** The control is a group (radios, several inputs), not one labelled element. */
  group?: boolean;
  /** `stack` puts the control under the label at every width (grids, inputs with text). */
  layout?: "inline" | "stack";
  children: ReactNode;
};

/**
 * One setting: label and hint on the left, the control on the right (under
 * it on a phone). The row carries `data-setting-row` so a deep link can
 * light up the whole row, not just the control.
 */
export function SettingRow({
  id,
  label,
  hint,
  fields,
  state,
  group,
  layout = "inline",
  children,
}: SettingRowProps) {
  const save = useSettingsSaveMaybe();
  const mark = state !== undefined ? state : fields && save ? save.stateOf(fields) : null;
  const labelClass = "text-sm font-medium text-ink";
  return (
    <div
      data-setting-row
      className={cn(
        "flex scroll-mt-24 flex-col gap-3 rounded-xl py-4 first:pt-0 last:pb-0",
        layout === "inline" && "md:flex-row md:items-center md:justify-between md:gap-6",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-3">
          {group ? (
            <span id={`${id}-label`} className={labelClass}>
              {label}
            </span>
          ) : (
            <label htmlFor={id} className={labelClass}>
              {label}
            </label>
          )}
          <SaveMark state={mark} />
        </span>
        {hint && <p className="text-[13px] leading-5 text-ink-muted">{hint}</p>}
      </div>
      <div className={cn("w-full min-w-0", layout === "inline" && "md:w-60 md:shrink-0")}>
        {children}
      </div>
    </div>
  );
}

/** Radio tiles in a grid; the same tile everywhere (language, mode, path, frequency). */
export function ChoiceGrid({
  id,
  label,
  columns = 2,
  className,
  children,
}: {
  id: string;
  label: string;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      tabIndex={-1}
      className={cn(
        "grid gap-2 rounded-xl outline-none",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-2 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ChoiceTile({
  checked,
  disabled,
  onSelect,
  icon,
  title,
  description,
  className,
  id,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon?: ReactNode;
  title: string;
  description?: string;
  className?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !checked && onSelect()}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        checked
          ? "border-violet/60 bg-violet/15 text-ink"
          : "border-line bg-canvas-deep/60 text-ink-soft hover:border-line-strong",
        className,
      )}
    >
      {icon && (
        <span className={cn("shrink-0", checked ? "text-violet" : "text-ink-muted")}>{icon}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        {description && <span className="text-xs text-ink-muted">{description}</span>}
      </span>
      {checked && <CheckIcon aria-hidden className="size-4 shrink-0 text-violet" />}
    </button>
  );
}

/** Actions that cannot be undone, at the end of a page, inside a red border. */
export function DangerZone({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-2xl border border-pink/40 bg-pink/5 p-4 md:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-[15px] leading-5 font-semibold text-pink">{title}</h2>
        {description && <p className="text-[13px] leading-5 text-ink-muted">{description}</p>}
      </header>
      <div className="flex flex-col divide-y divide-pink/20">{children}</div>
    </section>
  );
}

/** A row whose "control" is a button: export, sign out, delete. */
export function ActionRow({
  id,
  label,
  hint,
  action,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div
      data-setting-row
      className="flex scroll-mt-24 flex-col gap-3 rounded-xl py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-6"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-label`} className="text-sm font-medium text-ink">
          {label}
        </span>
        {hint && <p className="text-[13px] leading-5 text-ink-muted">{hint}</p>}
      </div>
      <div className="shrink-0 self-start md:self-auto">{action}</div>
    </div>
  );
}
