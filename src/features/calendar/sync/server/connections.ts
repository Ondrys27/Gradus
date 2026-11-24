import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureServerError } from "@/features/errors/alerts/server/capture";
import {
  decryptSecret,
  encryptSecret,
  hasEncryptionKey,
} from "@/features/scheduler/server/crypto";
import type { Database } from "@/types/database";
import { createAppleProvider } from "../providers/apple";
import { createGoogleProvider, type GoogleClient, type GoogleTokens } from "../providers/google";
import type { CalendarProvider, Fetcher, ProviderKey } from "../types";

type Admin = SupabaseClient<Database>;

/**
 * A person's connections (28.10): their secrets sealed with
 * INTEGRATIONS_ENCRYPTION_KEY (Google's tokens, the Apple ID with its
 * app-specific password) and the provider made from them. Server only; the
 * secret column is never in the client's grants.
 */

export type GoogleSecret = { kind: "google" } & GoogleTokens;
export type AppleSecret = { kind: "apple"; username: string; password: string; homeUrl: string | null };
export type ConnectionSecret = GoogleSecret | AppleSecret;

export function sealConnectionSecret(secret: ConnectionSecret): string {
  return encryptSecret(JSON.stringify(secret));
}

export function openConnectionSecret(cipher: string): ConnectionSecret | null {
  try {
    const value = JSON.parse(decryptSecret(cipher)) as Record<string, unknown>;
    if (
      value.kind === "google" &&
      typeof value.accessToken === "string" &&
      typeof value.refreshToken === "string" &&
      typeof value.expiresAt === "number"
    ) {
      return {
        kind: "google",
        accessToken: value.accessToken,
        refreshToken: value.refreshToken,
        expiresAt: value.expiresAt,
      };
    }
    if (value.kind === "apple" && typeof value.username === "string" && typeof value.password === "string") {
      return {
        kind: "apple",
        username: value.username,
        password: value.password,
        homeUrl: typeof value.homeUrl === "string" ? value.homeUrl : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Google's OAuth client from the environment; null when it is not set up on this server. */
export function googleClient(): GoogleClient | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** What this server can do: the key for secrets, and Google's client. Apple needs only the key. */
export function syncConfiguration(): { key: boolean; google: boolean; apple: boolean } {
  const key = hasEncryptionKey();
  return { key, google: key && googleClient() !== null, apple: key };
}

/**
 * The person sees "Calendar connections are not available now"; the owner
 * finds the reason in the error log (and in Administration → Health).
 */
export function reportMissingConfiguration(
  what: "key" | "google",
  context: { userId: string | null; action: string; page?: string },
): void {
  const message =
    what === "key"
      ? "INTEGRATIONS_ENCRYPTION_KEY is missing or invalid on the server: calendar connections and subscribed calendars cannot store their secrets. Add the key (32 random bytes, openssl rand -base64 32) in Vercel → Settings → Environment Variables and redeploy."
      : "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing on the server: Google Calendar cannot be connected. Add them in Vercel → Settings → Environment Variables and redeploy (docs/google-overeni.md).";
  captureServerError(new Error(message), {
    source: "action",
    page: context.page ?? "/app/nastaveni/kalendar",
    action: context.action,
    userId: context.userId,
  });
}

export type ConnectionRow = {
  id: string;
  user_id: string;
  provider: string;
  secret_cipher: string;
};

export const fetcher: Fetcher = (url, init) => fetch(url, { ...init, cache: "no-store" });

/** The provider of a connection; null when its secret cannot be opened (key changed). */
export function providerOf(
  admin: Admin,
  connection: ConnectionRow,
  timeZone: string,
  fetch: Fetcher = fetcher,
): CalendarProvider | null {
  const secret = openConnectionSecret(connection.secret_cipher);
  if (!secret) return null;
  if (secret.kind === "google" && connection.provider === "google") {
    const client = googleClient();
    if (!client) return null;
    return createGoogleProvider({
      tokens: secret,
      client,
      fetcher: fetch,
      timeZone,
      onTokens: async (tokens) => {
        const { error } = await admin
          .from("calendar_connections")
          .update({ secret_cipher: sealConnectionSecret({ kind: "google", ...tokens }) })
          .eq("id", connection.id)
          .eq("user_id", connection.user_id);
        if (error) console.error("[calendar-sync] storing refreshed tokens failed", error.code);
      },
    });
  }
  if (secret.kind === "apple" && connection.provider === "apple") {
    return createAppleProvider({
      username: secret.username,
      password: secret.password,
      homeUrl: secret.homeUrl ?? undefined,
      fetcher: fetch,
      timeZone,
    });
  }
  return null;
}

export async function timeZoneOf(admin: Admin, userId: string): Promise<string> {
  const { data } = await admin.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle();
  return data?.timezone || "Europe/Prague";
}

export function providerKeyOf(value: string): ProviderKey {
  return value === "apple" ? "apple" : "google";
}
