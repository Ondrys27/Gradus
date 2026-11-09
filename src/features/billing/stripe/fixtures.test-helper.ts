import { readFileSync } from "node:fs";
import path from "node:path";
import type Stripe from "stripe";

/** A Stripe object from tests/fixtures/stripe, as the API returns it (only the fields Gradus reads). */
export function fixture<T>(name: string): T {
  const file = path.resolve(__dirname, "../../../../tests/fixtures/stripe", `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export const WORKSPACE = "11111111-1111-4111-8111-111111111111";

let sequence = 0;

/** An event around one object, created `created` (unix seconds). */
export function eventOf(
  type: string,
  object: unknown,
  options: { created?: number; livemode?: boolean; id?: string } = {},
): Stripe.Event {
  sequence += 1;
  return {
    id: options.id ?? `evt_test_${sequence}`,
    object: "event",
    api_version: "2026-10-28.endive",
    created: options.created ?? 1793491400,
    livemode: options.livemode ?? false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  } as unknown as Stripe.Event;
}
