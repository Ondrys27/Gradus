import { refreshExchangeRates } from "@/features/currency/server/rates";
import { runCron } from "@/lib/analytics/instrument";

export const runtime = "nodejs";

/**
 * Daily: the exchange rates against EUR from the ECB (frankfurter.app) and,
 * for every other currency, open.er-api.com. A source that fails leaves its
 * last rates; Administration → Health shows it.
 */
export function GET(request: Request) {
  return runCron("exchange_rates", request, async () => {
    const summary = await refreshExchangeRates();
    return { processed: summary.stored, body: summary };
  });
}
