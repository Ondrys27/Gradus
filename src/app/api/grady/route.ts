import { after, NextResponse } from "next/server";
import { flushUserQuietly } from "@/features/calendar/sync/server/sync";
import { adminAccessFor, adminNotFound } from "@/features/admin/server/guard";
import { toModelMessages, type StoredMessage } from "@/features/grady/history";
import { costUsd, EMPTY_USAGE, modelFor, type GradyFeature } from "@/features/grady/models";
import {
  featureRequestNote,
  problemReportNote,
  GRADY_PERSONA,
  situationBlock,
  withOwnerInstructions,
} from "@/features/grady/prompt";
import { normalizeInstructions, OWNER_INSTRUCTIONS_MAX } from "@/features/grady/rules";
import {
  actionDecisionRequestSchema,
  chatRequestSchema,
  emailReplyRequestSchema,
  milestoneReviewRequestSchema,
  noteMapSuggestRequestSchema,
  pingRequestSchema,
  proactiveRequestSchema,
  rateMessageRequestSchema,
  modelCompareRequestSchema,
  rulesTestRequestSchema,
  salesAnalysisRequestSchema,
  type ModelCompareResult,
  type ChatErrorCode,
  type ChatEvent,
  type FileErrorCode,
  type GradyOverview,
  type PingResult,
  type RulesTestResult,
} from "@/features/grady/protocol";
import { describePlans, describePlansBrief } from "@/features/grady/plans-context";
import {
  chatTopics,
  plansCatalogNeeded,
  situationSections,
} from "@/features/grady/chat-context";
import { loadSubscriptionLine } from "@/features/grady/server/subscription";
import { describeSituation, suggestionsFor } from "@/features/grady/situation";
import type { SuggestionsResponse } from "@/features/grady/suggestions";
import {
  currentTurnAttachments,
  loadHistoryAttachments,
  prepareAttachments,
  recordAttachments,
} from "@/features/grady/server/attachments";
import { collectBriefBatches, runBriefings } from "@/features/grady/server/briefing";
import { suggestEmailReply } from "@/features/grady/server/email-reply";
import { linkOrigin, loadBookingLink } from "@/features/scheduler/server/link";
import { siteOrigin } from "@/lib/site-origin";
import { handleFeatureRequest } from "@/features/grady/server/feature-requests";
import { mightBeProblemReport } from "@/features/grady/problem-report";
import { loadSituation } from "@/features/grady/server/load-situation";
import { reviewMilestone } from "@/features/grady/server/milestone-review";
import { runRewardSetup } from "@/features/grady/server/reward-setup";
import type { SpaceRefs } from "@/features/workers/rewards/definition";
import { parseRule } from "@/features/workers/rewards/rules";
import { rewardSetupRequestSchema } from "@/features/workers/rewards/setup";
import { pickChatModel } from "@/features/grady/server/chat-route";
import { runCompareCell } from "@/features/grady/server/compare";
import { compareSample, isCompareFeature } from "@/features/grady/compare/samples";
import { allowedChoices } from "@/features/grady/model-settings";
import { aiModelByKey } from "@/features/grady/models";
import { logAdminAction } from "@/features/admin/server/audit";
import { createAnthropic, streamModel } from "@/features/grady/server/model";
import { loadMilestoneNotes, loadNotesContext } from "@/features/grady/server/notes";
import {
  E2E_ECHO_SUMMARY,
  E2E_TOOL_SCRIPT,
  e2eEchoClient,
  e2eToolClient,
  e2eToolScript,
  wantsE2eEcho,
} from "@/features/grady/server/e2e-model";
import type { ActionCard } from "@/features/grady/actions";
import { toolsFor } from "@/features/grady/tools/access";
import { GRADY_TOOLS } from "@/features/grady/tools/catalog";
import type { ToolContext } from "@/features/grady/tools/types";
import {
  actionsNote,
  confirmAction,
  loadActions,
  proposeBulk,
  rejectAction,
  runBundle,
  runToolCall,
  undoAction,
  type ActionEnv,
} from "@/features/grady/server/tools/actions";
import { createToolContext } from "@/features/grady/server/tools/context";
import { streamWithTools } from "@/features/grady/server/tools/loop";
import {
  loadAnswersBlock,
  loadProactive,
  loadSummary,
  reactToProactive,
} from "@/features/grady/server/proactive";
import { runNoteMapSuggest } from "@/features/grady/server/note-map-suggest";
import { loadMeetingContext, runMeetingNotes } from "@/features/grady/server/meeting-notes";
import {
  applyCalls,
  changeCount,
  meetingAnalyzeSchema,
  meetingApplyRequestSchema,
  type MeetingNotesResponse,
} from "@/features/meeting-notes/logic";
import { noteContentOf, noteKindOf } from "@/features/notes/mindmap/note-row";
import { isMapDoc } from "@/features/notes/mindmap/map-doc";
import { loadGradyRules } from "@/features/grady/server/rules";
import { maySeeDealAmounts, runSalesAnalysis } from "@/features/grady/server/sales-analysis";
import { refreshSuggestions } from "@/features/grady/server/suggestions";
import {
  limitReached,
  loadAiUsage,
  loadFileUsage,
  logAiUsage,
} from "@/features/grady/server/usage";
import { collectWatchBatches, runWatch } from "@/features/grady/server/watch";
import { sweepStaleStages } from "@/features/tutorial/showcase/server/stage";
import { getExchangeRates } from "@/features/currency/server/rates";
import { getPublishedPlans } from "@/features/plan/catalog-server";
import { loadWorkerBillingVisible } from "@/features/plan/worker-billing-server";
import { instrumentRoute, runCron } from "@/lib/analytics/instrument";
import { track, trackLater } from "@/lib/analytics/track";
import { todayIsoDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { isShowcaseStage, showcaseClient } from "@/features/grady/server/showcase-model";
import type { Locale } from "@/i18n/locales";
import { createClient } from "@/lib/supabase/server";
import { toFormatSettings, USER_SETTINGS_COLUMNS } from "@/lib/user-settings";

export const runtime = "nodejs";
/** The sales analysis on Opus and the batch watch need minutes; a chat answer far less. */
export const maxDuration = 300;

/** Messages of the conversation sent back to the model. */
const HISTORY_LIMIT = 20;
const TITLE_LENGTH = 80;
/** The watch stops taking new users this long before the function's limit. */
const WATCH_MARGIN_MS = 45_000;

const asLocale = (value: string): Locale => (value === "cs" ? "cs" : "en");

/** Jobs that would call a model; the showcase's stage gets none of them (27.4). */
const STAGE_REFUSED_JOBS: ReadonlySet<string> = new Set([
  "milestoneReview",
  "salesAnalysis",
  "noteMapSuggest",
  "rewardSetup",
  "emailReply",
  "ping",
  "rulesTest",
  "modelCompare",
  "proactive",
  "meetingNotes",
]);

/** The signed-in user, their settings and both clients. The admin client is filtered by this id. */
async function context() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: row, error } = await supabase
    .from("user_settings")
    .select(USER_SETTINGS_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  // The space the calls are made in: its owner pays for them (the AI cap of that space).
  const { data: space } = await supabase.rpc("current_workspace_id");
  const email = data.claims.email;
  return {
    supabase,
    admin: createAdminClient(),
    userId,
    spaceId: typeof space === "string" && space ? space : userId,
    email: typeof email === "string" ? email : null,
    // The showcase's stage (27.4) never reaches a model: prepared answers instead.
    stage: isShowcaseStage(data.claims.app_metadata),
    row,
    settings: toFormatSettings(row),
    locale: row?.locale ?? "en",
  };
}
type Context = NonNullable<Awaited<ReturnType<typeof context>>>;

/** The plan's AI calls are used up; recorded for "users at the AI limit". */
function limitHit(ctx: Context, feature: GradyFeature) {
  trackLater("jarvis_limit_reached", { feature }, { userId: ctx.userId, admin: ctx.admin });
}

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

const FILE_ERROR_STATUS: Record<FileErrorCode, number> = {
  fileType: 415,
  fileTooLarge: 413,
  fileUnreadable: 422,
  fileMissing: 400,
  fileLimit: 429,
};

/** Logs a call that could not start because the key is missing; every attempt is measured. */
async function logNotConfigured(ctx: Context, feature: GradyFeature) {
  await logAiUsage(ctx.admin, {
    userId: ctx.userId,
    spaceId: ctx.spaceId,
    conversationId: null,
    feature,
    model: modelFor(feature),
    tokens: EMPTY_USAGE,
    durationMs: 0,
    error: "ANTHROPIC_API_KEY is not set",
  });
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

/**
 * - `?task=watch`: the opportunity watch, run by Vercel Cron with CRON_SECRET.
 * - `?task=briefing`: the morning briefs (hourly, each user at 6 a.m. their time), Cron only.
 * - `?task=batches`: collects the ended Message Batches of the watch and the briefs (28.9), Cron only.
 * - `?view=suggestions`: the instant triggers, then the open suggestions.
 * - `?view=proactive`: what Grady would bring up on his own now between the summaries (a queue, most urgent first), or nothing.
 * - `?view=summary`: the summary at the first arrival of the day, week or month, or nothing.
 * - otherwise: calls and files left this month and the chips for the situation.
 */
// The call names in the analytics stay "api.jarvis.*": DB name kept from Jarvis.
export const GET = instrumentRoute("api.jarvis.get", async (request: Request) => {
  const params = new URL(request.url).searchParams;
  if (params.get("task") === "watch") return watch(request);
  if (params.get("task") === "briefing") return briefing(request);
  if (params.get("task") === "batches") return batches(request);

  const ctx = await context();
  if (!ctx) return unauthorized();

  if (params.get("view") === "suggestions") {
    const suggestions = await refreshSuggestions(ctx);
    const body: SuggestionsResponse = { suggestions };
    return NextResponse.json(body);
  }

  if (params.get("view") === "proactive") {
    const body = await loadProactive(ctx);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }

  if (params.get("view") === "summary") {
    // Written on the spot when today's brief is missing or no longer true (budget guard included).
    const client = ctx.stage
      ? showcaseClient(ctx.admin, asLocale(ctx.locale), "summary")
      : wantsE2eEcho(request.headers, ctx.email, E2E_ECHO_SUMMARY)
        ? e2eEchoClient(ctx.admin, E2E_ECHO_SUMMARY)
        : createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
    const body = await loadSummary({ ...ctx, client });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }

  const [usage, files, situation] = await Promise.all([
    loadAiUsage(ctx.supabase, ctx.admin, ctx.userId, ctx.settings, undefined, ctx.spaceId),
    loadFileUsage(ctx.supabase, ctx.admin, ctx.userId, ctx.settings, undefined, ctx.spaceId),
    loadSituation(
      ctx.supabase,
      ctx.settings,
      ctx.row?.country_code ?? null,
      new Date(),
      ctx.userId,
    ).catch((error) => {
      console.error("grady situation failed", error);
      return null;
    }),
  ]);
  const body: GradyOverview = {
    usage,
    files,
    suggestions: situation ? suggestionsFor(situation) : ["planDay"],
  };
  return NextResponse.json(body);
});

/**
 * The model client of a cron run, or null when there is no key or Grady is
 * paused (budget used up): the watch then runs on its rules only and no
 * morning brief is written.
 */
async function cronClient(admin: ReturnType<typeof createAdminClient>, feature: GradyFeature) {
  const client = createAnthropic(admin);
  return client && (await client.budget.check(feature)) === "ok" ? client : null;
}

/** The showcase stages still playing, after the stale ones are gone; an empty set when listing fails. */
async function liveStages(admin: ReturnType<typeof createAdminClient>) {
  try {
    return await sweepStaleStages(admin);
  } catch (error) {
    console.error("showcase stages could not be listed", error);
    return new Set<string>();
  }
}

function watch(request: Request) {
  return runCron("jarvis_watch", request, async () => {
    const started = Date.now();
    const admin = createAdminClient();
    const summary = await runWatch({
      client: await cronClient(admin, "opportunity_scan"),
      admin,
      skipUsers: await liveStages(admin),
      deadline: started + maxDuration * 1000 - WATCH_MARGIN_MS,
    });
    return { processed: summary.checked, body: { ...summary, ms: Date.now() - started } };
  });
}

function briefing(request: Request) {
  return runCron("jarvis_briefing", request, async () => {
    const started = Date.now();
    const admin = createAdminClient();
    const summary = await runBriefings({
      client: await cronClient(admin, "briefing"),
      admin,
      skipUsers: await liveStages(admin),
      deadline: started + maxDuration * 1000 - WATCH_MARGIN_MS,
    });
    return { processed: summary.written, body: { ...summary, ms: Date.now() - started } };
  });
}

/**
 * The answers of Grady's batches (step 28.9) that did not end during the run
 * that sent them: the watch's looks (sent at 10:00 UTC) and briefs whose
 * cancellation ended late. Nothing is sent here; without a key nothing runs.
 */
function batches(request: Request) {
  return runCron("jarvis_batches", request, async () => {
    const started = Date.now();
    const admin = createAdminClient();
    const client = createAnthropic(admin);
    if (!client) return { processed: 0, body: { skipped: "no key" } };
    const watch = await collectWatchBatches(client, admin);
    const briefs = await collectBriefBatches(client, admin);
    return {
      processed: watch.answered + briefs.written,
      body: { watch, briefs, ms: Date.now() - started },
    };
  });
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

/** The chat by default; `kind` picks another job. Every model call of the app goes through here. */
export const POST = instrumentRoute("api.jarvis.post", async (request: Request) => {
  const ctx = await context();
  if (!ctx) return unauthorized();
  // An event Grady made or changed reaches the person's Google or Apple calendar (28.10).
  after(() => flushUserQuietly(ctx.admin, ctx.userId));
  const body: unknown = await request.json().catch(() => null);
  const kind = (body as { kind?: unknown } | null)?.kind;
  // The showcase's stage (27.4) has prepared chat answers only; nothing else may reach a model.
  if (ctx.stage && STAGE_REFUSED_JOBS.has(String(kind))) {
    return NextResponse.json({ error: "paused" }, { status: 503 });
  }
  if (kind === "milestoneReview") return milestoneReview(ctx, body);
  if (kind === "salesAnalysis") return salesAnalysis(ctx, body);
  if (kind === "noteMapSuggest") return noteMapSuggest(ctx, body);
  if (kind === "rewardSetup") return rewardSetup(ctx, body);
  if (kind === "emailReply") return emailReply(ctx, body);
  if (kind === "ping") return ping(ctx, body);
  if (kind === "rulesTest") return rulesTest(ctx, body);
  if (kind === "modelCompare") return modelCompare(ctx, body);
  if (kind === "proactive") return proactive(ctx, body);
  if (kind === "rateMessage") return rateMessage(ctx, body);
  if (kind === "meetingNotes") return meetingNotes(ctx, body);
  if (kind === "meetingNotesApply") return meetingNotesApply(ctx, body);
  if (kind === "confirmAction" || kind === "rejectAction" || kind === "undoAction") {
    return actionDecision(ctx, body);
  }
  return chat(ctx, body, request);
});

/**
 * Thumb up/down on one of Grady's own answers; no model call. jarvis_messages
 * carries no client update policy, so this goes through the admin client,
 * checked against the session's own user id and the assistant role first.
 */
async function rateMessage(ctx: Context, body: unknown) {
  const parsed = rateMessageRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const { admin, userId } = ctx;
  const { data: message, error } = await admin
    .from("jarvis_messages")
    .select("id, role, rating")
    .eq("id", parsed.data.messageId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!message || message.role !== "assistant") return jobError("notFound", 404);

  // Sending the same rating again clears it.
  const next = message.rating === parsed.data.rating ? null : parsed.data.rating;
  const { error: updateError } = await admin
    .from("jarvis_messages")
    .update({ rating: next })
    .eq("id", parsed.data.messageId);
  if (updateError) throw updateError;
  if (next) await track("jarvis_message_rated", { rating: next }, { userId, admin });
  return NextResponse.json({ ok: true, rating: next });
}

/**
 * Confirm, Cancel or Undo on a card of Grady's change; no model call. The
 * action is looked up for the session's user only, in the active space, and
 * the tool runs again with the user's own client and current rights.
 */
async function actionDecision(ctx: Context, body: unknown) {
  const parsed = actionDecisionRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  // Grady's changes are labelled in the company's activity ("through Grady").
  const toolContext = await gradyToolContext(ctx);
  const env = { ctx: toolContext, admin: ctx.admin };
  const decide =
    parsed.data.kind === "confirmAction"
      ? confirmAction
      : parsed.data.kind === "rejectAction"
        ? rejectAction
        : undoAction;
  const result = await decide(env, parsed.data.id);
  const status = result.ok ? 200 : result.code === "notFound" ? 404 : 409;
  return NextResponse.json(result, { status });
}

/** The tool context of the active space, with Grady's label on its writes. */
async function gradyToolContext(ctx: Context) {
  return createToolContext({
    db: await createClient({ via: "grady" }),
    userId: ctx.userId,
    spaceId: ctx.spaceId,
    settings: ctx.settings,
    locale: ctx.locale,
    country: ctx.row?.country_code ?? null,
  });
}

/**
 * "Paste meeting notes" (28.7): Grady (meeting_notes, Sonnet by default)
 * reads the meeting and proposes changes. Nothing is saved: the proposal
 * goes back to the dialog, where the user ticks, edits and confirms it.
 */
async function meetingNotes(ctx: Context, body: unknown) {
  const parsed = meetingAnalyzeSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const { supabase, admin, userId, settings } = ctx;
  const toolContext = await gradyToolContext(ctx);
  const loaded = await loadMeetingContext(toolContext, parsed.data.target);
  if (!loaded) return jobError("notFound", 404);

  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "meeting_notes");
    return jobError("limitReached", 429);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "meeting_notes");
    return jobError("notConfigured", 503);
  }
  const result = await runMeetingNotes({
    client,
    ctx: toolContext,
    loaded,
    text: parsed.data.text,
    log: (entry) =>
      logAiUsage(admin, { ...entry, userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  if (!result.ok) {
    return jobError(result.code, result.code === "empty" ? 422 : result.code === "notFound" ? 404 : 502);
  }
  const { proposal } = result;
  await track(
    "meeting_notes_analyzed",
    {
      from: parsed.data.target.kind,
      parts: Math.min(proposal.parts, 20),
      tasks: proposal.tasks.length,
      contacts: proposal.contacts.length,
      stage: proposal.stageId !== null,
      deal_fields: Boolean(proposal.closeDate || proposal.amount),
      note: proposal.note !== null,
    },
    { userId, admin },
  );
  const response: MeetingNotesResponse = { ok: true, proposal };
  return NextResponse.json(response);
}

/**
 * The confirmed meeting notes: every change through Grady's tools with the
 * user's own client and current rights, recorded as one action with one
 * Undo; when a step fails, the steps before it are taken back. No model call.
 */
async function meetingNotesApply(ctx: Context, body: unknown) {
  const parsed = meetingApplyRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const { apply } = parsed.data;
  const toolContext = await gradyToolContext(ctx);
  const loaded = await loadMeetingContext(toolContext, apply.target);
  if (!loaded) return jobError("notFound", 404);
  // The changes go only where the meeting belongs.
  if ((loaded.deal?.id ?? null) !== apply.dealId || (loaded.contact?.id ?? null) !== apply.contactId) {
    return jobError("unknown", 400);
  }
  const calls = applyCalls(apply, { linkNote: loaded.rights.linkNote });
  if (!calls.length) return jobError("empty", 422);
  const result = await runBundle(
    { ctx: toolContext, admin: ctx.admin, conversationId: null, messageId: null },
    {
      tool: "meeting_notes",
      summary: toolContext.t("meeting_notes", { count: changeCount(apply) }),
      href: apply.dealId
        ? `/app/pipeline?deal=${apply.dealId}`
        : apply.contactId
          ? `/app/kontakty/${apply.contactId}`
          : null,
      calls,
    },
  );
  await track(
    "meeting_notes_applied",
    {
      from: apply.target.kind,
      changes: Math.min(changeCount(apply), 60),
      tasks: apply.tasks.length,
      contacts: apply.contacts.length,
      stage: apply.stageId !== null,
      transcript: apply.transcript !== null,
      ...(result.ok ? {} : { error_code: result.code }),
    },
    { userId: ctx.userId, admin: ctx.admin },
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, step: calls[result.index]?.name ?? null },
      { status: result.code === "readOnly" || result.code === "forbidden" ? 403 : 409 },
    );
  }
  return NextResponse.json({ ok: true, card: result.card });
}

/** What the user did with something Grady brought up on his own; no model call. */
async function proactive(ctx: Context, body: unknown) {
  const parsed = proactiveRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const result = await reactToProactive({ ...ctx, ...parsed.data });
  if (!result.ok)
    return jobError(
      result.code === "notFound" ? "notFound" : "unknown",
      result.code === "notFound" ? 404 : 400,
    );
  return NextResponse.json({ ok: true, created: result.created });
}

const PING_QUESTION =
  "This is a connection test from the administration. Reply with one short sentence.";

/**
 * Administration → AI and Grady → "Test the connection": one short question
 * on the chat's model through the same streaming call, with the time and
 * price it took. Only the owner with a live admin session and aal2 may spend
 * it; anyone else gets the same 404 as an unknown address. Nothing is saved
 * besides the ai_usage row every call writes.
 */
async function ping(ctx: Context, body: unknown) {
  if (!pingRequestSchema.safeParse(body).success) return jobError("unknown", 400);
  const access = await adminAccessFor("testGrady");
  if (!access || access.userId !== ctx.userId) return adminNotFound();
  const { supabase, admin, userId, settings } = ctx;
  const respond = (result: PingResult, status = 200) => NextResponse.json(result, { status });

  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "ping");
    return respond({ ok: false, code: "limitReached", durationMs: null, usage }, 429);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "ping");
    return respond({ ok: false, code: "notConfigured", durationMs: null }, 503);
  }

  const started = Date.now();
  const result = await streamModel({
    client,
    userId,
    feature: "ping",
    context: "",
    messages: [{ role: "user", content: PING_QUESTION }],
    log: (entry) =>
      logAiUsage(admin, { ...entry, userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  const durationMs = Date.now() - started;
  if (!result.ok) return respond({ ok: false, code: result.code, durationMs }, 502);
  return respond({
    ok: true,
    durationMs,
    costUsd: costUsd(result.model, result.tokens),
    model: result.model,
  });
}

/** What the rules' test says around the owner's message: there is no user data in it. */
const RULES_TEST_CONTEXT = situationBlock(
  "This is a test from the administration: the app's owner is trying the instructions. There is no user data in this conversation; answer as you would a user, and do not make up their data.",
  "the language of the message",
);

/**
 * Administration → AI and Grady → Rules → "Try it": the owner's message to
 * Grady's chat persona with the instructions as they stand in the form,
 * placed exactly as the chat places the saved ones (withOwnerInstructions),
 * and the answer back. Same gate as the connection test: only the owner
 * with a live admin session and aal2, anyone else the 404 of an unknown
 * address. One paid call, written to ai_usage as "rules_test" (its own model
 * in AI and Grady → Models, step 28.9); nothing else saved.
 */
async function rulesTest(ctx: Context, body: unknown) {
  const parsed = rulesTestRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const access = await adminAccessFor("testGrady");
  if (!access || access.userId !== ctx.userId) return adminNotFound();
  const { supabase, admin, userId, settings } = ctx;
  const respond = (result: RulesTestResult, status = 200) => NextResponse.json(result, { status });

  const instructions = normalizeInstructions(parsed.data.instructions);
  if (instructions.length > OWNER_INSTRUCTIONS_MAX) {
    return respond({ ok: false, code: "invalid", durationMs: null }, 400);
  }
  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "rules_test");
    return respond({ ok: false, code: "limitReached", durationMs: null }, 429);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "rules_test");
    return respond({ ok: false, code: "notConfigured", durationMs: null }, 503);
  }

  const started = Date.now();
  const result = await streamModel({
    client,
    userId,
    feature: "rules_test",
    instructions: withOwnerInstructions(GRADY_PERSONA, instructions),
    context: RULES_TEST_CONTEXT,
    messages: [{ role: "user", content: parsed.data.message }],
    log: (entry) =>
      logAiUsage(admin, { ...entry, userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  const durationMs = Date.now() - started;
  if (!result.ok) return respond({ ok: false, code: result.code, durationMs }, 502);
  return respond({
    ok: true,
    text: result.text,
    durationMs,
    costUsd: costUsd(result.model, result.tokens),
    model: result.model,
  });
}

/**
 * Administration → AI and Grady → Models → "Compare models" (step 28.9): one
 * sample of one job on one model the owner ticked, with its format checks
 * and the short grade, each cell its own request so the dialog fills in as
 * the answers come. The owner or a full admin with a live admin session and
 * aal2 (anyone else the 404 of an unknown address); the job, the sample and
 * the model come from the code's own lists, never from the request. The
 * plan's monthly answers are not used (the app's budget pays, and the guard
 * still checks it); both calls are in ai_usage as model_compare and
 * compare_judge, each run in admin_audit.
 */
async function modelCompare(ctx: Context, body: unknown) {
  const parsed = modelCompareRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const access = await adminAccessFor("compareModels");
  if (!access || access.userId !== ctx.userId) return adminNotFound();
  const respond = (result: ModelCompareResult, status = 200) =>
    NextResponse.json(result, { status });

  const { feature, sampleId, model } = parsed.data;
  if (!isCompareFeature(feature)) return respond({ ok: false, code: "invalid", durationMs: null }, 400);
  const sample = compareSample(feature, sampleId);
  const key = aiModelByKey(model)?.key;
  if (!sample || !key || !allowedChoices(feature).includes(key)) {
    return respond({ ok: false, code: "invalid", durationMs: null }, 400);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "model_compare");
    return respond({ ok: false, code: "notConfigured", durationMs: null }, 503);
  }
  await logAdminAction(access, "view", "ai.models.compare", { feature, sample: sampleId, model: key });
  const rules = await loadGradyRules(ctx.admin);
  const result = await runCompareCell({
    client,
    userId: ctx.userId,
    feature,
    sample,
    model: key,
    ownerInstructions: rules.instructions,
    locale: ctx.locale,
    log: (entry) =>
      logAiUsage(ctx.admin, { ...entry, userId: ctx.userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  if (!result.ok) {
    return respond(
      { ok: false, code: result.code, durationMs: result.durationMs, costUsd: result.costUsd },
      502,
    );
  }
  return respond({
    ok: true,
    text: result.text,
    model: result.model,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    outputTokens: result.tokens.outputTokens,
    checks: result.checks,
    judge: result.judge,
    judgeCostUsd: result.judgeCostUsd,
  });
}

function jobError(code: ChatErrorCode | "locked" | "alreadyReviewed" | "empty", status: number) {
  return NextResponse.json({ ok: false, code }, { status });
}

/** Sonnet reviews a milestone right after it is created; once per milestone. */
async function milestoneReview(ctx: Context, body: unknown) {
  const parsed = milestoneReviewRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const { supabase, admin, userId, settings, locale } = ctx;

  // Read with the user's own client: RLS keeps it to their milestones.
  const { data: milestone, error } = await supabase
    .from("milestones")
    .select("title, description, category, target_date, ai_feedback")
    .eq("id", parsed.data.milestoneId)
    .eq("user_id", ctx.spaceId)
    .maybeSingle();
  if (error) throw error;
  if (!milestone) return jobError("notFound", 404);
  if (milestone.ai_feedback) return jobError("alreadyReviewed", 409);

  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "milestone_review");
    return jobError("limitReached", 429);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "milestone_review");
    return jobError("notConfigured", 503);
  }

  // Notes tied to it (or its tasks) count for the review; the review goes on without them.
  const notes = await loadMilestoneNotes(supabase, parsed.data.milestoneId).catch((error) => {
    console.error("grady milestone notes failed", error);
    return "";
  });

  const result = await reviewMilestone({
    client,
    admin,
    userId,
    spaceId: ctx.spaceId,
    milestoneId: parsed.data.milestoneId,
    milestone,
    today: todayIsoDate(settings),
    locale,
    notes,
    log: (entry) =>
      logAiUsage(admin, { ...entry, userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  if (!result.ok) return jobError(result.code, 502);
  return NextResponse.json({ ok: true, feedback: result.text });
}

/** Opus analyses the meeting surveys; unlocked after five of them. */
async function salesAnalysis(ctx: Context, body: unknown) {
  if (!salesAnalysisRequestSchema.safeParse(body).success) return jobError("unknown", 400);
  const { supabase, admin, userId, settings, locale } = ctx;

  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "analysis");
    return jobError("limitReached", 429);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "analysis");
    return jobError("notConfigured", 503);
  }

  const result = await runSalesAnalysis({
    client,
    supabase,
    admin,
    userId,
    locale,
    seeAmounts: await maySeeDealAmounts(supabase, userId),
    log: (entry) =>
      logAiUsage(admin, { ...entry, userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  if (!result.ok) return jobError(result.code, result.code === "locked" ? 403 : 502);
  return NextResponse.json({ ok: true, analysis: result.analysis });
}

/**
 * Sonnet suggests branches under one node of the user's mind map note
 * ("fill in my competitors map"). The map is read here with the user's own
 * client, so RLS keeps it to notes the user reaches; the client saves its edits
 * first. Nothing is written: the branches go back to the map, grey, until
 * the user accepts or deletes them.
 */
async function noteMapSuggest(ctx: Context, body: unknown) {
  const parsed = noteMapSuggestRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const { supabase, admin, userId, settings, locale } = ctx;

  const { data: note, error } = await supabase
    .from("notes")
    .select("kind, content")
    .eq("id", parsed.data.noteId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  const kind = noteKindOf(note?.kind);
  const doc = note ? noteContentOf(kind, note.content) : null;
  if (!doc || !isMapDoc(doc)) return jobError("notFound", 404);

  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "note_map_suggest");
    return jobError("limitReached", 429);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "note_map_suggest");
    return jobError("notConfigured", 503);
  }

  const result = await runNoteMapSuggest({
    client,
    userId,
    doc,
    nodeId: parsed.data.nodeId,
    request: parsed.data.request ?? "",
    locale,
    log: (entry) =>
      logAiUsage(admin, { ...entry, userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  if (!result.ok) {
    return jobError(
      result.code,
      result.code === "notFound" ? 404 : result.code === "empty" ? 422 : 502,
    );
  }
  await track(
    "note_map_suggested",
    { branches: result.branches.length, with_request: Boolean(parsed.data.request?.trim()) },
    { userId, admin },
  );
  return NextResponse.json({ ok: true, branches: result.branches });
}

/**
 * "Describe how you reward" (29.1): Sonnet turns the owner's words into
 * rules of one person's reward plan, against the space's own tables and
 * stages and the person's existing rules (read with the user's client and
 * reward_can_manage, so only whoever manages the person's rewards gets
 * here). Nothing is written: the proposal goes back to the plan, where the
 * owner tries, changes and confirms each rule.
 */
async function rewardSetup(ctx: Context, body: unknown) {
  const parsed = rewardSetupRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const { supabase, admin, userId, settings, locale } = ctx;
  const { workerId, request } = parsed.data;

  const { data: manages, error: manageError } = await supabase.rpc("reward_can_manage", {
    _space: ctx.spaceId,
    _worker: workerId,
  });
  if (manageError) throw manageError;
  if (!manages) return jobError("notFound", 404);
  const [{ data: refsData, error: refsError }, { data: planRow, error: planError }] = await Promise.all([
    supabase.rpc("reward_plan_refs", { _worker: workerId }),
    supabase
      .from("reward_plans")
      .select("currency, rules:reward_plan_rules(id, plan_id, worker_id, kind, definition, active, position)")
      .eq("space_id", ctx.spaceId)
      .eq("worker_id", workerId)
      .maybeSingle(),
  ]);
  if (refsError) throw refsError;
  if (planError) throw planError;
  const refs = (refsData ?? {}) as Partial<SpaceRefs>;
  const rules = (planRow?.rules ?? []).flatMap((row) => {
    const rule = parseRule(row);
    return rule ? [{ id: rule.id, definition: rule.definition, active: rule.active }] : [];
  });

  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "reward_setup");
    return jobError("limitReached", 429);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "reward_setup");
    return jobError("notConfigured", 503);
  }
  const result = await runRewardSetup({
    client,
    userId,
    refs: { tables: refs.tables ?? [], stages: refs.stages ?? [] },
    rules,
    currency: planRow?.currency ?? settings.currency,
    locale,
    request,
    log: (entry) => logAiUsage(admin, { ...entry, userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  if (!result.ok) return jobError(result.code, result.code === "empty" ? 422 : 502);
  await track(
    "reward_setup_suggested",
    {
      changes: result.proposal.changes.length,
      questions: result.proposal.questions.length,
      unsupported: result.proposal.unsupported.length,
      editing: rules.length > 0,
    },
    { userId, admin },
  );
  return NextResponse.json({ ok: true, proposal: result.proposal });
}

/**
 * Sonnet drafts a reply to an e-mail the user pasted in, with the contact and
 * (when composing from a deal) its context. Nothing is saved: the user reads
 * the draft over, edits it and sends it themselves.
 */
async function emailReply(ctx: Context, body: unknown) {
  const parsed = emailReplyRequestSchema.safeParse(body);
  if (!parsed.success) return jobError("unknown", 400);
  const { supabase, admin, userId, settings, locale } = ctx;

  // Read with the user's own client: RLS keeps it to their contact and deal.
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("company_name, first_name, last_name")
    .eq("id", parsed.data.contactId)
    .eq("user_id", ctx.spaceId)
    .maybeSingle();
  if (contactError) throw contactError;
  if (!contact) return jobError("notFound", 404);

  let deal: { title: string; value: number | null; currency: string; stageName: string } | null =
    null;
  if (parsed.data.dealId) {
    const { data, error } = await supabase
      .from("deals")
      .select("title, value, currency, stage:pipeline_stages(name)")
      .eq("id", parsed.data.dealId)
      .eq("user_id", ctx.spaceId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      deal = {
        title: data.title,
        value: data.value,
        currency: data.currency,
        stageName: data.stage?.name ?? "",
      };
    }
  }

  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "email_reply");
    return jobError("limitReached", 429);
  }
  const client = createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "email_reply");
    return jobError("notConfigured", 503);
  }

  const contactName =
    contact.company_name ||
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    "the contact";

  // The scheduler's link for a meeting, when the person has one (never fails the reply).
  const bookingLink = await loadBookingLink(
    supabase,
    userId,
    ctx.spaceId,
    "meeting",
    linkOrigin(await siteOrigin().catch(() => null)),
  ).catch(() => null);

  const result = await suggestEmailReply({
    client,
    userId,
    contact: { name: contactName },
    deal,
    locale,
    receivedEmail: parsed.data.receivedEmail,
    bookingLink,
    log: (entry) =>
      logAiUsage(admin, { ...entry, userId, spaceId: ctx.spaceId, conversationId: null }),
  });
  if (!result.ok) return jobError(result.code, 502);
  return NextResponse.json({ ok: true, reply: result.reply });
}

/**
 * One chat turn: checks the attached files, saves the user's message, streams
 * Grady's answer as NDJSON lines (ChatEvent), then saves the answer and its
 * usage.
 */
async function chat(ctx: Context, body: unknown, request: Request) {
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const { message, attachments: refs } = parsed.data;
  const { supabase, admin, userId, settings, locale } = ctx;
  /** The turn as analytics sees it: sizes and outcome, never the text. */
  const turn = (ok: boolean, code?: string) =>
    ({
      new_conversation: !parsed.data.conversationId,
      attachments: refs.length,
      message_length: message.length,
      ok,
      ...(code ? { error_code: code } : {}),
    }) as const;

  const usage = await loadAiUsage(supabase, admin, userId, settings, undefined, ctx.spaceId);
  if (limitReached(usage)) {
    limitHit(ctx, "chat");
    const event: ChatEvent = { type: "error", code: "limitReached", usage };
    return NextResponse.json(event, { status: 429 });
  }

  // Checked before anything is saved, so a missing key leaves no unanswered message.
  // The end-to-end tests' own accounts may ask for the echo stand-in (never in production).
  const client = ctx.stage
    ? showcaseClient(ctx.admin, asLocale(ctx.locale), "chat")
    : wantsE2eEcho(request.headers, ctx.email)
    ? e2eEchoClient(ctx.admin)
    : wantsE2eEcho(request.headers, ctx.email, E2E_TOOL_SCRIPT)
      ? e2eToolClient(ctx.admin, e2eToolScript(request.headers))
      : createAnthropic(ctx.admin, { spaceId: ctx.spaceId });
  if (!client) {
    await logNotConfigured(ctx, "chat");
    const event: ChatEvent = { type: "error", code: "notConfigured", usage };
    return NextResponse.json(event, { status: 503 });
  }
  // Paused for the rest of the month (everyone's cap or this user's own): the kind note, and nothing is saved.
  const verdict = await client.budget.check("chat", userId);
  if (verdict !== "ok") {
    const event: ChatEvent = { type: "error", code: verdict, usage };
    return NextResponse.json(event, { status: verdict === "paused" ? 503 : 429 });
  }

  // Files are checked by content before the message is saved; a refused file refuses the message.
  const prepared = await prepareAttachments({ supabase, admin, userId, settings, refs });
  if (!prepared.ok) {
    trackLater("jarvis_message_sent", turn(false, prepared.code), { userId, admin });
    const event: ChatEvent = { type: "error", code: prepared.code, usage };
    return NextResponse.json(event, { status: FILE_ERROR_STATUS[prepared.code] });
  }
  const files = prepared.files;

  // The conversation is read and created with the user's own client, so RLS keeps it theirs.
  let conversationId = parsed.data.conversationId ?? null;
  if (conversationId) {
    const { data, error } = await supabase
      .from("jarvis_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const event: ChatEvent = { type: "error", code: "notFound" };
      return NextResponse.json(event, { status: 404 });
    }
  } else {
    const title = (message || files.map((file) => file.name).join(", "))
      .replace(/\s+/g, " ")
      .slice(0, TITLE_LENGTH);
    const { data, error } = await supabase
      .from("jarvis_conversations")
      .insert({ user_id: userId, title })
      .select("id")
      .single();
    if (error) throw error;
    conversationId = data.id;
  }
  const finalConversationId = conversationId;
  const log = (entry: Parameters<Parameters<typeof streamModel>[0]["log"]>[0]) =>
    logAiUsage(admin, {
      ...entry,
      userId,
      spaceId: ctx.spaceId,
      conversationId: finalConversationId,
    });

  // Messages are server-owned: only the admin client writes them, always with the session's id.
  const { data: userMessage, error: insertError } = await admin
    .from("jarvis_messages")
    .insert({ user_id: userId, conversation_id: conversationId, role: "user", content: message })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const shownAttachments = await recordAttachments(admin, userId, userMessage.id, files).catch(
    (error) => {
      console.error("grady attachments insert failed", error);
      return [];
    },
  );

  const [history, situationRaw, idea, answers, notes, plansParts, rules] = await Promise.all([
    supabase
      .from("jarvis_messages")
      .select("id, role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    loadSituation(supabase, settings, ctx.row?.country_code ?? null, new Date(), ctx.userId).catch(
      (error) => {
        // Grady still answers without the summary; the reason shows in the server log.
        console.error("grady situation failed", error);
        return null;
      },
    ),
    message
      ? handleFeatureRequest({
          client,
          supabase,
          admin,
          userId,
          userEmail: ctx.email,
          message,
          log,
        }).catch((error) => {
          console.error("grady feature request failed", error);
          return false;
        })
      : false,
    loadAnswersBlock(supabase, userId).catch((error) => {
      console.error("grady answers failed", error);
      return "";
    }),
    // The user's notes as data: titles, and the texts that matter for this message.
    loadNotesContext(supabase, message, settings).catch((error) => {
      console.error("grady notes failed", error);
      return "";
    }),
    // The published plan catalog (getPublishedPlans() falls back to the seed itself) and what the user has.
    Promise.all([
      getPublishedPlans(),
      getExchangeRates(),
      loadWorkerBillingVisible(admin).catch(() => false),
    ]).then(async ([catalog, rates, workerPrices]) => {
      const own = await loadSubscriptionLine(supabase, userId, catalog, settings).catch((error) => {
        console.error("grady subscription failed", error);
        return null;
      });
      return {
        own,
        full: () =>
          describePlans(catalog, locale, own, { currency: settings.currency, rates }, workerPrices),
      };
    }),
    // The owner's instructions from the administration (cached 30 s; defaults on a failed read).
    loadGradyRules(admin),
  ]);
  if (history.error) throw history.error;
  const rows = history.data.reverse();
  // Step 28.9: the context cut to what the message is about (chat-context.ts).
  const topics = chatTopics([
    message,
    ...rows
      .filter((row) => row.role === "user" && row.id !== userMessage.id)
      .slice(-2)
      .reverse()
      .map((row) => row.content),
  ]);
  const situation = situationRaw
    ? describeSituation(situationRaw, settings, situationSections(topics))
    : "The user's data could not be loaded right now.";
  const plans = plansCatalogNeeded(topics, plansParts.own)
    ? plansParts.full()
    : describePlansBrief(plansParts.own);
  const earlierIds = rows
    .filter((row) => row.role === "user" && row.id !== userMessage.id)
    .map((row) => row.id);
  const earlierFiles = await loadHistoryAttachments(supabase, earlierIds).catch((error) => {
    console.error("grady history attachments failed", error);
    return new Map();
  });
  const current = currentTurnAttachments(files);
  // What Grady's earlier answers changed in the app goes back with them.
  const earlierActions = await loadActions(
    supabase,
    rows.filter((row) => row.role === "assistant").map((row) => row.id),
  ).catch((error) => {
    console.error("grady history actions failed", error);
    return new Map();
  });
  const stored: StoredMessage[] = rows.map((row) => ({
    role: row.role,
    content:
      row.role === "assistant"
        ? row.content + actionsNote(earlierActions.get(row.id) ?? [])
        : row.content,
    attachments: row.id === userMessage.id ? current : earlierFiles.get(row.id),
  }));
  const messages = toModelMessages(stored);

  // The tools the account may use in the active space now (none when the space can not be read).
  const toolContext: ToolContext | null = await createToolContext({
    db: await createClient({ via: "grady" }),
    userId,
    spaceId: ctx.spaceId,
    settings,
    locale,
    country: ctx.row?.country_code ?? null,
  }).catch((error) => {
    console.error("grady tool context failed", error);
    return null;
  });
  const tools = toolContext ? toolsFor(toolContext.workspace, GRADY_TOOLS) : [];
  const assistantMessageId = crypto.randomUUID();
  const actionEnv: ActionEnv | null = toolContext
    ? {
        ctx: toolContext,
        admin,
        conversationId: finalConversationId,
        messageId: assistantMessageId,
      }
    : null;
  const toolsNote = toolContext?.workspace.readOnly
    ? "\n<tools_note>This space is read-only now (the trial or the plan ended): you can look things up but change nothing. When the user asks for a change, say kindly in one sentence that the app is read-only until the plan is renewed in Settings → Subscription, and offer what you can do (look things up, plan, draft).</tools_note>"
    : "";
  const extra =
    `\n${plans}` +
    (notes ? `\n${notes}` : "") +
    (answers ? `\n${answers}` : "") +
    (idea ? `\n${featureRequestNote()}` : "") +
    (mightBeProblemReport(message) ? `\n${problemReportNote()}` : "") +
    toolsNote;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The panel was closed; the answer is still saved below.
          open = false;
        }
      };

      try {
        send({
          type: "start",
          conversationId: finalConversationId,
          userMessageId: userMessage.id,
          attachments: shownAttachments,
        });
        const cards: ActionCard[] = [];
        const common = {
          client,
          userId,
          instructions: withOwnerInstructions(GRADY_PERSONA, rules.instructions),
          context: situationBlock(situation, locale) + extra,
          messages,
          onText: (text: string) => send({ type: "delta", text }),
          // The chat on auto: rules first, one short Haiku call when they cannot tell.
          autoPick: () =>
            pickChatModel(
              { message, attachments: files.length },
              { client, userId, log },
            ),
          log,
        };
        const result =
          actionEnv && tools.length
            ? await streamWithTools({
                ...common,
                tools,
                runTool: (call) => runToolCall(actionEnv, call),
                runBulk: (calls) => proposeBulk(actionEnv, calls),
                onTool: (name) => send({ type: "tool", label: progressLabel(toolContext, name) }),
                onStep: (step) => {
                  if (!step.card) return;
                  cards.push(step.card);
                  send({ type: "action", card: step.card });
                },
              })
            : await streamModel({ ...common, feature: "chat" });

        // An answer that made changes is kept even when its last words failed: the cards belong to it.
        let messageId: string | null = null;
        if (result.ok || cards.length) {
          const content = result.text.trim() || cards.map((card) => card.summary).join("\n");
          const { data, error } = await admin
            .from("jarvis_messages")
            .insert({
              id: assistantMessageId,
              user_id: userId,
              conversation_id: finalConversationId,
              role: "assistant",
              content,
              model: result.model,
            })
            .select("id")
            .single();
          if (error) console.error("grady answer insert failed", error);
          messageId = data?.id ?? null;
        }
        await supabase
          .from("jarvis_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", finalConversationId);

        const fresh = await loadAiUsage(
          supabase,
          admin,
          userId,
          settings,
          undefined,
          ctx.spaceId,
        ).catch(() => usage);
        if ((result.ok || cards.length) && messageId) {
          send({ type: "done", messageId, usage: fresh });
          await track("jarvis_message_sent", turn(true), { userId, admin });
        } else {
          const code = result.ok ? "unknown" : result.code;
          send({ type: "error", code, usage: fresh });
          await track("jarvis_message_sent", turn(false, code), { userId, admin });
        }
      } catch (error) {
        console.error("grady chat failed", error);
        send({ type: "error", code: "unknown" });
        await track("jarvis_message_sent", turn(false, "unknown"), { userId, admin });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** "Creating the task…" in the user's language; a tool without its own line says it is working. */
function progressLabel(toolContext: ToolContext | null, name: string): string {
  if (!toolContext) return "";
  try {
    return toolContext.t(`progress.${name}`);
  } catch {
    return toolContext.t("progress.default");
  }
}
