import { NextResponse } from "next/server";
import { switchSpace } from "@/features/account/server/switch-space";
import { instrumentRoute } from "@/lib/analytics/instrument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The space switcher: `{ space }` becomes the active space of this browser.
 * 404 for a space the account does not belong to (or that does not exist).
 * The page reloads afterwards, so every query starts over in the new space.
 */
export const POST = instrumentRoute("api.space.switch", async (request: Request) => {
  const body: unknown = await request.json().catch(() => null);
  const space = body && typeof body === "object" ? (body as { space?: unknown }).space : null;
  const result = await switchSpace(space, "switcher");
  if (result === "unauthenticated") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (result === "notFound") return NextResponse.json({ error: "notFound" }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
