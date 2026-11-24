import { NextResponse } from "next/server";
import { detectFileKind } from "@/features/grady/server/file-type";
import { extractText, UnreadableFileError } from "@/features/grady/server/extract";
import { MEETING_FILE_MAX_BYTES, MEETING_TEXT_MAX } from "@/features/meeting-notes/logic";
import { instrumentRoute } from "@/lib/analytics/instrument";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * "Paste meeting notes" (28.7): the text of a transcript file, so the user
 * sees and can edit it before Grady reads it. Plain text, Word and PDF,
 * told by their content (never the name alone), at most 10 MB; nothing is
 * stored and no model is called. Signed-in users only.
 */
export const POST = instrumentRoute("api.meeting_notes.extract", async (request: Request) => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub)
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  // A body far over the limit is refused before it is read.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MEETING_FILE_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, code: "fileTooLarge" }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ ok: false, code: "fileMissing" }, { status: 400 });
  if (file.size > MEETING_FILE_MAX_BYTES) {
    return NextResponse.json({ ok: false, code: "fileTooLarge" }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectFileKind(bytes, file.name);
  if (kind !== "txt" && kind !== "docx" && kind !== "pdf") {
    return NextResponse.json({ ok: false, code: "fileType" }, { status: 415 });
  }
  try {
    const extracted = await extractText(kind, bytes, MEETING_TEXT_MAX);
    if (!extracted?.text.trim()) {
      return NextResponse.json({ ok: false, code: "fileUnreadable" }, { status: 422 });
    }
    return NextResponse.json({
      ok: true,
      text: extracted.text,
      truncated: extracted.truncated,
      kind,
    });
  } catch (error) {
    if (error instanceof UnreadableFileError) {
      return NextResponse.json({ ok: false, code: "fileUnreadable" }, { status: 422 });
    }
    throw error;
  }
});
