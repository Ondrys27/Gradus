import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { aiModelById, maxTokensFor, type GradyFeature, type GradyModel, type TokenUsage } from "../models";
import { planCall, thinkingParams, type ModelClient } from "./model";
import { logAiUsage } from "./usage";

/**
 * Grady's background jobs through the Message Batches API (step 28.9): the
 * morning briefs and the opportunity watch are answered within minutes to
 * hours instead of at once, for half the price of every token. Nobody waits
 * for them: the brief is shown at the first arrival (and written on the spot
 * when it is not there yet), the watch's suggestions are checked again
 * before they are shown.
 *
 * Every request is planned like a direct call (budget guard, the job's
 * model, economy mode for that user), the batch is recorded in
 * grady_batches before anything else happens, and when it ends every
 * answer is written to ai_usage at the batch price (`batch`) and handed to
 * the job. A client without the Batches API (the test doubles) or a batch
 * that cannot be sent or recorded leaves the job to its direct calls.
 */

type Client = SupabaseClient<Database>;

export type BatchKind = "briefing" | "watch";

export type BatchRequest = {
  /** Unique in the batch: [a-zA-Z0-9_-]{1,64}. */
  customId: string;
  userId: string;
  feature: GradyFeature;
  instructions: string;
  context: string;
  messages: Anthropic.MessageParam[];
  /** What the job needs to use the answer later (ids and small facts, never long texts). */
  meta: Json;
};

export type BatchItem = {
  custom_id: string;
  user_id: string;
  feature: GradyFeature;
  model: GradyModel;
  routed_from: GradyModel | null;
  meta: Json;
};

export type BatchAnswer = { ok: true; text: string } | { ok: false; reason: string };

type BatchesApi = Pick<Anthropic["messages"]["batches"], "create" | "retrieve" | "results" | "cancel">;

function batchesOf(client: ModelClient): BatchesApi | null {
  const batches = (client.messages as Partial<Anthropic["messages"]>).batches;
  return batches && typeof batches.create === "function" ? batches : null;
}

/** Whether the client can send batches at all (the real SDK can, the test doubles cannot). */
export function canBatch(client: ModelClient | null): client is ModelClient {
  return !!client && !!batchesOf(client);
}

export const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/** A custom id from a kind and a user id: "w_<uuid without dashes>". */
export function customIdFor(kind: BatchKind, userId: string): string {
  return `${kind === "watch" ? "w" : "b"}_${userId.replace(/-/g, "")}`;
}

export type SubmitResult = {
  /** The id of the recorded batch; null when nothing was sent. */
  batchId: string | null;
  /** Requests in the batch. */
  queued: BatchRequest[];
  /** Requests the guard refused (paused, a cap): they are not sent and not retried now. */
  refused: BatchRequest[];
  /** Requests that could not go in a batch: the job runs them directly. */
  direct: BatchRequest[];
};

/**
 * Plans every request like a direct call and sends the ones the budget
 * allows as one batch, recorded in grady_batches. Without the Batches API,
 * or when sending or recording fails, every allowed request comes back in
 * `direct`.
 */
export async function submitBatch(args: {
  client: ModelClient;
  admin: Client;
  kind: BatchKind;
  requests: BatchRequest[];
}): Promise<SubmitResult> {
  const result: SubmitResult = { batchId: null, queued: [], refused: [], direct: [] };
  const api = batchesOf(args.client);
  if (!api) return { ...result, direct: args.requests };

  const items: BatchItem[] = [];
  const params: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];
  for (const request of args.requests) {
    if (!CUSTOM_ID.test(request.customId)) {
      result.direct.push(request);
      continue;
    }
    const plan = await planCall({ client: args.client, feature: request.feature, userId: request.userId });
    if (!plan.ok) {
      result.refused.push(request);
      continue;
    }
    const model = plan.choice.model.id;
    params.push({
      custom_id: request.customId,
      params: {
        model,
        max_tokens: maxTokensFor(request.feature, model),
        system: [
          { type: "text", text: request.instructions, cache_control: { type: "ephemeral" } },
          ...(request.context ? [{ type: "text" as const, text: request.context }] : []),
        ],
        messages: request.messages,
        ...(thinkingParams(request.feature, plan.choice) as Pick<
          Anthropic.MessageCreateParamsNonStreaming,
          "thinking" | "output_config"
        >),
      },
    });
    items.push({
      custom_id: request.customId,
      user_id: request.userId,
      feature: request.feature,
      model,
      routed_from: plan.choice.routedFrom,
      meta: request.meta,
    });
    result.queued.push(request);
  }
  if (!params.length) return result;

  let batchId: string;
  try {
    batchId = (await api.create({ requests: params })).id;
  } catch (error) {
    console.error(`grady ${args.kind} batch could not be sent`, error);
    return { ...result, queued: [], direct: [...result.direct, ...result.queued] };
  }
  const { error } = await args.admin.from("grady_batches").insert({
    kind: args.kind,
    batch_id: batchId,
    model: items[0].model,
    items: items as unknown as Json,
  });
  if (error) {
    // Not recorded = never collected: take it back and answer directly.
    console.error(`grady ${args.kind} batch could not be recorded`, error);
    await api.cancel(batchId).catch(() => undefined);
    return { ...result, queued: [], direct: [...result.direct, ...result.queued] };
  }
  return { ...result, batchId };
}

function usageOf(message: Anthropic.Message): TokenUsage {
  return {
    inputTokens: message.usage.input_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    outputTokens: message.usage.output_tokens,
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** A batch older than this is given up: the API expires its requests after 24 hours. */
export const BATCH_GIVE_UP_MS = 26 * 3_600_000;

export type CollectSummary = { batches: number; answered: number; failed: number; pending: number };

/**
 * Collects the ended batches of a kind: every answer to ai_usage at the
 * batch price, then to the job (`handle`); a batch that is still running
 * stays for the next collection, one past BATCH_GIVE_UP_MS is cancelled and
 * collected with what it answered. A batch is claimed (status collected)
 * before its answers are used, so it is used at most once. `wait` polls the open batches until the deadline first.
 */
export async function collectBatches(args: {
  client: ModelClient;
  admin: Client;
  kind: BatchKind;
  handle: (item: BatchItem, answer: BatchAnswer) => Promise<void>;
  /** Poll until every open batch ended or this instant passed (ms since epoch). */
  waitUntil?: number;
  /** At the deadline, cancel what is still running (its unprocessed requests are not billed). */
  cancelAtDeadline?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<CollectSummary> {
  const summary: CollectSummary = { batches: 0, answered: 0, failed: 0, pending: 0 };
  const api = batchesOf(args.client);
  if (!api) return summary;
  const now = args.now ?? Date.now;
  const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const { data: rows, error } = await args.admin
    .from("grady_batches")
    .select("id, batch_id, items, created_at")
    .eq("kind", args.kind)
    .eq("status", "submitted")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) {
    // Before the 28.9 migration the table is not there: nothing was sent, nothing to collect.
    console.error(`grady ${args.kind} batches could not be read`, error);
    return summary;
  }

  for (const row of rows ?? []) {
    let batch = await api.retrieve(row.batch_id);
    while (batch.processing_status !== "ended" && args.waitUntil && now() < args.waitUntil) {
      await sleep(Math.min(10_000, Math.max(0, args.waitUntil - now())));
      batch = await api.retrieve(row.batch_id);
    }
    const age = now() - new Date(row.created_at).getTime();
    if (batch.processing_status !== "ended") {
      if (args.cancelAtDeadline || age > BATCH_GIVE_UP_MS) {
        batch = await api.cancel(row.batch_id);
        // Cancelling ends within moments; what was answered before it is still collected.
        for (let tries = 0; batch.processing_status !== "ended" && tries < 6; tries++) {
          await sleep(2_000);
          batch = await api.retrieve(row.batch_id);
        }
      }
      if (batch.processing_status !== "ended") {
        summary.pending += 1;
        continue;
      }
    }

    // Claimed before the answers are used, so two runs never use one batch twice.
    const { data: claimed, error: claimError } = await args.admin
      .from("grady_batches")
      .update({ status: "collected", collected_at: new Date(now()).toISOString() })
      .eq("id", row.id)
      .eq("status", "submitted")
      .select("id");
    if (claimError) throw claimError;
    if (!claimed?.length) continue;

    summary.batches += 1;
    const items = new Map(
      ((row.items as unknown as BatchItem[]) ?? []).map((item) => [item.custom_id, item]),
    );
    const waited = batch.ended_at
      ? new Date(batch.ended_at).getTime() - new Date(batch.created_at).getTime()
      : 0;
    for await (const entry of await api.results(row.batch_id)) {
      const item = items.get(entry.custom_id);
      if (!item) continue;
      items.delete(entry.custom_id);
      if (entry.result.type === "succeeded") {
        const message = entry.result.message;
        const text = textOf(message);
        await logAiUsage(args.admin, {
          userId: item.user_id,
          conversationId: null,
          feature: item.feature,
          model: (aiModelById(message.model)?.id ?? item.model) as GradyModel,
          routedFrom: item.routed_from,
          tokens: usageOf(message),
          durationMs: waited,
          batch: true,
          ...(text.trim() ? {} : { error: `empty answer (stop_reason: ${message.stop_reason ?? "none"})` }),
        });
        summary.answered += 1;
        await args.handle(item, text.trim() ? { ok: true, text } : { ok: false, reason: "empty" });
      } else {
        // Errored, cancelled and expired requests are not billed; the job decides what to do.
        summary.failed += 1;
        await args.handle(item, { ok: false, reason: entry.result.type });
      }
    }
    for (const item of items.values()) {
      summary.failed += 1;
      await args.handle(item, { ok: false, reason: "missing" });
    }
    const { error: doneError } = await args.admin
      .from("grady_batches")
      .update({
        summary: {
          succeeded: batch.request_counts.succeeded,
          errored: batch.request_counts.errored,
          canceled: batch.request_counts.canceled,
          expired: batch.request_counts.expired,
          waited_ms: waited,
        },
      })
      .eq("id", row.id);
    if (doneError) console.error("grady batch summary could not be saved", doneError);
  }
  return summary;
}

/** The users whose requests of a kind are still in a batch: the next run leaves them alone. */
export async function usersInOpenBatches(admin: Client, kind: BatchKind): Promise<Set<string>> {
  const { data, error } = await admin
    .from("grady_batches")
    .select("items")
    .eq("kind", kind)
    .eq("status", "submitted")
    .limit(20);
  if (error) {
    console.error("grady open batches could not be read", error);
    return new Set();
  }
  const users = new Set<string>();
  for (const row of data ?? []) {
    for (const item of (row.items as unknown as BatchItem[]) ?? []) users.add(item.user_id);
  }
  return users;
}

