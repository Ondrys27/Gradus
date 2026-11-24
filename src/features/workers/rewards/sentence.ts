import {
  formatCalendarDate,
  formatList,
  formatNumber,
  formatOrList,
  formatPrice,
  type FormatSettings,
} from "@/lib/format";
import { EVENT_CATALOG, eventMessageKey } from "./catalog";
import { onceOf, whoOf, type RuleDefinition } from "./definition";

/**
 * A rule as a sentence of pieces (29.1), without React so the server says
 * it the same way (Grady's card before saving rules): "When [the worker]
 * [moves a contact] [from anywhere] [into Meeting scheduled], they get
 * [500 Kč], [only the first time per contact], [at most 20 000 Kč a month]."
 * Read mode leaves out what is not set; edit mode shows every part that can
 * be set. Texts under `workers.rewardPlan.sentence`.
 */

/** The parts of a sentence the owner clicks to change. */
export const PART_KEYS = [
  "who",
  "event",
  "taskKinds",
  "onTime",
  "require",
  "from",
  "to",
  "via",
  "reward",
  "once",
  "value",
  "tags",
  "window",
  "cap",
  "bonus",
  "undo",
] as const;
export type PartKey = (typeof PART_KEYS)[number];

export type SentencePiece = { text: string; part?: undefined } | { text: string; part: PartKey };

/** Names of the space's tables and stages by id (a rule keeps ids; a missing one shows as such). */
export type NameOf = (id: string) => string | null;

export type SentenceTranslate = (key: string, values?: Record<string, string | number>) => string;

export function buildSentence(
  definition: RuleDefinition,
  options: {
    t: SentenceTranslate;
    locale: string;
    settings: FormatSettings;
    currency: string;
    nameOf: NameOf;
    mode?: "read" | "edit";
  },
): SentencePiece[] {
  const { t, locale, settings, currency, nameOf } = options;
  const mode = options.mode ?? "read";
  const spec = EVENT_CATALOG[definition.event.key];
  const money = (value: number) => formatPrice(value, currency, settings);
  const percent = (value: number) =>
    formatNumber(value / 100, { style: "percent", decimals: Number.isInteger(value) ? 0 : 2 }, settings);
  const names = (ids: readonly string[]) =>
    formatOrList(
      ids.map((id) => nameOf(id) ?? t("missingName")),
      locale,
    );
  const pieces: SentencePiece[] = [];
  const text = (value: string) => pieces.push({ text: value });
  const part = (key: PartKey, value: string) => pieces.push({ part: key, text: value });
  const { event, conditions, reward, limits } = definition;

  if (event.key === "time.month") {
    part("event", t("everyMonth"));
    text(` ${t("gets")} `);
  } else {
    text(`${t("when")} `);
    part("who", t(`who.${whoOf(definition)}`));
    text(" ");
    part("event", t(`verb.${eventMessageKey(event.key)}`));
    if (spec.task) {
      text(" ");
      part(
        "taskKinds",
        event.taskKinds?.length
          ? formatOrList(event.taskKinds.map((kind) => t(`taskKind.${kind}`)), locale)
          : t("taskKind.all"),
      );
      text(" ");
      part("onTime", event.onTime ? t("onTime.onTime") : t("onTime.any"));
    }
    if (spec.require) {
      text(" ");
      part("require", t(`require.${event.require ?? "none"}`));
    }
    if (spec.move) {
      const from = event.from ?? { mode: "any", ids: [] };
      const to = event.to ?? { mode: "only", ids: [] };
      text(" ");
      part(
        "from",
        from.mode === "any"
          ? t("from.any")
          : t(`from.${from.mode}`, { names: from.ids.length ? names(from.ids) : t("nothingChosen") }),
      );
      text(" ");
      part("to", to.mode === "any" ? t("to.any") : t("to.only", { names: to.ids.length ? names(to.ids) : t("nothingChosen") }));
    }
    if (spec.via) {
      const via = event.via ?? [...spec.via];
      text(" ");
      part(
        "via",
        via.length === spec.via.length ? t("via.all") : formatOrList(via.map((item) => t(`via.${item}`)), locale),
      );
    }
    text(`, ${t("gets")} `);
  }

  switch (reward.type) {
    case "fixed":
      part("reward", money(reward.amount));
      break;
    case "unit":
      part("reward", t("reward.unit", { amount: money(reward.amount) }));
      break;
    case "percent":
      part("reward", t("reward.percent", { percent: percent(reward.percent) }));
      break;
    case "price":
      part("reward", t("reward.price"));
      break;
    case "tiers":
      part(
        "reward",
        formatList(
          reward.tiers.map((tier, index) => {
            const next = reward.tiers[index + 1];
            return next
              ? t("reward.tierRange", { amount: money(tier.amount), from: tier.from, to: next.from - 1 })
              : t("reward.tierFrom", { amount: money(tier.amount), from: tier.from });
          }),
          locale,
        ),
      );
      break;
  }

  if (spec.once) {
    const once = onceOf(definition);
    if (once || mode === "edit") {
      text(", ");
      part("once", once ? t(`once.${spec.once}`) : t("once.every"));
    }
  }
  if (conditions.value) {
    const { min, max } = conditions.value;
    text(", ");
    part(
      "value",
      min !== undefined && max !== undefined
        ? t("value.range", { min: money(min), max: money(max) })
        : min !== undefined
          ? t("value.min", { min: money(min) })
          : t("value.max", { max: money(max ?? 0) }),
    );
  }
  const tags = (conditions.tags ?? []).filter(Boolean);
  if (tags.length || (conditions.tags && mode === "edit")) {
    text(", ");
    part("tags", t("tags", { tags: tags.length ? formatOrList(tags, locale) : t("nothingChosen") }));
  }
  const window = conditions.window;
  if (window && (window.from || window.to || mode === "edit")) {
    const day = (value: string) => formatCalendarDate(value, settings);
    text(", ");
    part(
      "window",
      window.from && window.to
        ? t("window.range", { from: day(window.from), to: day(window.to) })
        : window.from
          ? t("window.from", { from: day(window.from) })
          : window.to
            ? t("window.to", { to: day(window.to) })
            : t("window.none"),
    );
  }
  if (spec.cap && (limits.cap !== undefined || mode === "edit")) {
    text(", ");
    part("cap", limits.cap !== undefined ? t("cap", { amount: money(limits.cap) }) : t("noCap"));
  }
  if (spec.counted && (limits.bonus || mode === "edit")) {
    text(", ");
    part(
      "bonus",
      limits.bonus
        ? t("bonus", { count: limits.bonus.count, amount: money(limits.bonus.amount) })
        : t("noBonus"),
    );
  }
  if (spec.undoable && mode === "edit") {
    text(", ");
    part("undo", t(`undo.${definition.undo}`));
  }
  text(".");
  return pieces;
}
