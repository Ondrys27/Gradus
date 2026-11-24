/**
 * Measures the savings of step 28.9 that do not change a model, on the
 * samples in tests/fixtures/ai/ and the prompts in the code, and prints the
 * before / after of each with the saving in %:
 *
 *   1. the chat's context cut to the message (situation parts, plan catalog),
 *   2. the chat's conversation cached in the tools loop, by number of rounds,
 *   3. the output caps by job (the most one call may cost),
 *   4. the morning briefs and the opportunity watch through Message Batches.
 *
 *   bun scripts/ai-savings.ts          token counts estimated from the length (2.1 characters a token)
 *   bun scripts/ai-savings.ts --api    token counts from the free count_tokens endpoint (needs the key)
 *
 * Nothing is answered by a model and nothing is saved.
 */
import Anthropic from "@anthropic-ai/sdk";
import chatSamples from "../tests/fixtures/ai/chat.json";
import briefingSamples from "../tests/fixtures/ai/briefing.json";
import watchSamples from "../tests/fixtures/ai/opportunity_scan.json";
import { chatMessageCost, likelyToolUse, type ChatMessageShape } from "@/features/grady/cache";
import { chatTopics, plansCatalogNeeded, situationSections } from "@/features/grady/chat-context";
import { tokensOf } from "@/features/grady/compare/estimate";
import { costUsd, GRADY_MODELS, maxTokensFor, FEATURE_MAX_TOKENS, modelFor, type GradyFeature } from "@/features/grady/models";
import { describePlans, describePlansBrief } from "@/features/grady/plans-context";
import { GRADY_PERSONA, situationBlock } from "@/features/grady/prompt";
import { describeSituation, type UserSituation } from "@/features/grady/situation";
import { timeWindow } from "@/features/grady/time-window";
import { seedPlanCatalog } from "@/features/plan/catalog-seed";
import { DEFAULT_FORMAT_SETTINGS, zonedWallClockToInstant } from "@/lib/format";

const useApi = process.argv.includes("--api");
const anthropic = useApi ? new Anthropic() : null;
const SONNET = GRADY_MODELS.sonnet;

async function count(text: string): Promise<number> {
  if (!anthropic) return tokensOf(text.length);
  const result = await anthropic.messages.countTokens({
    model: SONNET,
    messages: [{ role: "user", content: text || " " }],
  });
  return result.input_tokens;
}

const pct = (before: number, after: number) =>
  before > 0 ? `${(((before - after) / before) * 100).toFixed(1)} %` : "–";
const usd = (value: number) => `${value.toFixed(5)} USD`;

// ---------------------------------------------------------------------------
// 1. The chat's context
// ---------------------------------------------------------------------------

const settings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Europe/Prague", currency: "CZK" };
const now = zonedWallClockToInstant("2026-11-24", "09:12", "Europe/Prague");
const at = (time: string) => zonedWallClockToInstant("2026-11-24", time, "Europe/Prague");

/** A busy owner's situation (anonymised), like the chat's samples. */
const situation: UserSituation = {
  today: "2026-11-24",
  now,
  window: timeWindow({ now, timeZone: "Europe/Prague", country: "CZ" }),
  todayStart: at("00:00"),
  milestones: [
    { title: "Prvních 10 klientů", done: 6, total: 9, targetDate: "2026-12-15" },
    { title: "Web a katalog", done: 2, total: 5, targetDate: null },
    { title: "Ceník a balíčky", done: 1, total: 4, targetDate: "2027-01-10" },
  ],
  milestonesTotal: 3,
  overdueTasks: [
    { title: "Poslat nabídku Kavárně U Mostu", dueDate: "2026-11-22" },
    { title: "Připravit ceník na rok 2027", dueDate: "2026-11-24" },
  ],
  overdueTotal: 2,
  stages: [
    { name: "Nový lead", open: 4, value: 86_000 },
    { name: "Schůzka", open: 2, value: 120_000 },
    { name: "Koncept nabídky", open: 1, value: 40_000 },
    { name: "Nabídka odeslána", open: 3, value: 210_000 },
  ],
  stalledDeals: 1,
  followUps: [
    { name: "Pekárna Zrno", dueAt: at("08:00") },
    { name: "Truhlářství Dvořák", dueAt: at("10:30") },
    { name: "Autoservis Král", dueAt: at("13:00") },
  ],
  followUpsTotal: 5,
  events: [
    { title: "Schůzka s Ateliérem Lípa", startsAt: at("14:00"), allDay: false },
    { title: "Focení produktů", startsAt: at("16:00"), allDay: false },
  ],
  prospectingSeconds: 1_800,
  finance: { income: 64_000, expense: 41_500 },
  overdueInvoices: [
    { number: "2026-0014", customer: "Kavárna U Mostu", total: 18_000, currency: "CZK", dueOn: "2026-11-12" },
  ],
  overdueInvoicesTotal: 1,
  overdueCrmTasks: [
    { title: "Zavolat paní Lípové", dueAt: at("09:00"), target: "Web Ateliér Lípa" },
  ],
  overdueCrmTasksTotal: 1,
  crmTasksDueToday: 2,
  pipelineHealth: null,
  cashPlan: null,
};

/** What people write to Grady, from the samples and the chips of the panel. */
const MESSAGES = [
  ...chatSamples.samples.map((sample) => sample.message),
  "Pošli mi seznam faktur po splatnosti.",
  "Které obchody nemají žádný úkol?",
  "Založ mi úkol zavolat paní Lípové zítra v 10.",
  "Kolik stojí tarif Team?",
  "Komu mám dnes zavolat?",
  "Jak napsat cold e-mail pro kavárny?",
];

async function contextSavings() {
  const own = "The user's own plan: Pro, monthly, active; next payment due 2026-12-12, charged to their card through Stripe.";
  const fullPlans = describePlans(seedPlanCatalog(), "cs", own);
  const fullSituation = situationBlock(describeSituation(situation, settings), "cs");
  const before = await count(`${fullSituation}\n${fullPlans}`);
  console.log("\n1. The chat's context cut to the message (situation + plans, uncached input on Sonnet)");
  console.log("   message | before | after | saving");
  let totalBefore = 0;
  let totalAfter = 0;
  for (const message of MESSAGES) {
    const topics = chatTopics([message]);
    const cut = situationBlock(describeSituation(situation, settings, situationSections(topics)), "cs");
    const plans = plansCatalogNeeded(topics, own) ? fullPlans : describePlansBrief(own);
    const after = await count(`${cut}\n${plans}`);
    totalBefore += before;
    totalAfter += after;
    console.log(`   ${JSON.stringify(message).slice(0, 48).padEnd(48)} | ${before} | ${after} | ${pct(before, after)}`);
  }
  console.log(
    `   all ${MESSAGES.length} messages: ${totalBefore} → ${totalAfter} tokens, ${pct(totalBefore, totalAfter)}; ` +
      `${usd(costUsd(SONNET, { inputTokens: totalBefore - totalAfter, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }) / MESSAGES.length)} a message on Sonnet`,
  );
  return { contextTokens: Math.round(totalAfter / MESSAGES.length) };
}

// ---------------------------------------------------------------------------
// 2. The conversation cached in the tools loop
// ---------------------------------------------------------------------------

async function cacheSavings(contextTokens: number) {
  const persona = await count(GRADY_PERSONA);
  // Tool definitions as in docs/funkce.md (about 8,000 tokens, by the user's rights).
  const tools = 8_000;
  // Notes, answers and a short history next to the situation: about 1,500 more.
  const shapeOf = (rounds: number): ChatMessageShape => ({
    model: SONNET,
    fixedTokens: persona + tools,
    contextTokens: contextTokens + 1_500,
    perRoundTokens: 900,
    rounds,
    outputTokens: 350,
  });
  const predicted = MESSAGES.filter(likelyToolUse);
  console.log("\n2. The chat's conversation cached in the tools loop (Sonnet, one message)");
  console.log(
    `   cached only for messages that ask for a tool: ${predicted.length} of ${MESSAGES.length} samples (${predicted.map((m) => JSON.stringify(m.slice(0, 30))).join(", ")})`,
  );
  console.log("   rounds | before | after | saving");
  for (const rounds of [1, 2, 3, 4]) {
    const shape = shapeOf(rounds);
    const before = chatMessageCost(shape, false);
    const after = chatMessageCost(shape, true);
    console.log(`   ${rounds} | ${usd(before)} | ${usd(after)} | ${pct(before, after)}`);
  }
}

// ---------------------------------------------------------------------------
// 3. The output caps
// ---------------------------------------------------------------------------

function capSavings() {
  console.log("\n3. Output caps by job: the most one runaway call may cost (default model)");
  console.log("   job | model | cap before → after | worst case before → after | saving");
  for (const feature of Object.keys(FEATURE_MAX_TOKENS) as GradyFeature[]) {
    if (feature === "chat_route") continue;
    const model = modelFor(feature);
    const modelCap = { haiku: 1024, sonnet: 4096, opus: 16000, fable: 16000 }[
      (Object.entries(GRADY_MODELS).find(([, id]) => id === model)?.[0] ?? "sonnet") as "sonnet"
    ];
    const after = maxTokensFor(feature, model);
    const price = (tokens: number) =>
      costUsd(model, { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: tokens });
    console.log(
      `   ${feature} | ${model} | ${modelCap} → ${after} | ${usd(price(modelCap))} → ${usd(price(after))} | ${pct(modelCap, after)}`,
    );
  }
  console.log("   A normal answer is far below every cap: it costs the same as before (0 %).");
}

// ---------------------------------------------------------------------------
// 4. Batches
// ---------------------------------------------------------------------------

async function batchSavings() {
  console.log("\n4. Background jobs through Message Batches (half price on every token)");
  console.log("   job | sample | direct | batch | saving");
  const jobs: [GradyFeature, { samples: { id: string; context: string; message: string }[] }, number][] = [
    ["briefing", briefingSamples, 200],
    ["opportunity_scan", watchSamples, 300],
  ];
  for (const [feature, file, output] of jobs) {
    for (const sample of file.samples) {
      const input = await count(`${sample.context}\n${sample.message}`);
      const tokens = { inputTokens: input, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: output };
      const direct = costUsd(modelFor(feature), tokens);
      const batch = costUsd(modelFor(feature), tokens, { batch: true });
      console.log(`   ${feature} | ${sample.id} | ${usd(direct)} | ${usd(batch)} | ${pct(direct, batch)}`);
    }
  }
  console.log("   A brief rewritten at the first arrival (facts changed) still pays the direct price.");
}

async function main() {
  console.log(`Token counts: ${useApi ? "count_tokens API (Sonnet 5.5)" : "estimated, 2.1 characters a token"}`);
  const { contextTokens } = await contextSavings();
  await cacheSavings(contextTokens);
  capSavings();
  await batchSavings();
}

await main();
