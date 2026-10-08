import "server-only";
import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron/verify";
import type { EventProps } from "./events";
import { track, trackLater } from "./track";

type CronJob = EventProps<"cron_run">["job"];

/**
 * A short, data-free code for a failure: a Postgres/PostgREST code, a
 * provider's own code or the error's class name — never its message.
 */
export function errorCode(error: unknown): string {
  const candidate =
    (error as { code?: unknown } | null)?.code ?? (error instanceof Error ? error.name : undefined);
  if (typeof candidate === "string" && /^[A-Za-z0-9_.:-]{1,48}$/.test(candidate)) {
    return /\d{6,}/.test(candidate) ? "unknown" : candidate;
  }
  return "unknown";
}

function recordCall(
  name: string,
  kind: "route" | "action",
  started: number,
  outcome: { ok: boolean; status?: number; errorCode?: string },
) {
  const duration = Math.min(86_400_000, Math.max(0, Math.round(performance.now() - started)));
  trackLater(
    "server_call",
    {
      name,
      kind,
      ok: outcome.ok,
      duration_ms: duration,
      ...(outcome.status !== undefined ? { status: outcome.status } : {}),
      ...(outcome.errorCode ? { error_code: outcome.errorCode } : {}),
    },
    { userId: null },
  );
}

/**
 * Wraps a route handler: records how long it took and how it ended (status,
 * error code). For streamed answers the time is until the stream starts.
 */
export function instrumentRoute<Args extends unknown[]>(
  name: string,
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    const started = performance.now();
    try {
      const response = await handler(...args);
      recordCall(name, "route", started, {
        ok: response.status < 500,
        status: response.status,
        errorCode: response.status >= 400 ? `http_${response.status}` : undefined,
      });
      return response;
    } catch (error) {
      recordCall(name, "route", started, { ok: false, status: 500, errorCode: errorCode(error) });
      throw error;
    }
  };
}

/**
 * Wraps a server action or server function: records time and outcome. A
 * result shaped `{ ok: false, code }` counts as a failure with that code.
 */
export function measure<Args extends unknown[], R>(
  name: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    const started = performance.now();
    try {
      const result = await fn(...args);
      const shaped = result as { ok?: unknown; code?: unknown; error?: unknown } | null;
      const failed = typeof shaped === "object" && shaped !== null && shaped.ok === false;
      recordCall(name, "action", started, {
        ok: !failed,
        errorCode: failed ? errorCode({ code: shaped.code ?? shaped.error }) : undefined,
      });
      return result;
    } catch (error) {
      // Next.js signals redirect() and notFound() by throwing; those are not failures.
      const digest = (error as { digest?: unknown } | null)?.digest;
      const control = typeof digest === "string" && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
      recordCall(
        name,
        "action",
        started,
        control ? { ok: true } : { ok: false, errorCode: errorCode(error) },
      );
      throw error;
    }
  };
}

/**
 * A scheduled job: checks CRON_SECRET, runs it, records the run with its
 * result and duration, and answers Vercel Cron.
 */
export async function runCron(
  job: CronJob,
  request: Request,
  work: () => Promise<{ processed?: number; body?: Record<string, unknown> }>,
): Promise<Response> {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = performance.now();
  const elapsed = () => Math.min(86_400_000, Math.round(performance.now() - started));
  try {
    const { processed, body } = await work();
    await track(
      "cron_run",
      {
        job,
        ok: true,
        duration_ms: elapsed(),
        ...(processed !== undefined ? { processed: Math.max(0, Math.round(processed)) } : {}),
      },
      { userId: null },
    );
    return NextResponse.json({ ok: true, ...body });
  } catch (error) {
    console.error(`[cron] ${job} failed`, error);
    await track(
      "cron_run",
      { job, ok: false, duration_ms: elapsed(), error_code: errorCode(error) },
      { userId: null },
    );
    return NextResponse.json({ error: `${job}_failed` }, { status: 500 });
  }
}
