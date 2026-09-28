import { NextResponse } from "next/server";
import { toModelMessages } from "@/features/jarvis/history";
import { EMPTY_USAGE, JARVIS_MODELS } from "@/features/jarvis/models";
import { situationBlock } from "@/features/jarvis/prompt";
import { chatRequestSchema, type ChatEvent, type JarvisOverview } from "@/features/jarvis/protocol";
import { describeSituation, suggestionsFor } from "@/features/jarvis/situation";
import { loadSituation } from "@/features/jarvis/server/load-situation";
import { createAnthropic, streamModel } from "@/features/jarvis/server/model";
import { limitReached, loadAiUsage, logAiUsage } from "@/features/jarvis/server/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toFormatSettings, USER_SETTINGS_COLUMNS } from "@/lib/user-settings";

export const runtime = "nodejs";
/** A long answer streams for well under a minute; this leaves room. */
export const maxDuration = 120;

/** Messages of the conversation sent back to the model. */
const HISTORY_LIMIT = 20;
const TITLE_LENGTH = 80;

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
  return {
    supabase,
    admin: createAdminClient(),
    userId,
    settings: toFormatSettings(row),
    locale: row?.locale ?? "en",
  };
}

/** Calls left this month and the chips that fit the user's situation. */
export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [usage, situation] = await Promise.all([
    loadAiUsage(ctx.supabase, ctx.admin, ctx.userId, ctx.settings),
    loadSituation(ctx.supabase, ctx.settings).catch((error) => {
      console.error("jarvis situation failed", error);
      return null;
    }),
  ]);
  const body: JarvisOverview = {
    usage,
    suggestions: situation ? suggestionsFor(situation) : ["planDay"],
  };
  return NextResponse.json(body);
}

/**
 * One chat turn: saves the user's message, streams Jarvis's answer as NDJSON
 * lines (ChatEvent), then saves the answer and its usage. Every model call of
 * the app goes through this route.
 */
export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const { message } = parsed.data;
  const { supabase, admin, userId, settings, locale } = ctx;

  const usage = await loadAiUsage(supabase, admin, userId, settings);
  if (limitReached(usage)) {
    const event: ChatEvent = { type: "error", code: "limitReached", usage };
    return NextResponse.json(event, { status: 429 });
  }

  // Checked before anything is saved, so a missing key leaves no unanswered message.
  const client = createAnthropic();
  if (!client) {
    await logAiUsage(admin, {
      userId,
      conversationId: null,
      feature: "chat",
      model: JARVIS_MODELS.sonnet,
      tokens: EMPTY_USAGE,
      durationMs: 0,
      error: "ANTHROPIC_API_KEY is not set",
    });
    const event: ChatEvent = { type: "error", code: "notConfigured", usage };
    return NextResponse.json(event, { status: 503 });
  }

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
    const { data, error } = await supabase
      .from("jarvis_conversations")
      .insert({ user_id: userId, title: message.replace(/\s+/g, " ").slice(0, TITLE_LENGTH) })
      .select("id")
      .single();
    if (error) throw error;
    conversationId = data.id;
  }

  // Messages are server-owned: only the admin client writes them, always with the session's id.
  const { data: userMessage, error: insertError } = await admin
    .from("jarvis_messages")
    .insert({ user_id: userId, conversation_id: conversationId, role: "user", content: message })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const [history, situation] = await Promise.all([
    supabase
      .from("jarvis_messages")
      .select("role, content")
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
  ]);
  if (history.error) throw history.error;
  const messages = toModelMessages(history.data.reverse());

  const finalConversationId = conversationId;
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
        send({ type: "start", conversationId: finalConversationId, userMessageId: userMessage.id });
        const result = await streamModel({
          client,
          feature: "chat",
          context: situationBlock(situation, locale),
          messages,
          onText: (text) => send({ type: "delta", text }),
          log: (entry) =>
            logAiUsage(admin, { ...entry, userId, conversationId: finalConversationId }),
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
