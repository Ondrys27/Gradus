"use client";

import { useId, useState } from "react";
import { ChevronDownIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  PERMISSION_CATALOG,
  PERMISSION_TEMPLATES,
  SCOPE_ACTION,
  actionsOf,
  grantAllows,
  seesSection,
  templateGrants,
  templateOf,
  toggleGrant,
  type CatalogSection,
  type GrantSection,
  type PermissionGrants,
  type PermissionTemplate,
} from "./permissions-catalog";

type Props = {
  value: PermissionGrants;
  /** `template` is set when one click of a template filled the rights. */
  onChange: (value: PermissionGrants, template?: PermissionTemplate) => void;
  disabled?: boolean;
  /** Shows the rights without switches that change them (the person's own view). */
  readOnly?: boolean;
  /** Shown under the title, e.g. that a change applies at once. */
  hint?: string;
};

/**
 * What a worker may do in the owner's space, section by section in the order
 * of the menu: "sees the section" and, unfolded, the finer rights of it. A
 * template fills everything in one click; any change after that reads as
 * custom. The worker's own dashboard and account are always theirs, the
 * owner's notes and settings never are.
 */
export function PermissionsEditor({ value, onChange, disabled, readOnly, hint }: Props) {
  const t = useTranslations("workers.permissions");
  const template = templateOf(value);
  const locked = disabled || readOnly;

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-ink">{t("title")}</legend>
      <p className="-mt-1 text-xs text-ink-muted">{hint ?? t("hint")}</p>

      {!readOnly && (
        <div role="radiogroup" aria-label={t("templates.label")} className="flex flex-wrap gap-1.5">
          {[...PERMISSION_TEMPLATES, "custom" as const].map((option) => {
            const selected = option === "custom" ? template === null : template === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`rights-template-${option}`}
                disabled={locked || (option === "custom" && !selected)}
                onClick={() => option !== "custom" && onChange(templateGrants(option), option)}
                className={cn(
                  "h-11 cursor-pointer rounded-full border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-default mouse:h-8",
                  selected
                    ? "border-violet/50 bg-violet/20 text-ink"
                    : "border-line text-ink-soft hover:text-ink disabled:opacity-50 disabled:hover:text-ink-soft",
                )}
              >
                {t(`templates.${option}`)}
              </button>
            );
          })}
        </div>
      )}

      <ul className="flex flex-col" data-testid="rights-sections">
        {PERMISSION_CATALOG.map((section) => (
          <SectionRow
            key={section.key}
            section={section}
            value={value}
            locked={Boolean(locked)}
            onChange={(next) => onChange(next)}
          />
        ))}
      </ul>
    </fieldset>
  );
}

function useSectionName() {
  const tNav = useTranslations("nav");
  const t = useTranslations("workers.permissions");
  return (section: CatalogSection) =>
    section.key === "invoices" ? t("sections.invoices") : tNav(section.nav);
}

function SectionRow({
  section,
  value,
  locked,
  onChange,
}: {
  section: CatalogSection;
  value: PermissionGrants;
  locked: boolean;
  onChange: (value: PermissionGrants) => void;
}) {
  const t = useTranslations("workers.permissions");
  const nameOf = useSectionName();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const name = nameOf(section);
  const rowClass = "border-t border-line py-2.5";

  if ("fixed" in section && section.fixed) {
    return (
      <li className={cn(rowClass, "flex min-h-11 items-center justify-between gap-3")}>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-ink">{name}</span>
          <span className="text-xs text-ink-muted">{t(`fixed.${section.key}`)}</span>
        </span>
        <span
          className="flex shrink-0 items-center gap-1 text-xs text-ink-muted"
          title={t(`fixed.${section.fixed}`)}
        >
          <LockIcon aria-hidden className="size-3.5" />
          {t(`fixed.${section.fixed}`)}
        </span>
      </li>
    );
  }

  const key = section.key as GrantSection;
  const sees = seesSection(value, key);
  const extra = actionsOf(key).filter((action) => action !== "view");
  const scoped = extra.includes(SCOPE_ACTION as never);
  const switches = extra.filter((action) => action !== SCOPE_ACTION);
  const granted = extra.filter((action) => grantAllows(value, key, action)).length;

  return (
    <li className={rowClass} data-rights-section={key}>
      <div className="flex min-h-11 items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? t("collapse", { section: name }) : t("expand", { section: name })}
          onClick={() => setOpen((current) => !current)}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-4 transition-transform motion-reduce:transition-none",
              !open && "-rotate-90",
            )}
          />
        </button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-ink">{name}</span>
          <span className="text-xs text-ink-muted">
            {sees ? t("granted", { count: granted, total: extra.length }) : t("hidden")}
          </span>
        </span>
        <Switch
          aria-label={t("viewSection", { section: name })}
          checked={sees}
          disabled={locked}
          onCheckedChange={(on) => onChange(toggleGrant(value, key, "view", on))}
        />
      </div>

      {open && (
        <div id={panelId} className="flex flex-col gap-1 pt-1 pb-1 pl-12">
          {scoped && (
            <ScopeChoice
              section={key}
              all={grantAllows(value, key, SCOPE_ACTION)}
              disabled={locked}
              onChange={(all) => onChange(toggleGrant(value, key, SCOPE_ACTION, all))}
            />
          )}
          {switches.map((action) => {
            const label = t(`actions.${key}.${action}`);
            return (
              <label
                key={action}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-ink-soft mouse:min-h-9"
              >
                <span>{label}</span>
                <Switch
                  aria-label={t("actionOf", { section: name, action: label })}
                  checked={grantAllows(value, key, action)}
                  disabled={locked}
                  onCheckedChange={(on) => onChange(toggleGrant(value, key, action, on))}
                />
              </label>
            );
          })}
        </div>
      )}
    </li>
  );
}

/** "All / only their own" (Company: the whole company / their branch). */
function ScopeChoice({
  section,
  all,
  disabled,
  onChange,
}: {
  section: GrantSection;
  all: boolean;
  disabled: boolean;
  onChange: (all: boolean) => void;
}) {
  const t = useTranslations("workers.permissions.scope");
  const kind = section === "company" ? "company" : "records";
  return (
    <div
      role="radiogroup"
      aria-label={t(`${kind}.label`)}
      className="my-1 flex w-fit rounded-full border border-line p-0.5"
    >
      {[true, false].map((option) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={all === option}
          disabled={disabled}
          onClick={() => all !== option && onChange(option)}
          className={cn(
            "min-h-11 cursor-pointer rounded-full px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-default mouse:min-h-8",
            all === option ? "bg-violet/20 text-ink" : "text-ink-soft hover:text-ink",
          )}
        >
          {t(`${kind}.${option ? "all" : "own"}`)}
        </button>
      ))}
    </div>
  );
}
