import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAnswer } from "@/features/notes/collab/append";
import { writeAsParticipant } from "@/features/notes/collab/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  noteId: z.uuid(),
  heading: z.string().trim().max(200),
  text: z.string().trim().min(1).max(20_000),
});

/**
 * "Save to notes" into an existing note: the answer is added on the server
 * into the note's live document (28.4), as the signed-in person and only
 * where they may write, so whoever has the note open sees it arrive and
 * nothing anyone types meanwhile is lost.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims?.sub ?? null;
  } catch {
    // No usable session: refused below.
  }
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const result = await writeAsParticipant(supabase, {
    noteId: body.noteId,
    userId,
    change: (current) => appendAnswer(current, body.heading, body.text),
  });
  if (result.ok) return NextResponse.json({ ok: true });
  const status = result.reason === "notFound" ? 404 : result.reason === "denied" ? 403 : result.reason === "tooLong" ? 413 : 409;
  return NextResponse.json({ ok: false, error: result.reason }, { status });
}
