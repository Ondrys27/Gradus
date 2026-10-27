import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { fingerprint as keyedHash } from "@/features/admin/server/request-info";
import { browserOf, deviceOf } from "@/lib/analytics/device";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/env";
import { APP_VERSION } from "@/lib/app-version";
import type { Database } from "@/types/database";
import { createErrorCode } from "../../error-code";
import { reportPage } from "../../report";
import type { ClientErrorSource } from "../client-error";
import { errorFingerprint } from "../fingerprint";
import { errorText, scrubErrorMessage, scrubStack } from "../scrub";
import { runInBackground } from "./background";
import { dispatchErrorAlert } from "./dispatch";

type Admin = SupabaseClient<Database>;

export type ServerErrorSource = "render" | "route" | "action" | "middleware" | "cron";
export type ErrorSource = ClientErrorSource | ServerErrorSource;

/** One caught error, before it is cleaned for storing. */
export type ErrorRecordInput = {
  code: string;
  source: ErrorSource;
  /** The path where it happened; ids, tokens and the query string are taken out here. */
  page: string;
  /** The route, the server action's page route or the cron job. */
  action?: string | null;
  /** The error's text ("TypeError: …"); scrubbed here. */
  message: string;
  stack?: string | null;
  digest?: string | null;
  userId: string | null;
  /** The account's e-mail: only to tell the end-to-end tests' accounts (mock e-mail). */
  email: string | null;
  userAgent: string | null;
  ip: string | null;
  viewport?: string | null;
  locale?: string | null;
  version?: string | null;
  /** For browsers: records per hour of one account / of one address anonymously. */
  limits?: { user: number; anonymous: number };
};

const E2E_EMAIL = /^e2e-[a-z0-9-]+@gradus\.local$/i;

/**
 * The end-to-end tests' accounts (e2e-…@gradus.local) outside production get
 * the mock e-mail: everything happens, but nothing goes to Resend.
 */
export function alertTransport(
  email: string | null,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): "resend" | "mock" {
  return vercelEnv !== "production" && !!email && E2E_EMAIL.test(email) ? "mock" : "resend";
}

const DIGEST = /^[A-Za-z0-9_@-]{1,64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,40}$/;

/** Line breaks and other control characters: never in a subject line or a table cell. */
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** The arguments of error_event_record(): cleaned, scrubbed, fingerprinted. */
export function prepareErrorRecord(input: ErrorRecordInput) {
  const page = reportPage(input.page.replace(CONTROL, ""));
  const message = scrubErrorMessage(input.message);
  const action = input.action
    ? input.action.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, 200) || null
    : null;
  const version = input.version ?? APP_VERSION;
  return {
    _code: input.code,
    _fingerprint: errorFingerprint({ message, page, source: input.source, action }),
    _source: input.source,
    _page: page,
    _message: message,
    _action: action ?? undefined,
    _stack: scrubStack(input.stack) ?? undefined,
    _digest: input.digest && DIGEST.test(input.digest) ? input.digest : undefined,
    // Null for an anonymous error; the generated type does not know SQL null.
    _user_id: input.userId as string,
    _browser: input.userAgent ? browserOf(input.userAgent) : undefined,
    _device: input.userAgent ? deviceOf(input.userAgent) : undefined,
    _viewport: input.viewport ?? undefined,
    _locale: input.locale === "cs" || input.locale === "en" ? input.locale : undefined,
    _app_version: VERSION.test(version) ? version : undefined,
    _ip_hash: input.ip ? keyedHash("ip", input.ip) : undefined,
    _transport: alertTransport(input.email),
    _limit_user: input.limits?.user,
    _limit_anonymous: input.limits?.anonymous,
  };
}

export type RecordOutcome =
  { outcome: "created"; id: string } | { outcome: "duplicate" | "limited" };

/** Stores one error (error_event_record). Throws when the database refuses. */
export async function recordError(
  input: ErrorRecordInput,
  admin: Admin = createAdminClient(),
): Promise<RecordOutcome> {
  const { data, error } = await admin.rpc("error_event_record", prepareErrorRecord(input));
  if (error) throw new Error(`error_event_record: ${error.code ?? error.message}`);
  const row = data?.[0];
  if (row?.outcome === "created" && row.event_id) return { outcome: "created", id: row.event_id };
  return { outcome: row?.outcome === "limited" ? "limited" : "duplicate" };
}

/**
 * Stores a server error and e-mails it, all after the response: the person
 * never waits for it and a failure here only reaches the log.
 */
export function captureServerError(
  error: unknown,
  context: {
    source: ServerErrorSource;
    page: string;
    action?: string | null;
    userId?: string | null;
    email?: string | null;
    userAgent?: string | null;
    ip?: string | null;
  },
): void {
  if (isFrameworkSignal(error)) return;
  const digest = (error as { digest?: unknown } | null)?.digest;
  runInBackground("error-alerts", async () => {
    const admin = createAdminClient();
    const recorded = await recordError(
      {
        code: createErrorCode(),
        source: context.source,
        page: context.page,
        action: context.action ?? null,
        message: errorText(error),
        stack: error instanceof Error ? error.stack : null,
        digest: typeof digest === "string" ? digest : null,
        userId: context.userId ?? null,
        email: context.email ?? null,
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
      },
      admin,
    );
    if (recorded.outcome === "created") await dispatchErrorAlert(recorded.id, { admin });
  });
}

/**
 * redirect(), notFound() and the like travel as thrown errors; they are how
 * Next.js works, not failures. Neither is a request the visitor abandoned.
 */
export function isFrameworkSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (
    typeof digest === "string" &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|NEXT_PRERENDER_INTERRUPTED)/.test(
      digest,
    )
  ) {
    return true;
  }
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "ResponseAborted";
}

type RequestHeaders = Readonly<Record<string, string | string[] | undefined>>;

function header(headers: RequestHeaders, name: string): string | null {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** The signed-in user of a failed request, read from its cookies (outside the request scope). */
async function userOfRequest(
  headers: RequestHeaders,
): Promise<{ userId: string | null; email: string | null }> {
  const cookie = header(headers, "cookie");
  if (!cookie) return { userId: null, email: null };
  try {
    const supabase = createServerClient<Database>(supabaseUrl(), supabasePublicKey(), {
      cookies: {
        getAll: () =>
          parseCookieHeader(cookie).map(({ name, value }) => ({ name, value: value ?? "" })),
        setAll: () => {},
      },
    });
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    return {
      userId: typeof claims?.sub === "string" ? claims.sub : null,
      email: typeof claims?.email === "string" ? claims.email : null,
    };
  } catch {
    return { userId: null, email: null };
  }
}

/**
 * instrumentation.ts → onRequestError: a server component, route handler,
 * server action or middleware threw. Recorded and e-mailed in the background.
 */
export function captureRequestError(
  error: unknown,
  request: Readonly<{ path: string; method: string; headers: RequestHeaders }>,
  context: Readonly<{ routePath: string; routeType: "render" | "route" | "action" | "middleware" }>,
): void {
  if (isFrameworkSignal(error)) return;
  const digest = (error as { digest?: unknown } | null)?.digest;
  runInBackground("error-alerts", async () => {
    const { userId, email } = await userOfRequest(request.headers);
    const forwarded = header(request.headers, "x-forwarded-for")?.split(",")[0]?.trim();
    const admin = createAdminClient();
    const recorded = await recordError(
      {
        code: createErrorCode(),
        source: context.routeType,
        page: request.path,
        action: context.routePath,
        message: errorText(error),
        stack: error instanceof Error ? error.stack : null,
        digest: typeof digest === "string" ? digest : null,
        userId,
        email,
        userAgent: header(request.headers, "user-agent"),
        ip: forwarded || header(request.headers, "x-real-ip"),
      },
      admin,
    );
    if (recorded.outcome === "created") await dispatchErrorAlert(recorded.id, { admin });
  });
}
