import { NextResponse } from "next/server";
import { buildAccountExport } from "@/features/account/server/export-data";
import { exportFileName } from "@/features/account/data-export";
import { instrumentRoute } from "@/lib/analytics/instrument";
import { track } from "@/lib/analytics/track";
import { APP_NAME } from "@/lib/constants";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Export my data" (Settings → Account): a ZIP with one CSV per table of the
 * signed-in account. The user comes from the session and every read goes
 * through their own client, so row security applies on top of the owner filter.
 */
export const GET = instrumentRoute("api.account.export", async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: settings } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const result = await buildAccountExport(supabase, userId);
  await track("account_data_exported", { tables: result.tables, rows: result.rows }, { userId });

  const name = exportFileName(
    APP_NAME,
    new Date(),
    settings?.timezone ?? DEFAULT_FORMAT_SETTINGS.timeZone,
  );
  return new NextResponse(Buffer.from(result.zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
