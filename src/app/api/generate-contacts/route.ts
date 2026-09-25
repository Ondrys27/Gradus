import { NextResponse } from "next/server";
import {
  generateSchema,
  MAX_PAGES,
  maxRequestable,
  PAGE_SIZE,
  type GenerationEvent,
  type GenerationUsage,
} from "@/features/contacts/generation";
import { searchText } from "@/features/contacts/server/places";
import {
  loadGenerationUsage,
  logGenerationCall,
} from "@/features/contacts/server/generation-usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toFormatSettings, USER_SETTINGS_COLUMNS } from "@/lib/user-settings";

export const runtime = "nodejs";
/** Three Google pages and three database calls fit easily. */
export const maxDuration = 60;

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
    country: row?.country_code ?? null,
  };
}

/** How much of the plan is left, for the form. */
export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const usage = await loadGenerationUsage(ctx.supabase, ctx.admin, ctx.userId, ctx.settings);
  return NextResponse.json({ usage, max: maxRequestable(usage) });
}

/**
 * Searches Google Places for "<industry> <location>", page by page, until the
 * wanted number of new contacts is saved or Google has no more. Progress goes
 * back as NDJSON lines (GenerationEvent).
 */
export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = generateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const { industry, location, count } = parsed.data;
  const { supabase, admin, userId, settings } = ctx;
  const textQuery = `${industry} ${location}`;

  const usage = await loadGenerationUsage(supabase, admin, userId, settings);
  if (count > maxRequestable(usage)) {
    const event: GenerationEvent = { type: "error", code: "limitReached", created: 0, usage };
    return NextResponse.json(event, { status: 429 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    await logGenerationCall(admin, userId, {
      success: false,
      quantity: 0,
      message: "GOOGLE_MAPS_API_KEY is not set",
      metadata: { query: textQuery },
    });
    const event: GenerationEvent = { type: "error", code: "notConfigured", created: 0 };
    return NextResponse.json(event, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerationEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const freshUsage = (): Promise<GenerationUsage | undefined> =>
        loadGenerationUsage(supabase, admin, userId, settings).catch(() => undefined);

      let created = 0;
      let duplicates = 0;
      let pageToken: string | null = null;
      let exhausted = false;

      try {
        for (let page = 1; page <= MAX_PAGES && created < count; page++) {
          send({ type: "phase", phase: "searching", page, created, target: count });
          const result = await searchText({
            apiKey,
            textQuery,
            languageCode: ctx.locale,
            regionCode: ctx.country,
            // Always a full page: duplicates are skipped, and Google bills the request, not the results.
            pageSize: PAGE_SIZE,
            pageToken,
          });

          if (!result.ok) {
            const { failure } = result;
            await logGenerationCall(admin, userId, {
              success: false,
              quantity: 0,
              message: failure.googleMessage || failure.code,
              metadata: {
                query: textQuery,
                page,
                http_status: failure.httpStatus,
                google_status: failure.googleStatus,
                reason: failure.reason,
                code: failure.code,
              },
            });
            send({
              type: "error",
              code: failure.code,
              created,
              httpStatus: failure.httpStatus || undefined,
              googleMessage: failure.googleMessage || undefined,
              usage: await freshUsage(),
            });
            return;
          }

          send({ type: "phase", phase: "saving", page, created, target: count });
          const { data, error } = await supabase
            .rpc("import_generated_contacts", {
              _places: result.places,
              _limit: count - created,
              _country: ctx.country ?? undefined,
              // Kept on the contact for the "best industries" statistics.
              _industry: industry,
            })
            .single();
          const pageCreated = data?.created ?? 0;
          created += pageCreated;
          duplicates += data?.duplicates ?? 0;

          await logGenerationCall(admin, userId, {
            success: true,
            quantity: pageCreated,
            metadata: {
              query: textQuery,
              page,
              http_status: result.httpStatus,
              results: result.places.length,
              created: pageCreated,
              duplicates: data?.duplicates ?? 0,
              ...(error ? { import_error: error.message } : {}),
            },
          });
          if (error) {
            send({ type: "error", code: "saveFailed", created, usage: await freshUsage() });
            return;
          }

          pageToken = result.nextPageToken;
          if (!pageToken) {
            exhausted = created < count;
            break;
          }
        }

        send({
          type: "done",
          created,
          duplicates,
          exhausted,
          usage: (await freshUsage()) ?? usage,
        });
      } catch (error) {
        console.error("generate-contacts failed", error);
        send({ type: "error", code: "unknown", created });
      } finally {
        controller.close();
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
