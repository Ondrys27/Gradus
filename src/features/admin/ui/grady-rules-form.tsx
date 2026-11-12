"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Switch } from "@/components/ui/switch";
import { PROACTIVE_SUGGESTION_TYPES, type ProactiveSuggestionType } from "@/features/grady/proactive";
import { RULES_TEST_MESSAGE_MAX, type RulesTestResult } from "@/features/grady/protocol";
import {
  GRADY_RULE_LIMITS,
  gradyRulesFormSchema,
  normalizeInstructions,
  OWNER_INSTRUCTIONS_MAX,
} from "@/features/grady/rules";
import { formatNumber, formatUsd } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { saveGradyRules, type RulesActionResult } from "../server/grady-rules-actions";

/** The rules as the page passes them: plain values, the numbers in the units of the form. */
export type GradyRulesValues = {
  suggestionTypes: Record<ProactiveSuggestionType, boolean>;
  questions: boolean;
  minGapHours: number;
  questionsPerWeek: number;
  suggestionFreshDays: number;
  pageSettleSeconds: number;
  instructions: string;
};

const NUMBERS = ["minGapHours", "questionsPerWeek", "suggestionFreshDays", "pageSettleSeconds"] as const;
type NumberField = (typeof NUMBERS)[number];
type Field = NumberField | "instructions";

type Change = { key: string; label: string; from: string; to: string };

const count = (value: number) => formatNumber(value, {}, ADMIN_FORMAT_SETTINGS);

/**
 * Administration → AI and Grady → Rules: a switch for every suggestion type
 * Grady may bring up on his own and for his questions, the numbers of the
 * timing, and the owner's instructions for the system prompt of the chat and
 * the summaries. Saving asks for confirmation with every change from → to.
 * "Try it" sends a message with the instructions as they stand in the field.
 * An admin sees the values only.
 */
export function GradyRulesForm({
  saved,
  fromDefaults,
  readOnly = false,
  canTest = false,
}: {
  saved: GradyRulesValues;
  /** Nothing in the database yet: the values shown are today's defaults. */
  fromDefaults: boolean;
  readOnly?: boolean;
  /** The owner may spend one model call on "Try it". */
  canTest?: boolean;
}) {
  const t = useTranslations("admin.ai.rules");
  const router = useRouter();
  const [types, setTypes] = useState(saved.suggestionTypes);
  const [questions, setQuestions] = useState(saved.questions);
  const [numbers, setNumbers] = useState<Record<NumberField, string>>({
    minGapHours: String(saved.minGapHours),
    questionsPerWeek: String(saved.questionsPerWeek),
    suggestionFreshDays: String(saved.suggestionFreshDays),
    pageSettleSeconds: String(saved.pageSettleSeconds),
  });
  const [instructions, setInstructions] = useState(saved.instructions);
  const [errors, setErrors] = useState<Field[]>([]);
  const [notice, setNotice] = useState<"saved" | "noChanges" | null>(null);
  const [problem, setProblem] = useState<Exclude<RulesActionResult, { ok: true }>["error"] | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const values = { suggestionTypes: types, questions, ...numbers, instructions };
  const parsed = gradyRulesFormSchema.safeParse(values);
  const onOff = (on: boolean) => (on ? t("on") : t("off"));

  const changes: Change[] = [];
  if (parsed.success) {
    const next = parsed.data;
    for (const type of PROACTIVE_SUGGESTION_TYPES) {
      if (next.suggestionTypes[type] !== saved.suggestionTypes[type]) {
        changes.push({
          key: type,
          label: t(`types.${type}.label`),
          from: onOff(saved.suggestionTypes[type]),
          to: onOff(next.suggestionTypes[type]),
        });
      }
    }
    if (next.questions !== saved.questions) {
      changes.push({
        key: "questions",
        label: t("questions.label"),
        from: onOff(saved.questions),
        to: onOff(next.questions),
      });
    }
    for (const field of NUMBERS) {
      if (next[field] !== saved[field]) {
        changes.push({
          key: field,
          label: t(`numbers.${field}.label`),
          from: count(saved[field]),
          to: count(next[field]),
        });
      }
    }
    if (next.instructions !== saved.instructions) {
      changes.push({
        key: "instructions",
        label: t("instructions.label"),
        from: t("instructions.length", { count: saved.instructions.length }),
        to: t("instructions.length", { count: next.instructions.length }),
      });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setProblem(null);
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((issue) => issue.path[0] as Field))]);
      return;
    }
    setErrors([]);
    if (changes.length === 0 && !fromDefaults) {
      setNotice("noChanges");
      return;
    }
    setConfirming(true);
  }

  function confirm() {
    startTransition(async () => {
      const result = await saveGradyRules(values).catch(
        (): RulesActionResult => ({ ok: false, error: "failed" }),
      );
      if (!result.ok) {
        setProblem(result.error);
        if (result.fields) setErrors(result.fields as Field[]);
        return;
      }
      setConfirming(false);
      setNotice("saved");
      router.refresh();
    });
  }

  const changed = () => setNotice(null);
  const error = (field: Field) =>
    errors.includes(field)
      ? field === "instructions"
        ? t("errors.instructions", { max: count(OWNER_INSTRUCTIONS_MAX) })
        : t("errors.number", {
            min: count(GRADY_RULE_LIMITS[field].min),
            max: count(GRADY_RULE_LIMITS[field].max),
          })
      : undefined;
  const length = normalizeInstructions(instructions).length;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="grady-rules-form">
      {fromDefaults && <p className="text-xs text-ink-muted">{t("defaults")}</p>}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-ink">{t("typesTitle")}</legend>
        <p className="text-xs text-ink-muted">{t("typesHint")}</p>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {PROACTIVE_SUGGESTION_TYPES.map((type) => (
            <SwitchRow
              key={type}
              id={`rules-type-${type}`}
              label={t(`types.${type}.label`)}
              description={t(`types.${type}.description`)}
              checked={types[type]}
              disabled={readOnly}
              onChange={(checked) => {
                setTypes((current) => ({ ...current, [type]: checked }));
                changed();
              }}
            />
          ))}
          <SwitchRow
            id="rules-questions"
            label={t("questions.label")}
            description={t("questions.description")}
            checked={questions}
            disabled={readOnly}
            onChange={(checked) => {
              setQuestions(checked);
              changed();
            }}
          />
        </ul>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-ink">{t("numbersTitle")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NUMBERS.map((field) => (
            <FormField
              key={field}
              id={`rules-${field}`}
              label={t(`numbers.${field}.label`)}
              error={error(field)}
              hint={t(`numbers.${field}.hint`, {
                min: count(GRADY_RULE_LIMITS[field].min),
                max: count(GRADY_RULE_LIMITS[field].max),
              })}
            >
              <Input
                {...fieldA11y(`rules-${field}`, error(field), true)}
                inputMode="numeric"
                autoComplete="off"
                readOnly={readOnly}
                value={numbers[field]}
                onChange={(event) => {
                  const value = event.target.value;
                  setNumbers((current) => ({ ...current, [field]: value }));
                  changed();
                }}
              />
            </FormField>
          ))}
        </div>
      </fieldset>

      <FormField
        id="rules-instructions"
        label={t("instructions.label")}
        error={error("instructions")}
        hint={t("instructions.hint")}
        aside={
          <span
            className={
              length > OWNER_INSTRUCTIONS_MAX
                ? "text-xs text-pink tabular-nums"
                : "text-xs text-ink-muted tabular-nums"
            }
          >
            {t("instructions.counter", {
              used: count(length),
              max: count(OWNER_INSTRUCTIONS_MAX),
            })}
          </span>
        }
      >
        <Textarea
          {...fieldA11y("rules-instructions", error("instructions"), true)}
          rows={8}
          readOnly={readOnly}
          placeholder={t("instructions.placeholder")}
          value={instructions}
          onChange={(event) => {
            setInstructions(event.target.value);
            changed();
          }}
        />
      </FormField>

      {canTest && <RulesTest instructions={instructions} />}

      {notice && (
        <p role="status" className="text-sm text-ink-soft">
          {t(notice)}
        </p>
      )}
      {problem && !confirming && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      )}

      <ResponsiveDialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
        title={t("confirmTitle")}
        closeLabel={t("close")}
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-soft">{t("confirmDescription")}</p>
          {changes.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-sm" data-testid="grady-rules-changes">
              {changes.map((change) => (
                <li key={change.key} className="flex flex-wrap justify-between gap-2">
                  <span className="text-ink-soft">{change.label}</span>
                  <span className="font-semibold text-ink tabular-nums">
                    {change.from} → {change.to}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink">{t("confirmDefaults")}</p>
          )}
          {problem && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={confirm}>
              {t("confirm")}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </form>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-line bg-canvas-deep/40 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span id={`${id}-description`} className="text-xs text-ink-soft">
          {description}
        </span>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-description`}
        onCheckedChange={(value) => onChange(value)}
        className="mt-0.5"
      />
    </li>
  );
}

/**
 * "Try it": one message to Grady with the instructions as they stand in the
 * field, through /api/grady like every model call, and his answer.
 */
function RulesTest({ instructions }: { instructions: string }) {
  const t = useTranslations("admin.ai.rules.test");
  const tError = useTranslations("grady.error");
  const [message, setMessage] = useState(() => t("defaultMessage"));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RulesTestResult | null>(null);

  async function run() {
    if (!message.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/grady", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "rulesTest", instructions, message }),
      });
      const body = (await response.json().catch(() => null)) as RulesTestResult | null;
      setResult(
        body && typeof body.ok === "boolean"
          ? body
          : { ok: false, code: "unknown", durationMs: null },
      );
    } catch {
      setResult({ ok: false, code: "network", durationMs: null });
    } finally {
      setBusy(false);
    }
  }

  const seconds = (ms: number) => formatNumber(ms / 1000, { decimals: 1 }, ADMIN_FORMAT_SETTINGS);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line p-4" data-testid="grady-rules-test">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-ink">{t("title")}</p>
        <p className="text-xs text-ink-soft">{t("description")}</p>
      </div>
      <FormField id="rules-test-message" label={t("messageLabel")}>
        <Input
          id="rules-test-message"
          value={message}
          maxLength={RULES_TEST_MESSAGE_MAX}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (!busy) void run();
            }
          }}
        />
      </FormField>
      <Button
        type="button"
        variant="outline"
        onClick={() => void run()}
        disabled={busy || !message.trim()}
        className="self-start"
      >
        {busy ? (
          <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : (
          <SparklesIcon aria-hidden />
        )}
        {busy ? t("running") : t("run")}
      </Button>
      {!busy && result?.ok && (
        <FormAlert tone="success">
          <p className="whitespace-pre-wrap text-ink" data-testid="grady-rules-answer">
            {result.text}
          </p>
          <p className="text-ink-soft">
            {t("meta", {
              seconds: seconds(result.durationMs),
              cost: formatUsd(result.costUsd, ADMIN_FORMAT_SETTINGS),
              model: result.model,
            })}
          </p>
        </FormAlert>
      )}
      {!busy && result && !result.ok && (
        <FormAlert>
          <p className="font-medium">{t("failed")}</p>
          <p className="text-ink">
            {result.code === "invalid"
              ? t("invalid")
              : result.code === "limitReached"
                ? t("limitReached")
                : tError(result.code)}
          </p>
        </FormAlert>
      )}
    </div>
  );
}
