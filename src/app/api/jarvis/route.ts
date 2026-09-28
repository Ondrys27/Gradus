import { NextResponse } from "next/server";
import { toModelMessages, type StoredMessage } from "@/features/jarvis/history";
import { EMPTY_USAGE, JARVIS_MODELS, modelFor, type JarvisFeature } from "@/features/jarvis/models";
import { featureRequestNote, situationBlock } from "@/features/jarvis/prompt";
import {
  chatRequestSchema,
  milestoneReviewRequestSchema,
  rewardSetupRequestSchema,
  salesAnalysisRequestSchema,
  type ChatErrorCode,
  type ChatEvent,
  type FileErrorCode,
  type JarvisOverview,
} from "@/features/jarvis/protocol";
import { describeSituation, suggestionsFor } from "@/features/jarvis/situation";
import type { SuggestionsResponse } from "@/features/jarvis/suggestions";
import {
  currentTurnAttachments,
  loadHistoryAttachments,
  prepareAttachments,
  recordAttachments,
} from "@/features/jarvis/server/attachments";
import { handleFeatureRequest } from "@/features/jarvis/server/feature-requests";
import { loadSituation } from "@/features/jarvis/server/load-situation";
import { reviewMilestone } from "@/features/jarvis/server/milestone-review";
import { createAnthropic, streamModel } from "@/features/jarvis/server/model";
import { runRewardSetup } from "@/features/jarvis/server/reward-setup";
import { runSalesAnalysis } from "@/features/jarvis/server/sales-analysis";
import { leafCount, rewardTreeSchema } from "@/features/workers/rewards/reward-tree";
import { refreshSuggestions } from "@/features/jarvis/server/suggestions";
import {
  limitReached,
  loadAiUsage,
  loadFileUsage,
  logAiUsage,
} from "@/features/jarvis/server/usage";
import { runWatch } from "@/features/jarvis/server/watch";
import { isCronRequest } from "@/lib/cron/verify";
import { todayIsoDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const email = data.claims.email;
  return {
    supabase,
    admin: createAdminClient(),
    userId,
    email: typeof email === "string" ? email : null,
    settings: toFormatSettings(row),
    locale: row?.locale ?? "en",
  };
}
type Context = NonNullable<Awaited<ReturnType<typeof context>>>;

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

const FILE_ERROR_STATUS: Record<FileErrorCode, number> = {
  fileType: 415,
  fileTooLarge: 413,
  fileUnreadable: 422,
  fileMissing: 400,
  fileLimit: 429,
};

/** Logs a call that could not start because the key is missing; every attempt is measured. */
async function logNotConfigured(ctx: Context, feature: JarvisFeature) {
  await logAiUsage(ctx.admin, {
    userId: ctx.userId,
    conversationId: null,
    feature,
    model: modelFor(feature) ?? JARVIS_MODELS.sonnet,
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
 * - `?view=suggestions`: the instant triggers, then the open suggestions.
 * - otherwise: calls and files left this month and the chips for the situation.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("task") === "watch") return watch(request);

  const ctx = await context();
  if (!ctx) return unauthorized();

  if (params.get("view") === "suggestions") {
    const suggestions = await refreshSuggestions(ctx);
    const body: SuggestionsResponse = { suggestions };
    return NextResponse.json(body);
  }

  const [usage, files, situation] = await Promise.all([
    loadAiUsage(ctx.supabase, ctx.admin, ctx.userId, ctx.settings),
    loadFileUsage(ctx.supabase, ctx.admin, ctx.userId, ctx.settings),
    loadSituation(ctx.supabase, ctx.settings).catch((error) => {
      console.error("jarvis situation failed", error);
      return null;
    }),
  ]);
  const body: JarvisOverview = {
    usage,
    files,
    suggestions: situation ? suggestionsFor(situation) : ["planDay"],
  };
  return NextResponse.json(body);
}

async function watch(request: Request) {
  if (!isCronRequest(request)) return unauthorized();
  const started = Date.now();
  try {
    const summary = await runWatch({
      client: createAnthropic(),
      admin: createAdminClient(),
      deadline: started + maxDuration * 1000 - WATCH_MARGIN_MS,
    });
    return NextResponse.json({ ok: true, ...summary, ms: Date.now() - started });
  } catch (error) {
    console.error("jarvis watch failed", error);
    return NextResponse.json({ error: "watch_failed" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

/** The chat by default; `kind` picks another job. Every model call of the app goes through here. */
export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return unauthorized();
  const body: unknown = await request.json().catch(() => null);
  const kind = (body as { kind?: unknown } | null)?.kind;
  if (kind === "milestoneReview") return milestoneReview(ctx, body);
  if (kind === "salesAnalysis") return salesAnalysis(ctx, body);
  if (kind === "rewardSetup") return rewardSetup(ctx, body);
  return chat(ctx, body);
}

function jobError(
  code: ChatErrorCode | "locked" | "alreadyReviewed" | "empty",
  status: number,
) {
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
    .maybeSingle();
  if (error) throw error;
  if (!milestone) return jobError("notFound", 404);
  if (milestone.ai_feedback) return jobError("alreadyReviewed", 409);

  const usage = await loadAiUsage(supabase, admin, userId, settings);
  if (limitReached(usage)) return jobError("limitReached", 429);
  const client = createAnthropic();
  if (!client) {
    await logNotConfigured(ctx, "milestone_review");
    return jobError("notConfigured", 503);
  }

  const result = await reviewMilestone({
    client,
    admin,
    userId,
    milestoneId: parsed.data.milestoneId,
    milestone,
    today: todayIsoDate(settings),
    locale,
    log: (entry) => logAiUsage(admin, { ...entry, userId, conversationId: null }),
  });
  if (!result.ok) return jobError(result.code, 502);
  return NextResponse.json({ ok: true, feedback: result.text });
}

/** Opus analyses the meeting surveys; unlocked after five of them. */
async function salesAnalysis(ctx: Context, body: unknown) {
  if (!salesAnalysisRequestSchema.safeParse(body).success) return jobError("unknown", 400);
  const { supabase, admin, userId, settings, locale } = ctx;

  const usage = await loadAiUsage(supabase, admin, userId, settings);
  if (limitReached(usage)) return jobError("limitReached", 429);
  const client = createAnthropic();
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
    log: (entry) => logAiUsage(admin, { ...entry, userId, conversationId: null }),
  });
  if (!result.ok) return jobError(result.code, result.code === "locked" ? 403 : 502);
  return NextResponse.json({ ok: true, analysis: result.analysis });
}

/**
 * Sonnet turns the owner's reward tree into rules and explains them. Nothing is
 * saved: the proposal goes back to the editor, where the owner confirms it.
 */
async function rewardSetup(ctx: Context, body: unknown) {
  const request = rewardSetupRequestSchema.safeParse(body);
  const tree = request.success ? rewardTreeSchema.safeParse(request.data.tree) : null;
  if (!tree?.success) return jobError("unknown", 400);
  if (leafCount(tree.data) === 0) return jobError("empty", 400);
  const { supabase, admin, userId, settings, locale } = ctx;

  const usage = await loadAiUsage(supabase, admin, userId, settings);
  if (limitReached(usage)) return jobError("limitReached", 429);
  const client = createAnthropic();
  if (!client) {
    await logNotConfigured(ctx, "reward_setup");
    return jobError("notConfigured", 503);
  }

  // Names only, read with the owner's own client: RLS keeps it to their workers.
  const { data: workers, error } = await supabase
    .from("workers")
    .select("id, name")
    .eq("owner_id", userId)
    .limit(200);
  if (error) throw error;

  const result = await runRewardSetup({
    client,
    tree: tree.data,
    workers,
    currency: settings.currency,
    locale,
    log: (entry) => logAiUsage(admin, { ...entry, userId, conversationId: null }),
  });
  if (!result.ok) return jobError(result.code, 502);
  return NextResponse.json({ ok: true, proposal: result.proposal });
}

/**
 * One chat turn: checks the attached files, saves the user's message, streams
 * Jarvis's answer as NDJSON lines (ChatEvent), then saves the answer and its
 * usage.
 */
async function chat(ctx: Context, body: unknown) {
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const { message, attachments: refs } = parsed.data;
  const { supabase, admin, userId, settings, locale } = ctx;

  const usage = await loadAiUsage(supabase, admin, userId, settings);
  if (limitReached(usage)) {
    const event: ChatEvent = { type: "error", code: "limitReached", usage };
    return NextResponse.json(event, { status: 429 });
  }

  // Checked before anything is saved, so a missing key leaves no unanswered message.
  const client = createAnthropic();
  if (!client) {
    await logNotConfigured(ctx, "chat");
    const event: ChatEvent = { type: "error", code: "notConfigured", usage };
    return NextResponse.json(event, { status: 503 });
  }

  // Files are checked by content before the message is saved; a refused file refuses the message.
  const prepared = await prepareAttachments({ supabase, admin, userId, settings, refs });
  if (!prepared.ok) {
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
    logAiUsage(admin, { ...entry, userId, conversationId: finalConversationId });

  // Messages are server-owned: only the admin client writes them, always with the session's id.
  const { data: userMessage, error: insertError } = await admin
    .from("jarvis_messages")
    .insert({ user_id: userId, conversation_id: conversationId, role: "user", content: message })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const shownAttachments = await recordAttachments(admin, userId, userMessage.id, files).catch(
    (error) => {
      console.error("jarvis attachments insert failed", error);
      return [];
    },
  );

  const [history, situation, idea] = await Promise.all([
    supabase
      .from("jarvis_messages")
      .select("id, role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    loadSituation(supabase, settings)
      .then((value) => describeSituation(value, settings))
      .catch((error) => {
        // Jarvis still answers without the summary; the reason shows in the server log.
        console.error("jarvis situation failed", error);
        return "The user's data could not be loaded right now.";
      }),
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
          console.error("jarvis feature request failed", error);
          return false;
        })
      : false,
  ]);
  if (history.error) throw history.error;
  const rows = history.data.reverse();
  const earlierIds = rows
    .filter((row) => row.role === "user" && row.id !== userMessage.id)
    .map((row) => row.id);
  const earlierFiles = await loadHistoryAttachments(supabase, earlierIds).catch((error) => {
    console.error("jarvis history attachments failed", error);
    return new Map();
  });
  const current = currentTurnAttachments(files);
  const stored: StoredMessage[] = rows.map((row) => ({
    role: row.role,
    content: row.content,
    attachments: row.id === userMessage.id ? current : earlierFiles.get(row.id),
  }));
  const messages = toModelMessages(stored);
  const extra = idea ? `\n${featureRequestNote()}` : "";

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
        const result = await streamModel({
          client,
          feature: "chat",
          context: situationBlock(situation, locale) + extra,
          messages,
          onText: (text) => send({ type: "delta", text }),
          log,
        });

        let messageId: string | null = null;
        if (result.ok) {
          const { data, error } = await admin
            .from("jarvis_messages")
            .insert({
              user_id: userId,
              conversation_id: finalConversationId,
              role: "assistant",
              content: result.text,
              model: result.model,
            })
            .select("id")
            .single();
          if (error) console.error("jarvis answer insert failed", error);
          messageId = data?.id ?? null;
        }
        await supabase
          .from("jarvis_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", finalConversationId);

        const fresh = await loadAiUsage(supabase, admin, userId, settings).catch(() => usage);
        if (result.ok && messageId) {
          send({ type: "done", messageId, usage: fresh });
        } else {
          send({ type: "error", code: result.ok ? "unknown" : result.code, usage: fresh });
        }
      } catch (error) {
        console.error("jarvis chat failed", error);
        send({ type: "error", code: "unknown" });
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
