import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripeClient, webhookSecret } from "@/features/billing/stripe/client";
import { isSyntheticE2eEvent } from "@/features/billing/stripe/modes";
import { finishEvent } from "@/features/billing/stripe/store";
import { processStripeEvent } from "@/features/billing/stripe/webhook";
import { webhookDeps } from "@/features/billing/stripe/webhook-server";
import { captureServerError } from "@/features/errors/alerts/server/capture";
import { instrumentRoute } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe's webhook (step 23.1). The signature is checked over the raw body
 * with STRIPE_WEBHOOK_SECRET; everything else is processStripeEvent():
 * each event once, the object loaded from Stripe as it is now, written only
 * through the billing functions with the admin client. A problem retrying
 * would not fix (an unknown workspace, the wrong mode) answers 200 and goes
 * to error_events; only an unexpected failure answers 500 for Stripe to
 * try again later.
 */
export const POST = instrumentRoute("stripe.webhook", async (request: Request) => {
  const secret = webhookSecret();
  if (!secret) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set: webhook refused.");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "signature" }, { status: 400 });
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "signature" }, { status: 400 });
  }

  const admin = createAdminClient();
  const synthetic = isSyntheticE2eEvent(event, process.env.VERCEL_ENV);
  const deps = webhookDeps(admin, stripeClient(), synthetic);
  try {
    const result = await processStripeEvent(event, deps);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    await finishEvent(admin, event.id, "error", null, { type: event.type }).catch(() => undefined);
    captureServerError(error, { source: "route", page: "/api/stripe/webhook", action: `stripe.${event.type}` });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
});
