import { z } from "zod";
import { toE164 } from "@/lib/phone";

/**
 * Shared by the generate-contacts route and the form: request, limits, progress
 * events and what a Google error means.
 */

/** The analytics event of one Google request; the plan's limits sum its `saved`. */
export const USAGE_EVENT = "places_request";
/** Places Text Search returns at most 20 places a page and 3 pages for one query. */
export const PAGE_SIZE = 20;
export const MAX_PAGES = 3;
export const PER_REQUEST_MAX = PAGE_SIZE * MAX_PAGES;
export const INDUSTRY_MAX = 80;
export const LOCATION_MAX = 80;

export const generateSchema = z.object({
  industry: z.string().trim().min(1, "industryRequired").max(INDUSTRY_MAX, "tooLong"),
  location: z.string().trim().min(1, "locationRequired").max(LOCATION_MAX, "tooLong"),
  count: z.number().int().min(1, "countInvalid").max(PER_REQUEST_MAX, "countInvalid"),
});
export type GenerateInput = z.infer<typeof generateSchema>;

export type UsageWindow = { used: number; limit: number };
export type GenerationUsage = { daily: UsageWindow; monthly: UsageWindow };

/** The most contacts one request may ask for now: plan allowance left, and Google's cap. */
export function maxRequestable(usage: GenerationUsage): number {
  const left = Math.min(
    usage.daily.limit - usage.daily.used,
    usage.monthly.limit - usage.monthly.used,
  );
  return Math.max(0, Math.min(PER_REQUEST_MAX, left));
}

/** Asking Google, then sorting out duplicates and saving in one database call. */
export type GenerationPhase = "searching" | "saving";

/** Codes the form translates under `contacts.generate.errors`. */
export type GenerationErrorCode =
  | "notConfigured"
  | "apiDisabled"
  | "billing"
  | "keyInvalid"
  | "keyRestricted"
  | "quota"
  | "badRequest"
  | "googleUnavailable"
  | "network"
  | "limitReached"
  | "saveFailed"
  | "unknown";

/** One line of the NDJSON stream the route sends while it works. */
export type GenerationEvent =
  | { type: "phase"; phase: GenerationPhase; page: number; created: number; target: number }
  | {
      type: "done";
      created: number;
      duplicates: number;
      /** Google had no more places for this search before the target was met. */
      exhausted: boolean;
      usage: GenerationUsage;
    }
  | {
      type: "error";
      code: GenerationErrorCode;
      created: number;
      httpStatus?: number;
      googleMessage?: string;
      usage?: GenerationUsage;
    };

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { reason?: string; metadata?: Record<string, string> }[];
  };
};

export type GoogleFailure = {
  code: GenerationErrorCode;
  httpStatus: number;
  googleMessage: string;
  reason: string | null;
  googleStatus: string | null;
};

/**
 * Turns Google's error answer into something a person can act on. Google names
 * the cause in `details[].reason`; the message is the fallback.
 */
export function classifyGoogleError(httpStatus: number, body: unknown): GoogleFailure {
  const error = (body as GoogleErrorBody | null)?.error;
  const message = error?.message ?? "";
  const googleStatus = error?.status ?? null;
  const reason = error?.details?.find((detail) => detail.reason)?.reason ?? null;
  const text = `${reason ?? ""} ${googleStatus ?? ""} ${message}`.toLowerCase();

  let code: GenerationErrorCode;
  if (reason === "BILLING_DISABLED" || text.includes("billing")) {
    code = "billing";
  } else if (
    reason === "SERVICE_DISABLED" ||
    reason === "API_KEY_SERVICE_BLOCKED" ||
    text.includes("has not been used") ||
    text.includes("is disabled")
  ) {
    code = "apiDisabled";
  } else if (
    reason === "API_KEY_HTTP_REFERRER_BLOCKED" ||
    reason === "API_KEY_IP_ADDRESS_BLOCKED" ||
    reason === "API_KEY_ANDROID_APP_BLOCKED" ||
    reason === "API_KEY_IOS_APP_BLOCKED" ||
    text.includes("referer") ||
    text.includes("ip address")
  ) {
    code = "keyRestricted";
  } else if (reason === "API_KEY_INVALID" || text.includes("api key not valid")) {
    code = "keyInvalid";
  } else if (
    httpStatus === 429 ||
    googleStatus === "RESOURCE_EXHAUSTED" ||
    reason === "RATE_LIMIT_EXCEEDED"
  ) {
    code = "quota";
  } else if (httpStatus >= 500) {
    code = "googleUnavailable";
  } else if (httpStatus === 400) {
    code = "badRequest";
  } else {
    code = "unknown";
  }
  return { code, httpStatus, googleMessage: message, reason, googleStatus };
}

/** A place as the route passes it to the database. */
export type FoundPlace = {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  internationalPhoneNumber?: string;
  websiteUri?: string;
  formattedAddress?: string;
};

/** Places with an id and a name, phones in E.164; Google never returns e-mails. */
export function toFoundPlaces(places: unknown): FoundPlace[] {
  if (!Array.isArray(places)) return [];
  return (places as GooglePlace[]).flatMap((place) => {
    const name = place.displayName?.text?.trim();
    if (!place.id || !name) return [];
    return [
      {
        id: place.id,
        name,
        // Google sends the international form, so no country is needed to read it.
        phone: toE164(place.internationalPhoneNumber, null),
        website: place.websiteUri ?? null,
        address: place.formattedAddress ?? null,
      },
    ];
  });
}
