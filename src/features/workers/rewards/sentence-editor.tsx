"use client";

import { useState, type ReactNode } from "react";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAmountText } from "./amount-text";
import {
  CONTACT_REQUIRES,
  EVENT_CATALOG,
  eventMessageKey,
  eventsByGroup,
  TASK_KINDS,
  type RewardEvent,
  type RewardType,
} from "./catalog";
import {
  definitionErrors,
  newDefinition,
  normalizeDefinition,
  onceOf,
  whoOf,
  type RuleDefinition,
  type RuleReward,
  type SpaceRefs,
} from "./definition";
import { useSentence, type NameOf, type PartKey } from "./rule-sentence";

/**
 * A rule as a sentence whose parts are buttons (29.1): "When [the worker]
 * [moves a contact] [from anywhere] [into Meeting scheduled], they get
 * [500 Kč], [only the first time per contact], [at most 20 000 Kč a month]."
 * A click opens that part's choice right under the sentence (no popover in
 * a dialog, the same on a phone); conditions that are not set are added
 * with the buttons below it.
 */
export function SentenceEditor({
  value,
  onChange,
  currency,
  refs,
  testId = "reward-sentence",
}: {
  value: RuleDefinition;
  onChange: (next: RuleDefinition) => void;
  currency: string;
  refs: SpaceRefs;
  testId?: string;
}) {
  const t = useTranslations("workers.rewardPlan.editor");
  const te = useTranslations("workers.rewardPlan.errors");
  const sentence = useSentence();
  const [open, setOpen] = useState<PartKey | null>(null);
  const names = new Map([...refs.tables, ...refs.stages].map((item) => [item.id, item.name]));
  const nameOf: NameOf = (id) => names.get(id) ?? null;
  const pieces = sentence(value, currency, nameOf, "edit");
  const spec = EVENT_CATALOG[value.event.key];
  const errors = definitionErrors(value);
  const set = (next: RuleDefinition) => onChange(normalizeDefinition(next));

  const extras: Array<{ key: PartKey; add: () => void }> = [];
  if (spec.value && !value.conditions.value) {
    extras.push({ key: "value", add: () => set({ ...value, conditions: { ...value.conditions, value: { min: 0 } } }) });
  }
  if (spec.tags && !value.conditions.tags?.length) {
    extras.push({ key: "tags", add: () => onChange({ ...value, conditions: { ...value.conditions, tags: [""] } }) });
  }
  if (!value.conditions.window) {
    extras.push({ key: "window", add: () => onChange({ ...value, conditions: { ...value.conditions, window: {} } }) });
  }

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <p className="text-[15px] leading-8 text-ink">
        {pieces.map((piece, index) =>
          piece.part ? (
            <button
              key={`${piece.part}-${index}`}
              type="button"
              aria-expanded={open === piece.part}
              data-testid={`reward-part-${piece.part}`}
              onClick={() => setOpen((current) => (current === piece.part ? null : piece.part!))}
              className={cn(
                "mx-0.5 inline cursor-pointer rounded-md border-b-2 px-1.5 py-0.5 font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                open === piece.part
                  ? "border-violet bg-violet/20 text-ink"
                  : "border-violet/40 bg-violet/10 text-violet hover:bg-violet/15",
              )}
            >
              {piece.text}
            </button>
          ) : (
            <span key={`t-${index}`}>{piece.text}</span>
          ),
        )}
      </p>

      {extras.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {extras.map((extra) => (
            <Button
              key={extra.key}
              type="button"
              size="sm"
              variant="ghost"
              data-testid={`reward-add-${extra.key}`}
              onClick={() => {
                extra.add();
                setOpen(extra.key);
              }}
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t(`add.${extra.key}`)}
            </Button>
          ))}
        </div>
      )}

      {open && (
        <div className="rounded-2xl border border-line bg-surface-hover/40 p-3" data-testid={`reward-panel-${open}`}>
          <PartPanel
            key={`${open}-${value.event.key}`}
            part={open}
            value={value}
            set={set}
            raw={onChange}
            refs={refs}
            currency={currency}
            close={() => setOpen(null)}
          />
        </div>
      )}

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-pink" data-testid="reward-sentence-errors">
          {errors.map((error) => (
            <li key={error}>{te(error)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Choice<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onPick: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-testid={`reward-choice-${option.value}`}
          onClick={() => onPick(option.value)}
          className={cn(
            "min-h-11 cursor-pointer rounded-xl border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
            value === option.value
              ? "border-violet/60 bg-violet/15 text-ink"
              : "border-line text-ink-soft hover:border-line-strong",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Checks({
  items,
  checked,
  onChange,
  label,
}: {
  items: ReadonlyArray<{ id: string; label: string }>;
  checked: readonly string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">{label}</legend>
      {items.map((item) => (
        <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink mouse:min-h-9">
          <Checkbox
            checked={checked.includes(item.id)}
            data-testid={`reward-check-${item.label}`}
            onCheckedChange={(on) =>
              onChange(on ? [...checked, item.id] : checked.filter((id) => id !== item.id))
            }
          />
          {item.label}
        </label>
      ))}
    </fieldset>
  );
}

/** An amount typed in the user's format; an empty field is `null`, a wrong one NaN (shown as an error). */
function AmountField({
  label,
  value,
  onValue,
  testId,
}: {
  label: string;
  value: number | null | undefined;
  onValue: (value: number | null) => void;
  testId: string;
}) {
  const amountText = useAmountText();
  const [text, setText] = useState(amountText.show(value));
  return (
    <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
      {label}
      <Input
        value={text}
        inputMode="decimal"
        autoComplete="off"
        data-testid={testId}
        className="w-40"
        onChange={(event) => {
          setText(event.target.value);
          onValue(amountText.parse(event.target.value));
        }}
      />
    </label>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3">{children}</div>;
}

function PartPanel({
  part,
  value,
  set,
  raw,
  refs,
  currency,
  close,
}: {
  part: PartKey;
  value: RuleDefinition;
  set: (next: RuleDefinition) => void;
  raw: (next: RuleDefinition) => void;
  refs: SpaceRefs;
  currency: string;
  close: () => void;
}) {
  const t = useTranslations("workers.rewardPlan.editor");
  const ts = useTranslations("workers.rewardPlan.sentence");
  const spec = EVENT_CATALOG[value.event.key];
  const event = value.event;
  const items = (spec.move === "stages" ? refs.stages : refs.tables).map((item) => ({ id: item.id, label: item.name }));
  const removeButton = (onRemove: () => void) => (
    <Button type="button" size="sm" variant="ghost" onClick={() => { onRemove(); close(); }}>
      <MinusIcon aria-hidden data-icon="inline-start" />
      {t("remove")}
    </Button>
  );

  switch (part) {
    case "who":
      return (
        <Choice
          label={t("label.who")}
          value={whoOf(value)}
          options={spec.who.map((who) => ({ value: who, label: ts(`who.${who}`) }))}
          onPick={(who) => set({ ...value, conditions: { ...value.conditions, who } })}
        />
      );
    case "event":
      return (
        <div className="flex flex-col gap-3">
          {eventsByGroup().map(({ group, events }) => (
            <div key={group} className="flex flex-col gap-1.5">
              <span className="micro-label">{t(`group.${group}`)}</span>
              <Choice<RewardEvent>
                label={t(`group.${group}`)}
                value={event.key}
                options={events.map((key) => ({ value: key, label: t(`event.${eventMessageKey(key)}`) }))}
                onPick={(key) => {
                  if (key === event.key) return;
                  const amount = value.reward.type === "fixed" || value.reward.type === "unit" ? value.reward.amount : null;
                  const next = newDefinition(key, amount);
                  if (EVENT_CATALOG[key].cap && value.limits.cap !== undefined) next.limits.cap = value.limits.cap;
                  set(next);
                  close();
                }}
              />
            </div>
          ))}
        </div>
      );
    case "from": {
      const from = event.from ?? { mode: "any" as const, ids: [] };
      return (
        <div className="flex flex-col gap-3">
          <Choice
            label={t("label.from")}
            value={from.mode}
            options={(["any", "only", "except"] as const).map((mode) => ({ value: mode, label: t(`fromMode.${mode}`) }))}
            onPick={(mode) => raw({ ...value, event: { ...event, from: { mode, ids: mode === "any" ? [] : from.ids } } })}
          />
          {from.mode !== "any" && (
            <Checks
              label={t("label.from")}
              items={items}
              checked={from.ids}
              onChange={(ids) => raw({ ...value, event: { ...event, from: { mode: from.mode, ids } } })}
            />
          )}
        </div>
      );
    }
    case "to": {
      const to = event.to ?? { mode: "only" as const, ids: [] };
      return (
        <div className="flex flex-col gap-3">
          <Choice
            label={t("label.to")}
            value={to.mode}
            options={(["only", "any"] as const).map((mode) => ({ value: mode, label: t(`toMode.${mode}`) }))}
            onPick={(mode) => raw({ ...value, event: { ...event, to: { mode, ids: mode === "any" ? [] : to.ids } } })}
          />
          {to.mode === "only" && (
            <Checks
              label={t("label.to")}
              items={items}
              checked={to.ids}
              onChange={(ids) => raw({ ...value, event: { ...event, to: { mode: "only", ids } } })}
            />
          )}
        </div>
      );
    }
    case "via":
      return (
        <Checks
          label={t("label.via")}
          items={(spec.via ?? []).map((via) => ({ id: via, label: ts(`via.${via}`) }))}
          checked={event.via ?? []}
          onChange={(via) => raw({ ...value, event: { ...event, via: via as typeof event.via } })}
        />
      );
    case "taskKinds":
      return (
        <div className="flex flex-col gap-1">
          <Checks
            label={t("label.taskKinds")}
            items={TASK_KINDS.map((kind) => ({ id: kind, label: ts(`taskKind.${kind}`) }))}
            checked={event.taskKinds?.length ? event.taskKinds : [...TASK_KINDS]}
            onChange={(kinds) =>
              set({ ...value, event: { ...event, taskKinds: kinds.length ? (kinds as typeof event.taskKinds) : undefined } })
            }
          />
        </div>
      );
    case "onTime":
      return (
        <Choice
          label={t("label.onTime")}
          value={event.onTime ? "onTime" : "any"}
          options={(["any", "onTime"] as const).map((key) => ({ value: key, label: ts(`onTime.${key}`) }))}
          onPick={(key) => set({ ...value, event: { ...event, onTime: key === "onTime" } })}
        />
      );
    case "require":
      return (
        <Choice
          label={t("label.require")}
          value={event.require ?? "none"}
          options={CONTACT_REQUIRES.map((key) => ({ value: key, label: ts(`require.${key}`) }))}
          onPick={(require) => set({ ...value, event: { ...event, require } })}
        />
      );
    case "reward":
      return <RewardPanel value={value} raw={raw} currency={currency} />;
    case "once":
      return (
        <Choice
          label={t("label.once")}
          value={onceOf(value) ? "once" : "every"}
          options={[
            { value: "once", label: ts(`once.${spec.once ?? "contact"}`) },
            { value: "every", label: ts("once.every") },
          ]}
          onPick={(key) => set({ ...value, conditions: { ...value.conditions, once: key === "once" } })}
        />
      );
    case "undo":
      return (
        <Choice
          label={t("label.undo")}
          value={value.undo}
          options={(["cancel", "keep"] as const).map((key) => ({ value: key, label: ts(`undo.${key}`) }))}
          onPick={(undo) => set({ ...value, undo })}
        />
      );
    case "cap":
      return (
        <Row>
          <AmountField
            label={t("label.cap", { currency })}
            value={value.limits.cap ?? null}
            testId="reward-cap-input"
            onValue={(cap) => raw({ ...value, limits: { ...value.limits, cap: cap ?? undefined } })}
          />
          {value.limits.cap !== undefined && removeButton(() => set({ ...value, limits: { ...value.limits, cap: undefined } }))}
        </Row>
      );
    case "bonus":
      return <BonusPanel value={value} raw={raw} set={set} currency={currency} remove={removeButton} />;
    case "value":
      return (
        <Row>
          <AmountField
            label={t("label.valueMin", { currency })}
            value={value.conditions.value?.min ?? null}
            testId="reward-value-min"
            onValue={(min) => raw({ ...value, conditions: { ...value.conditions, value: { ...value.conditions.value, min: min ?? undefined } } })}
          />
          <AmountField
            label={t("label.valueMax", { currency })}
            value={value.conditions.value?.max ?? null}
            testId="reward-value-max"
            onValue={(max) => raw({ ...value, conditions: { ...value.conditions, value: { ...value.conditions.value, max: max ?? undefined } } })}
          />
          {removeButton(() => set({ ...value, conditions: { ...value.conditions, value: undefined } }))}
          <p className="w-full text-xs text-ink-muted">{t("valueHint")}</p>
        </Row>
      );
    case "tags":
      return (
        <Row>
          <label className="flex flex-1 flex-col gap-1.5 text-xs text-ink-muted">
            {t("label.tags")}
            <Input
              defaultValue={(value.conditions.tags ?? []).filter(Boolean).join(", ")}
              data-testid="reward-tags-input"
              onChange={(e) =>
                raw({
                  ...value,
                  conditions: {
                    ...value.conditions,
                    tags: e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                  },
                })
              }
            />
          </label>
          {removeButton(() => set({ ...value, conditions: { ...value.conditions, tags: undefined } }))}
        </Row>
      );
    case "window":
      return (
        <Row>
          <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
            {t("label.windowFrom")}
            <DatePicker
              id="reward-window-from"
              value={value.conditions.window?.from ?? null}
              onValueChange={(from) =>
                raw({ ...value, conditions: { ...value.conditions, window: { ...value.conditions.window, from: from ?? undefined } } })
              }
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
            {t("label.windowTo")}
            <DatePicker
              id="reward-window-to"
              value={value.conditions.window?.to ?? null}
              onValueChange={(to) =>
                raw({ ...value, conditions: { ...value.conditions, window: { ...value.conditions.window, to: to ?? undefined } } })
              }
            />
          </label>
          {removeButton(() => set({ ...value, conditions: { ...value.conditions, window: undefined } }))}
        </Row>
      );
  }
}

function RewardPanel({
  value,
  raw,
  currency,
}: {
  value: RuleDefinition;
  raw: (next: RuleDefinition) => void;
  currency: string;
}) {
  const t = useTranslations("workers.rewardPlan.editor");
  const spec = EVENT_CATALOG[value.event.key];
  const reward = value.reward;
  const amountOf = (item: RuleReward) =>
    item.type === "fixed" || item.type === "unit" ? item.amount : item.type === "tiers" ? (item.tiers[0]?.amount ?? 0) : 0;
  const switchTo = (type: RewardType) => {
    if (type === reward.type) return;
    const amount = amountOf(reward);
    const next: RuleReward =
      type === "percent"
        ? { type, percent: 5 }
        : type === "price"
          ? { type }
          : type === "tiers"
            ? { type, tiers: [{ from: 1, amount }, { from: 11, amount }] }
            : { type, amount };
    raw({ ...value, reward: next });
  };
  return (
    <div className="flex flex-col gap-3">
      {spec.rewards.length > 1 && (
        <Choice
          label={t("label.reward")}
          value={reward.type}
          options={spec.rewards.map((type) => ({ value: type, label: t(`rewardType.${type}`) }))}
          onPick={switchTo}
        />
      )}
      {(reward.type === "fixed" || reward.type === "unit") && (
        <AmountField
          key={reward.type}
          label={reward.type === "unit" ? t("label.perHour", { currency }) : t("label.amount", { currency })}
          value={reward.amount}
          testId="reward-amount-input"
          onValue={(amount) => raw({ ...value, reward: { type: reward.type, amount: amount ?? Number.NaN } })}
        />
      )}
      {reward.type === "percent" && (
        <AmountField
          label={t("label.percent")}
          value={reward.percent}
          testId="reward-percent-input"
          onValue={(percent) => raw({ ...value, reward: { type: "percent", percent: percent ?? Number.NaN } })}
        />
      )}
      {reward.type === "price" && <p className="text-xs text-ink-muted">{t("priceHint")}</p>}
      {reward.type === "tiers" && (
        <div className="flex flex-col gap-2">
          {reward.tiers.map((tier, index) => (
            <Row key={index}>
              <AmountField
                label={t("label.tierFrom")}
                value={tier.from}
                testId={`reward-tier-from-${index}`}
                onValue={(from) =>
                  raw({
                    ...value,
                    reward: {
                      type: "tiers",
                      tiers: reward.tiers.map((item, i) => (i === index ? { ...item, from: from ?? Number.NaN } : item)),
                    },
                  })
                }
              />
              <AmountField
                label={t("label.amount", { currency })}
                value={tier.amount}
                testId={`reward-tier-amount-${index}`}
                onValue={(amount) =>
                  raw({
                    ...value,
                    reward: {
                      type: "tiers",
                      tiers: reward.tiers.map((item, i) => (i === index ? { ...item, amount: amount ?? Number.NaN } : item)),
                    },
                  })
                }
              />
              {index > 1 && (
                <button
                  type="button"
                  aria-label={t("tierRemove")}
                  onClick={() => raw({ ...value, reward: { type: "tiers", tiers: reward.tiers.filter((_, i) => i !== index) } })}
                  className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9"
                >
                  <XIcon aria-hidden className="size-4" />
                </button>
              )}
            </Row>
          ))}
          {reward.tiers.length < 10 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => {
                const last = reward.tiers[reward.tiers.length - 1];
                raw({
                  ...value,
                  reward: {
                    type: "tiers",
                    tiers: [...reward.tiers, { from: (last?.from ?? 1) + 10, amount: last?.amount ?? 0 }],
                  },
                });
              }}
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("tierAdd")}
            </Button>
          )}
          <p className="text-xs text-ink-muted">{t("tiersHint")}</p>
        </div>
      )}
    </div>
  );
}

function BonusPanel({
  value,
  raw,
  set,
  currency,
  remove,
}: {
  value: RuleDefinition;
  raw: (next: RuleDefinition) => void;
  set: (next: RuleDefinition) => void;
  currency: string;
  remove: (onRemove: () => void) => ReactNode;
}) {
  const t = useTranslations("workers.rewardPlan.editor");
  const bonus = value.limits.bonus ?? { count: Number.NaN, amount: Number.NaN };
  const write = (next: { count: number; amount: number }) => raw({ ...value, limits: { ...value.limits, bonus: next } });
  return (
    <Row>
      <AmountField
        label={t("label.bonusCount")}
        value={value.limits.bonus?.count ?? null}
        testId="reward-bonus-count"
        onValue={(count) => write({ ...bonus, count: count ?? Number.NaN })}
      />
      <AmountField
        label={t("label.bonusAmount", { currency })}
        value={value.limits.bonus?.amount ?? null}
        testId="reward-bonus-amount"
        onValue={(amount) => write({ ...bonus, amount: amount ?? Number.NaN })}
      />
      {value.limits.bonus && remove(() => set({ ...value, limits: { ...value.limits, bonus: undefined } }))}
      <p className="w-full text-xs text-ink-muted">{t("bonusHint")}</p>
    </Row>
  );
}
