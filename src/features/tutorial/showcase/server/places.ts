import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { FoundPlace, GenerationEvent } from "@/features/contacts/generation";
import { loadGenerationUsage } from "@/features/contacts/server/generation-usage";
import type { FormatSettings } from "@/lib/format";
import { stageData } from "../stage-data";

type Db = SupabaseClient<Database>;

/**
 * Generate contacts on the showcase's stage (step 27.4): the same answer as
 * the real search (NDJSON progress, then done), but the places are the
 * stage's prepared ones in its language and Google is never called, so the
 * showcase costs nothing and finds the same businesses every time. They are
 * saved through import_generated_contacts like real results.
 */

const SEARCH_MS = 900;
const SAVE_MS = 500;

export function showcasePlaces(
  ctx: {
    supabase: Db;
    admin: Db;
    workspaceId: string;
    settings: FormatSettings;
    locale: string;
    country: string | null;
  },
  input: { industry: string; count: number },
): Response {
  const data = stageData(ctx.locale === "cs" ? "cs" : "en");
  const places: FoundPlace[] = data.places.slice(0, input.count).map((place, index) => ({
    id: `showcase-${index + 1}`,
    name: place.name,
    phone: place.phone ?? null,
    website: place.website ?? null,
    address: place.address,
  }));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerationEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      try {
        send({ type: "phase", phase: "searching", page: 1, created: 0, target: input.count });
        await wait(SEARCH_MS);
        send({ type: "phase", phase: "saving", page: 1, created: 0, target: input.count });
        const { data: saved, error } = await ctx.supabase
          .rpc("import_generated_contacts", {
            _places: places,
            _limit: input.count,
            _country: ctx.country ?? undefined,
            _industry: input.industry,
          })
          .single();
        await wait(SAVE_MS);
        if (error) {
          console.error("[showcase] saving the prepared places failed", error.code);
          send({ type: "error", code: "saveFailed", created: 0 });
          return;
        }
        const usage = await loadGenerationUsage(ctx.admin, ctx.workspaceId, ctx.settings);
        send({
          type: "done",
          created: saved?.created ?? 0,
          duplicates: saved?.duplicates ?? 0,
          exhausted: false,
          usage,
        });
      } catch (error) {
        console.error("[showcase] generating failed", error);
        send({ type: "error", code: "unknown", created: 0 });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
