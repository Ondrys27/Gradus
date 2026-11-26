import { APP_NAME } from "@/lib/constants";
import { escapeHtmlText } from "@/lib/email/escape";
import { formatDate, formatNumber, formatUsd, type FormatSettings } from "@/lib/format";
import {
  attentionOf,
  hasNews,
  relativeChange,
  type Attention,
  type DayTrend,
  type DigestAudience,
  type DigestFacts,
} from "./facts";

/**
 * The e-mail "Gradus včera" (30.1) for one administrator: a short newsletter
 * of yesterday in their language. Sections without anything to say are left
 * out, so a calm day is a short "all is well" with the numbers. Who may not
 * see money gets no revenue, subscriptions or AI costs. Texts are
 * email.adminDigest.*; numbers only through format.ts.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type DigestEmail = { subject: string; text: string; html: string; calm: boolean };

type Section = { title: string; lines: string[] };

const K = "email.adminDigest";

function changeText(
  t: Translate,
  value: number,
  previous: number,
  versus: "dayBefore" | "weekAgo",
  settings: FormatSettings,
  format: (n: number) => string = (n) => formatNumber(n, {}, settings),
): string {
  const delta = value - previous;
  if (delta === 0) return t(`${K}.change.same.${versus}`);
  const ratio = relativeChange(value, previous);
  const signed = `${delta > 0 ? "+" : "−"}${format(Math.abs(delta))}`;
  return ratio === null
    ? t(`${K}.change.${versus}`, { change: signed })
    : t(`${K}.change.withPercent.${versus}`, {
        change: signed,
        percent: formatNumber(ratio, { style: "percent", signed: true }, settings),
      });
}

function trendLine(t: Translate, key: string, trend: DayTrend, settings: FormatSettings): string {
  return t(`${K}.people.${key}`, {
    count: formatNumber(trend.value, {}, settings),
    dayBefore: changeText(t, trend.value, trend.dayBefore, "dayBefore", settings),
    weekAgo: changeText(t, trend.value, trend.weekAgo, "weekAgo", settings),
  });
}

/** The one sentence on top, from attentionOf(). */
export function attentionText(attention: Attention, t: Translate, settings: FormatSettings): string {
  const n = (value: number) => formatNumber(value, {}, settings);
  switch (attention.kind) {
    case "health":
      return t(`${K}.attention.health`, { system: t(`${K}.health.items.${attention.key}`) });
    case "newErrors":
      return t(`${K}.attention.newErrors`, { count: attention.count, code: attention.code });
    case "cancelled":
      return t(`${K}.attention.cancelled`, { count: attention.count });
    case "signups":
    case "active":
      return t(`${K}.attention.${attention.kind}.${attention.value > attention.previous ? "up" : "down"}`, {
        value: n(attention.value),
        previous: n(attention.previous),
        versus: t(`${K}.attention.versus.${attention.versus}`),
      });
    case "aiCost":
      return t(`${K}.attention.aiCost.${attention.value > attention.previous ? "up" : "down"}`, {
        value: formatUsd(attention.value, settings),
        previous: formatUsd(attention.previous, settings),
      });
    case "reports":
      return t(`${K}.attention.reports`, { count: attention.count });
    case "calm":
      return t(`${K}.attention.calm`);
  }
}

function sections(facts: DigestFacts, audience: DigestAudience, t: Translate, settings: FormatSettings): Section[] {
  const n = (value: number) => formatNumber(value, {}, settings);
  const out: Section[] = [
    {
      title: t(`${K}.people.title`),
      lines: [
        trendLine(t, "newUsers", facts.newUsers, settings),
        trendLine(t, "activeUsers", facts.activeUsers, settings),
      ],
    },
  ];

  if (audience.money) {
    const money: string[] = [];
    if (facts.money.testMode) money.push(t(`${K}.money.testMode`));
    if (facts.money.revenue.length === 0) money.push(t(`${K}.money.noRevenue`));
    for (const row of facts.money.revenue) {
      const amount = (value: number) =>
        formatNumber(value, { style: "currency", currency: row.currency, decimals: 2 }, settings);
      money.push(
        t(`${K}.money.revenue`, {
          amount: amount(row.value),
          change: changeText(t, row.value, row.dayBefore, "dayBefore", settings, amount),
        }),
      );
    }
    money.push(t(`${K}.money.subscriptions`, { started: facts.money.started, cancelled: facts.money.cancelled }));
    money.push(
      t(`${K}.money.ai`, {
        amount: formatUsd(facts.ai.spentUsd, settings),
        change: changeText(t, facts.ai.spentUsd, facts.ai.dayBeforeUsd, "dayBefore", settings, (v) =>
          formatUsd(v, settings),
        ),
      }),
    );
    if (facts.ai.perActiveUsd !== null) {
      money.push(
        t(`${K}.money.aiPerActive`, {
          amount: formatUsd(facts.ai.perActiveUsd, settings),
          change:
            facts.ai.perActiveDayBeforeUsd === null
              ? t(`${K}.change.none`)
              : changeText(t, facts.ai.perActiveUsd, facts.ai.perActiveDayBeforeUsd, "dayBefore", settings, (v) =>
                  formatUsd(v, settings),
                ),
        }),
      );
    }
    out.push({ title: t(`${K}.money.title`), lines: money });
  }

  if (facts.errors.newGroups > 0 || facts.errors.resolved > 0) {
    out.push({
      title: t(`${K}.errors.title`),
      lines: [
        t(`${K}.errors.summary`, {
          fresh: facts.errors.newGroups,
          occurrences: n(facts.errors.occurrences),
          resolved: facts.errors.resolved,
        }),
        ...facts.errors.top.map((error) =>
          t(`${K}.errors.top`, { code: error.code, message: error.message, count: error.occurrences }),
        ),
      ],
    });
  }

  const { reports, ideas, survey } = facts.feedback;
  if (reports + ideas + survey > 0) {
    out.push({ title: t(`${K}.feedback.title`), lines: [t(`${K}.feedback.summary`, { reports, ideas, survey })] });
  }

  const waiting = [
    ["errors", facts.waiting.errors],
    ["reports", facts.waiting.reports],
    ...(audience.money
      ? ([
          ["payouts", facts.waiting.payouts],
          ["draft", facts.waiting.draft],
        ] as const)
      : []),
  ].filter(([, count]) => (count as number) > 0) as [string, number][];
  if (waiting.length) {
    out.push({
      title: t(`${K}.waiting.title`),
      lines: waiting.map(([key, count]) => t(`${K}.waiting.${key}`, { count })),
    });
  }

  if (facts.health.length) {
    out.push({
      title: t(`${K}.health.title`),
      lines: facts.health.map((item) =>
        t(`${K}.health.${item.status}`, { system: t(`${K}.health.items.${item.key}`) }),
      ),
    });
  }
  return out;
}

export function composeDigest(input: {
  facts: DigestFacts;
  audience: DigestAudience;
  t: Translate;
  settings: FormatSettings;
  adminUrl: string;
  settingsUrl: string;
}): DigestEmail {
  const { facts, audience, t, settings } = input;
  const attention = attentionOf(facts, audience);
  const calm = attention.kind === "calm" && !hasNews(facts, audience);
  const date = formatDate(new Date(`${facts.day}T12:00:00Z`), settings);
  const subject = t(calm ? `${K}.subjectCalm` : `${K}.subject`, { appName: APP_NAME, date });
  const lead = attentionText(attention, t, settings);
  const parts = sections(facts, audience, t, settings);
  const button = t(`${K}.open`);
  const footer = t(`${K}.footer`);

  const text = [
    t(`${K}.title`, { appName: APP_NAME, date }),
    "",
    `${t(`${K}.attention.label`)} ${lead}`,
    ...parts.flatMap((section) => ["", section.title, ...section.lines.map((line) => `· ${line}`)]),
    "",
    `${button}: ${input.adminUrl}`,
    "",
    `${footer} ${input.settingsUrl}`,
  ].join("\n");

  const e = escapeHtmlText;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a2e;max-width:560px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#646c90">${e(t(`${K}.title`, { appName: APP_NAME, date }))}</p>
<p style="margin:0 0 20px;font-size:17px;line-height:1.45;font-weight:600">${e(lead)}</p>
${parts
  .map(
    (section) => `<h2 style="margin:18px 0 6px;font-size:13px;color:#646c90">${e(section.title)}</h2>
<ul style="margin:0;padding:0 0 0 18px;font-size:15px;line-height:1.55">${section.lines.map((line) => `<li>${e(line)}</li>`).join("")}</ul>`,
  )
  .join("\n")}
<p style="margin:24px 0"><a href="${e(input.adminUrl)}" style="background:#7C5CFF;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">${e(button)}</a></p>
<p style="margin:0;font-size:12px;color:#646c90">${e(footer)} <a href="${e(input.settingsUrl)}" style="color:#646c90">${e(input.settingsUrl)}</a></p>
</div>`;

  return { subject, text, html, calm };
}
