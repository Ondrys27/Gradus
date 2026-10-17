import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import type { Database } from "../../../src/types/database";
import { requiredEnv } from "./env";
import type { Locale } from "./i18n";
import { waitForApp } from "./ui";

type Db = SupabaseClient<Database>;

/** Every account the tests make ends with this, so they count as internal and are easy to clean up. */
export const E2E_DOMAIN = "gradus.local";
const E2E_PREFIX = "e2e-";

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

let adminClient: Db | null = null;

/** The secret key client: only for creating, preparing and removing the test accounts. */
export function admin(): Db {
  adminClient ??= createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: noSession },
  );
  return adminClient;
}

/** A signed-in client with the public key, exactly like the browser. */
export async function userClient(email: string, password: string): Promise<Db> {
  const client = createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: noSession },
  );
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

export function e2eEmail(label: string) {
  return `${E2E_PREFIX}${label}-${randomUUID().slice(0, 8)}@${E2E_DOMAIN}`;
}

export function e2ePassword() {
  return `E2e-${randomUUID()}`;
}

export type Account = {
  id: string;
  email: string;
  password: string;
  locale: Locale;
  mode: "game" | "tool";
};

export type AccountOptions = {
  label: string;
  locale?: Locale;
  mode?: "game" | "tool";
  /** Finished onboarding and tour (default), or a brand-new account. */
  onboarded?: boolean;
  timezone?: string;
};

/** Sections a game-mode test account gets right away, so a test does not have to play the path first. */
const SECTION_UNLOCKS = [
  "section_contacts",
  "section_cold_calling",
  "section_pipeline",
  "section_calendar",
  "section_finance",
  "section_workers",
];

/**
 * A beta account, made the way an invited registration makes it (the
 * database trigger plus grant_beta_plan), ready to sign in.
 */
export async function createAccount(options: AccountOptions): Promise<Account> {
  const locale = options.locale ?? "cs";
  const mode = options.mode ?? "tool";
  const email = e2eEmail(options.label);
  const password = e2ePassword();
  const db = admin();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { locale },
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const id = data.user.id;
  const account: Account = { id, email, password, locale, mode };
  try {
    const beta = await db.rpc("grant_beta_plan", { _user_id: id });
    if (beta.error) throw beta.error;
    const settings = await db
      .from("user_settings")
      .update({
        locale,
        timezone: options.timezone ?? "Europe/Prague",
        country_code: "CZ",
        currency: "CZK",
        // Proactive Jarvis would fly in on its own schedule and cover what a test clicks.
        jarvis_proactive: false,
      })
      .eq("user_id", id);
    if (settings.error) throw settings.error;
    if (options.onboarded !== false) {
      const now = new Date().toISOString();
      const profile = await db
        .from("profiles")
        .update({
          display_name: `E2E ${options.label}`,
          industry: "other",
          mode,
          onboarding_completed_at: now,
          tour_completed_at: now,
          // Jarvis's one-time Notes introduction would fly in over what a test clicks.
          notes_intro_seen_at: now,
        })
        .eq("id", id);
      if (profile.error) throw profile.error;
      if (mode === "game") {
        const unlocks = await db
          .from("unlocks")
          .upsert(
            SECTION_UNLOCKS.map((key) => ({ user_id: id, key, seen_at: now })),
            { onConflict: "user_id,key" },
          );
        if (unlocks.error) throw unlocks.error;
      }
    }
  } catch (setupError) {
    await deleteAccount(id);
    throw setupError;
  }
  return account;
}

/** Removes an account with everything it owns (the foreign keys cascade). */
export async function deleteAccount(id: string) {
  const { error } = await admin().auth.admin.deleteUser(id);
  if (error && !/not.?found/i.test(error.message)) throw error;
}

/** Removes the account with this address, if it exists (accounts made through the UI). */
export async function deleteAccountByEmail(email: string) {
  const user = await findUserByEmail(email);
  if (user) await deleteAccount(user.id);
}

export async function findUserByEmail(email: string) {
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Removes every test account left behind by an interrupted run. */
export async function deleteLeftoverAccounts() {
  const leftovers: string[] = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) {
      const address = user.email?.toLowerCase() ?? "";
      if (address.startsWith(E2E_PREFIX) && address.endsWith(`@${E2E_DOMAIN}`)) {
        leftovers.push(user.id);
      }
    }
    if (data.users.length < 200) break;
  }
  for (const id of leftovers) await deleteAccount(id);
  return leftovers.length;
}

/** Signs in through the login form, like a person. */
export async function signIn(page: Page, account: Pick<Account, "email" | "password" | "locale">) {
  await page.goto(account.locale === "en" ? "/en/login" : "/prihlaseni");
  await page.locator("#login-email").fill(account.email);
  await page.locator("#login-password").fill(account.password);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/app(\/?$|\?)/, { timeout: 30_000 });
  await waitForApp(page);
}

/** Rows the account adds itself, through RLS with the public key, as the app would. */
export async function seedContacts(
  account: Account,
  rows: { company_name?: string; first_name?: string; last_name?: string; phone?: string }[],
) {
  const client = await userClient(account.email, account.password);
  const { data, error } = await client
    .from("contacts")
    .insert(rows.map((row) => ({ ...row, user_id: account.id })))
    .select("id, company_name");
  if (error) throw error;
  await client.auth.signOut();
  return data;
}

/** Runs setup queries as the account itself (public key, RLS), then signs out. */
export async function asUser<T>(account: Account, run: (client: Db) => Promise<T>): Promise<T> {
  const client = await userClient(account.email, account.password);
  try {
    return await run(client);
  } finally {
    await client.auth.signOut();
  }
}
