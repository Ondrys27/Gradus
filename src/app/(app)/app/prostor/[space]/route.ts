import { NextResponse } from "next/server";
import { switchSpace } from "@/features/account/server/switch-space";
import { instrumentRoute } from "@/lib/analytics/instrument";
import { loginUrlFor } from "@/lib/auth/routes";
import { APP_HOME_PATH } from "@/lib/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /app/prostor/<space>: a link into one company (from an e-mail, a bookmark).
 * Switches to it and opens the dashboard there; a company the account is not
 * in (or that does not exist) is a plain 404, so the address tells nobody
 * anything.
 */
export const GET = instrumentRoute(
  "app.space.link",
  async (request: Request, context: { params: Promise<{ space: string }> }) => {
    const { space } = await context.params;
    const result = await switchSpace(space, "link");
    const url = new URL(request.url);
    if (result === "unauthenticated") {
      return NextResponse.redirect(new URL(loginUrlFor(url.pathname, "cs"), url));
    }
    if (result === "notFound") {
      return new NextResponse("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.redirect(new URL(APP_HOME_PATH, url), { headers: { "Cache-Control": "no-store" } });
  },
);
