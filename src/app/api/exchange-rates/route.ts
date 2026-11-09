import { NextResponse } from "next/server";
import { getExchangeRates } from "@/features/currency/server/rates";

export const runtime = "nodejs";

/**
 * The stored exchange rates against EUR, for showing prices and summaries in
 * another currency in the browser. Public reference data (the same for
 * everyone, nothing about any account); cached for an hour.
 */
export async function GET() {
  const rates = await getExchangeRates();
  return NextResponse.json(
    { base: "EUR", rates },
    { headers: { "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=3600" } },
  );
}
