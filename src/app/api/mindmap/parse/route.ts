import { NextResponse } from "next/server";
import { MINDMAP_FILE_MAX_BYTES, parseMindMapFile } from "@/lib/mindmap/formats";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Room for the multipart envelope around the file. */
const ENVELOPE_BYTES = 64 * 1024;

/**
 * Reads a mind map file (OPML, FreeMind, XMind, Markdown, indented text) into
 * the shared tree, for signed-in people only. Nothing is stored: the file is
 * parsed here, off the browser, and only the tree goes back. XML is read
 * without external entities, ZIPs without leaving the archive (see
 * src/lib/mindmap/formats).
 */
export async function POST(request: Request) {
  let userId: string | null = null;
  try {
    const { data } = await (await createClient()).auth.getClaims();
    userId = data?.claims?.sub ?? null;
  } catch {
    // No usable session: refused below.
  }
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MINDMAP_FILE_MAX_BYTES + ENVELOPE_BYTES) {
    return NextResponse.json({ ok: false, error: "tooLarge" }, { status: 413 });
  }
  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return NextResponse.json({ ok: false, error: "unreadable" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "unreadable" }, { status: 400 });
  }
  if (file.size > MINDMAP_FILE_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "tooLarge" }, { status: 413 });
  }

  // A file that is not a mind map is an answer, not a failed request.
  return NextResponse.json(parseMindMapFile(file.name, new Uint8Array(await file.arrayBuffer())));
}
