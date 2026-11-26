"use client";

import { useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toneFill, toneSoft } from "@/components/ui/tone";
import { useSession } from "@/features/account/queries";
import { useExchangeRates } from "@/features/currency/use-exchange-rates";
import { systemDefault } from "@/features/dashboard/widgets/defaults";
import {
  dashboardLayoutKeys,
  useDashboardDefaults,
  type StoredDefault,
} from "@/features/dashboard/widgets/layout-queries";
import { withPositions, type LayoutItem } from "@/features/widgets/grid";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { Json } from "@/types/database";
import { useAccessSentences } from "./access-text";
import { useCompanyGroups, useCompanyTree } from "./company/queries";
import { managerChoices, type CompanyGroup } from "./company/tree";
import { WidgetsChooser } from "./dashboard/widgets-chooser";
import {
  PERMISSION_TEMPLATES,
  templateGrants,
  templateOf,
  type PermissionGrants,
  type PermissionTemplate,
} from "./permissions-catalog";
import { PermissionsEditor } from "./permissions-editor";
import { definitionErrors, type SpaceRefs } from "./rewards/definition";
import { useCreatePlan } from "./rewards/queries";
import { RuleSentence } from "./rewards/rule-sentence";
import { REWARD_TEMPLATES, templateRules, type RewardTemplate } from "./rewards/rules";

/**
 * "What they'll be able to do" (30.2): everything a worker gets set before
 * the invite leaves, so they never see more than they should from the first
 * second after accepting — rights (sections, fine actions, connected apps),
 * widgets, manager, groups, an optional reward plan from a template and the
 * dashboard they start on. The same fields edit an invite that waits.
 */

/** The dashboard a worker starts on: as the company sets it, a copy of one, or the system's. */
export type DashboardChoice = "auto" | "keep" | "space" | "system" | `group:${string}`;

export type InviteAccess = {
  grants: PermissionGrants;
  /** null = every widget the rights give data to. */
  widgets: string[] | null;
  /** OWNER_ROOT = right under the owner. */
  managerId: string;
  groupIds: ReadonlySet<string>;
  /** A reward plan from this template, made with the invite; null = none. */
  reward: RewardTemplate | null;
  dashboard: DashboardChoice;
};

/** The reward plan a role starts with (the owner may pick another or none). */
export const ROLE_REWARD: Record<PermissionTemplate, RewardTemplate | null> = {
  sales: "salesCommission",
  coldCaller: "coldCaller",
  assistant: "assistant",
  accountant: null,
  all: null,
};

export function accessForRole(
  template: PermissionTemplate | null,
  base: Pick<InviteAccess, "managerId" | "groupIds">,
): InviteAccess {
  return {
    ...base,
    grants: template ? templateGrants(template) : { tasks: ["view"], company: ["view"], integrations: ["view", "mcp"] },
    widgets: null,
    reward: template ? ROLE_REWARD[template] : null,
    dashboard: "auto",
  };
}

// ---------------------------------------------------------------------------
// Step 1: the role
// ---------------------------------------------------------------------------

/** One click picks the rights of a role; "custom" starts from nothing but their tasks. */
export function RoleStep({
  value,
  onChoose,
}: {
  value: PermissionTemplate | "custom" | null;
  onChoose: (template: PermissionTemplate | "custom") => void;
}) {
  const t = useTranslations("workers.form.role");
  const tTemplates = useTranslations("workers.permissions.templates");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">{t("question")}</legend>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("question")}>
        {[...PERMISSION_TEMPLATES, "custom" as const].map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            data-testid={`invite-role-${option}`}
            onClick={() => onChoose(option)}
            className={cn(
              "flex min-h-14 cursor-pointer flex-col items-start gap-0.5 rounded-2xl border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
              value === option ? "border-violet/60 bg-violet/10" : "border-line hover:border-line-strong",
            )}
          >
            <span className="text-sm font-medium text-ink">{tTemplates(option)}</span>
            <span className="text-xs text-ink-muted">{t(`descriptions.${option}`)}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 2: what they'll be able to do
// ---------------------------------------------------------------------------

export function AccessFields({
  value,
  onChange,
  workerId = "",
  offerReward = true,
  canKeepDashboard = false,
}: {
  value: InviteAccess;
  onChange: (next: InviteAccess) => void;
  /** Editing this worker's invite: their own branch is no place for a manager. */
  workerId?: string;
  /** A plan from a template (only while the person has none). */
  offerReward?: boolean;
  /** The worker has a dashboard of their own already (editing an invite). */
  canKeepDashboard?: boolean;
}) {
  const t = useTranslations("workers.form.access");
  const set = <K extends keyof InviteAccess>(key: K, next: InviteAccess[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-col gap-5" data-testid="invite-access">
      <PermissionsEditor
        value={value.grants}
        onChange={(grants) => set("grants", grants)}
        hint={t("rightsHint")}
      />
      <Part title={t("widgetsTitle")} hint={t("widgetsHint")}>
        <WidgetsChooser grants={value.grants} value={value.widgets} onChange={(next) => set("widgets", next)} />
      </Part>
      <PlaceInCompany
        workerId={workerId}
        managerId={value.managerId}
        onManagerChange={(next) => set("managerId", next)}
        groupIds={value.groupIds}
        onGroupsChange={(next) => set("groupIds", next)}
      />
      <DashboardPick
        value={value.dashboard}
        groupIds={value.groupIds}
        canKeep={canKeepDashboard}
        onChange={(next) => set("dashboard", next)}
      />
      {offerReward && <RewardPick value={value.reward} onChange={(next) => set("reward", next)} />}
      <AccessPreview grants={value.grants} />
    </div>
  );
}

function Part({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** What the invite will say to the person, as they will read it. */
function AccessPreview({ grants }: { grants: PermissionGrants }) {
  const t = useTranslations("workers.form.access");
  const access = useAccessSentences(grants);
  return (
    <Part title={t("previewTitle")} hint={t("previewHint")}>
      <ul className="flex flex-col gap-1 text-sm text-ink-soft" data-testid="invite-access-preview">
        {access.lines.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <CheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal" />
            {line}
          </li>
        ))}
      </ul>
      {access.hidden && <p className="text-xs text-ink-muted">{access.hidden}</p>}
    </Part>
  );
}

/** A choice of a select, as the Select primitive takes it. */
type Option = { value: string; label: string };

function PickSelect({
  id,
  label,
  value,
  options,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-sm font-medium text-ink-soft">
        {label}
      </span>
      <Select
        value={value}
        items={options}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <SelectTrigger aria-labelledby={id} data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Where the worker goes: under whom, and into which groups. */
export function PlaceInCompany({
  workerId = "",
  managerId,
  onManagerChange,
  groupIds,
  onGroupsChange,
}: {
  workerId?: string;
  managerId: string;
  onManagerChange: (id: string) => void;
  groupIds: ReadonlySet<string>;
  onGroupsChange: (ids: ReadonlySet<string>) => void;
}) {
  const t = useTranslations("workers.company.invite");
  const people = useCompanyTree();
  const groups = useCompanyGroups();
  // Anyone but who left (and, editing, the worker's own branch) can be the manager.
  const managers = useMemo(
    () =>
      managerChoices(people.data ?? [], workerId)
        .filter((choice) => !choice.person || choice.person.status !== "inactive")
        .map((choice) => ({
          value: choice.id,
          label: choice.person
            ? `${" ".repeat(Math.max(choice.depth - 1, 0))}${choice.person.name}`
            : t("managerOwner"),
        })),
    [people.data, workerId, t],
  );

  function toggle(group: CompanyGroup) {
    const next = new Set(groupIds);
    if (!next.delete(group.id)) next.add(group.id);
    onGroupsChange(next);
  }

  if (managers.length <= 1 && (groups.data?.length ?? 0) === 0) return null;
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-4">
      {managers.length > 1 && (
        <PickSelect
          id="worker-manager-label"
          label={t("manager")}
          value={managerId}
          options={managers}
          onChange={onManagerChange}
          testId="worker-manager"
        />
      )}
      {(groups.data?.length ?? 0) > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-soft">{t("groups")}</legend>
          <div className="flex flex-wrap gap-2">
            {groups.data!.map((group) => {
              const selected = groupIds.has(group.id);
              return (
                <button
                  key={group.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(group)}
                  className={cn(
                    "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8",
                    selected ? toneSoft[group.color] : "border-line text-ink-soft hover:text-ink",
                  )}
                >
                  {selected ? (
                    <CheckIcon aria-hidden className="size-3.5" />
                  ) : (
                    <span aria-hidden className={cn("size-2 rounded-full", toneFill[group.color])} />
                  )}
                  {group.name}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink-muted">{t("groupsHint")}</p>
        </fieldset>
      )}
    </section>
  );
}

/** The dashboard they start on: the company's or a group's default, the plain one, or what is set already. */
function DashboardPick({
  value,
  groupIds,
  canKeep,
  onChange,
}: {
  value: DashboardChoice;
  groupIds: ReadonlySet<string>;
  canKeep: boolean;
  onChange: (next: DashboardChoice) => void;
}) {
  const t = useTranslations("workers.form.access.dashboard");
  const defaults = useDashboardDefaults(true);
  const groups = useCompanyGroups();
  const options = useMemo(() => {
    const stored = defaults.data ?? [];
    const names = new Map((groups.data ?? []).map((group) => [group.id, group.name]));
    const list: Option[] = [];
    if (canKeep) list.push({ value: "keep", label: t("keep") });
    // "As the company sets it" names what that is for the groups picked now.
    const group = stored.find((row) => row.target === "group" && row.groupId && groupIds.has(row.groupId));
    const space = stored.some((row) => row.target === "space");
    list.push({
      value: "auto",
      label: group
        ? t("autoGroup", { group: names.get(group.groupId!) ?? "" })
        : space
          ? t("autoSpace")
          : t("autoSystem"),
    });
    if (space) list.push({ value: "space", label: t("space") });
    for (const row of stored) {
      if (row.target === "group" && row.groupId && names.has(row.groupId)) {
        list.push({ value: `group:${row.groupId}`, label: t("group", { group: names.get(row.groupId)! }) });
      }
    }
    list.push({ value: "system", label: t("system") });
    return list;
  }, [defaults.data, groups.data, groupIds, canKeep, t]);
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <PickSelect
        id="worker-dashboard-label"
        label={t("label")}
        value={options.some((option) => option.value === value) ? value : "auto"}
        options={options}
        onChange={(next) => onChange(next as DashboardChoice)}
        testId="invite-dashboard"
      />
      <p className="text-xs text-ink-muted">{t("hint")}</p>
    </section>
  );
}

/** The owner's contact tables and stages, for the rules of a template (no worker exists yet). */
function useOwnRefs(enabled: boolean): SpaceRefs {
  const { user } = useSession();
  const query = useQuery({
    queryKey: ["workers", user.id, "invite-refs"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<SpaceRefs> => {
      const supabase = createClient();
      const [tables, stages] = await Promise.all([
        supabase.from("contact_tables").select("id, name, system_key").eq("user_id", user.id).limit(200),
        supabase
          .from("pipeline_stages")
          .select("id, name, system_key, is_won, is_lost")
          .eq("user_id", user.id)
          .limit(200),
      ]);
      if (tables.error) throw tables.error;
      if (stages.error) throw stages.error;
      return { tables: tables.data, stages: stages.data };
    },
  });
  return query.data ?? EMPTY_REFS;
}

const EMPTY_REFS: SpaceRefs = { tables: [], stages: [] };

/** An optional reward plan from a template; its rules as the person will read them. */
function RewardPick({
  value,
  onChange,
}: {
  value: RewardTemplate | null;
  onChange: (next: RewardTemplate | null) => void;
}) {
  const t = useTranslations("workers.form.access.reward");
  const tTemplates = useTranslations("workers.rewardPlan.templates");
  const settings = useFormatSettings();
  const rates = useExchangeRates();
  const refs = useOwnRefs(value !== null);
  const names = new Map([...refs.tables, ...refs.stages].map((item) => [item.id, item.name]));
  const rules = value ? templateRules(value, settings.currency, rates, refs) : [];
  const usable = rules.every((rule) => definitionErrors(rule).length === 0);
  const options: Option[] = [
    { value: "none", label: t("none") },
    ...REWARD_TEMPLATES.map((key) => ({ value: key, label: tTemplates(`${key}.name`) })),
  ];
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <PickSelect
        id="worker-reward-label"
        label={t("label")}
        value={value ?? "none"}
        options={options}
        onChange={(next) => onChange(next === "none" ? null : (next as RewardTemplate))}
        testId="invite-reward"
      />
      {value && usable && (
        <div className="flex flex-col gap-2" data-testid="invite-reward-rules">
          {rules.map((rule, index) => (
            <RuleSentence
              key={`${rule.event.key}-${index}`}
              definition={rule}
              currency={settings.currency}
              nameOf={(id) => names.get(id) ?? null}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-ink-muted">{value && !usable ? t("noRate") : t("hint")}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Saving what is not the rights
// ---------------------------------------------------------------------------

/** The items a dashboard choice copies for the worker; null = no row of their own. */
export function dashboardItems(
  choice: DashboardChoice,
  stored: readonly StoredDefault[],
): LayoutItem[] | null | "keep" {
  if (choice === "keep") return "keep";
  if (choice === "auto") return null;
  if (choice === "system") return systemDefault({ role: "worker", playing: false, industry: "other" });
  if (choice === "space") return stored.find((row) => row.target === "space")?.items ?? null;
  const groupId = choice.slice("group:".length);
  return stored.find((row) => row.target === "group" && row.groupId === groupId)?.items ?? null;
}

/**
 * Saves the widgets, the dashboard and the reward plan of an invite, with the
 * owner's own client (row level security: only their workers). Called while
 * the invite does not exist yet (a new worker) or still waits (editing), so
 * the person never starts on more than this.
 */
export function useSaveInviteExtras() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const settings = useFormatSettings();
  const rates = useExchangeRates();
  const defaults = useDashboardDefaults(true);
  const createPlan = useCreatePlan();

  return async (
    workerId: string,
    access: Pick<InviteAccess, "widgets" | "dashboard" | "reward">,
    options: { editing?: boolean } = {},
  ) => {
    const supabase = createClient();
    // Widgets: a list of their own, or none (= everything the rights allow).
    if (access.widgets !== null) {
      const { error } = await supabase
        .from("worker_dashboard_widgets")
        .upsert({ worker_id: workerId, owner_id: user.id, widgets: access.widgets });
      if (error) throw error;
    } else if (options.editing) {
      const { error } = await supabase
        .from("worker_dashboard_widgets")
        .delete()
        .eq("worker_id", workerId)
        .eq("owner_id", user.id);
      if (error) throw error;
    }

    // The dashboard: a copy for this person, or theirs removed so the company's applies.
    const items = dashboardItems(access.dashboard, defaults.data ?? []);
    if (items !== "keep") {
      const { error: clearError } = await supabase
        .from("dashboard_defaults")
        .delete()
        .eq("space_id", user.id)
        .eq("target", "worker")
        .eq("worker_id", workerId);
      if (clearError) throw clearError;
      if (items) {
        const { error } = await supabase.from("dashboard_defaults").insert({
          space_id: user.id,
          target: "worker",
          worker_id: workerId,
          items: withPositions(items) as unknown as Json,
        });
        if (error) throw error;
      }
    }

    // A reward plan from the template, with the company's tables named in its rules.
    if (access.reward) {
      const { data, error } = await supabase.rpc("reward_plan_refs", { _worker: workerId });
      if (error) throw error;
      const raw = (data ?? {}) as Partial<SpaceRefs>;
      const refs: SpaceRefs = { tables: raw.tables ?? [], stages: raw.stages ?? [] };
      const rules = templateRules(access.reward, settings.currency, rates, refs);
      if (rules.every((rule) => definitionErrors(rule).length === 0)) {
        await createPlan.mutateAsync({
          workerId,
          currency: settings.currency,
          template: access.reward,
          rules,
        });
      }
    }
    void queryClient.invalidateQueries({ queryKey: dashboardLayoutKeys.all(user.id) });
  };
}

/** The analytics of the step: which role, what was limited. */
export function accessProps(access: InviteAccess) {
  const dashboard: "auto" | "space" | "group" | "system" =
    access.dashboard === "keep" || access.dashboard === "auto"
      ? "auto"
      : access.dashboard.startsWith("group:")
        ? "group"
        : (access.dashboard as "space" | "system");
  return {
    template: templateOf(access.grants) ?? ("custom" as const),
    widgets_limited: access.widgets !== null,
    reward_template: access.reward ?? ("none" as const),
    dashboard,
  };
}
