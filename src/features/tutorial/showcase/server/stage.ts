import "server-only";
import { randomBytes } from "node:crypto";
import { createClient as createPlainClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Locale } from "@/i18n/locales";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/env";
import { STAGE_EMAIL, stagePresenter } from "../access";
import { seedStage } from "./seed";

type Db = SupabaseClient<Database>;

/**
 * The showcase's stage (step 27.4): a throw-away internal account
 * (showcase-…@gradus.local) the server makes for one showcase, fills with
 * sample data and signs the browser into, so the canvas never shows the
 * presenter's own account. It is deleted with everything in it when the
 * showcase ends (or Esc); a stage left behind (a closed tab) goes when the
 * same presenter starts the next one, or after STALE_MS when anybody does.
 */

const STALE_MS = 6 * 60 * 60_000;
const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export type StageAccount = { id: string; email: string; password: string };

/** Every stage account there is, with who made it and when. */
async function listStages(admin: Db) {
  const found: { id: string; by: string | null; at: number }[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      if (!user.email || !STAGE_EMAIL.test(user.email)) continue;
      const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
      if (meta.showcase_stage !== true) continue;
      found.push({
        id: user.id,
        by: stagePresenter(meta),
        at: Date.parse(String(meta.showcase_at ?? user.created_at)) || 0,
      });
    }
    if (data.users.length < 1000) break;
  }
  return found;
}

async function deleteAccount(admin: Db, id: string) {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error && !/not.?found/i.test(error.message)) throw error;
}

/**
 * Deletes a stage account with its colleague (the worker account the
 * company scenario shows); their rows go with them (the foreign keys
 * cascade). Only accounts that are stages themselves are touched.
 */
export async function deleteStage(admin: Db, id: string) {
  const { data: workers } = await admin
    .from("workers")
    .select("user_id")
    .eq("owner_id", id)
    .not("user_id", "is", null)
    .limit(20);
  for (const worker of workers ?? []) {
    if (!worker.user_id) continue;
    const { data } = await admin.auth.admin.getUserById(worker.user_id);
    const user = data?.user;
    if (user?.email && STAGE_EMAIL.test(user.email) && user.app_metadata?.showcase_stage === true) {
      await deleteAccount(admin, user.id);
    }
  }
  await deleteAccount(admin, id);
}

/** The presenter's earlier stages and anybody's stale ones. */
export async function sweepStages(admin: Db, presenterId: string, now = Date.now()) {
  const stages = await listStages(admin);
  const gone = stages.filter((stage) => stage.by === presenterId || now - stage.at > STALE_MS);
  for (const stage of gone) await deleteStage(admin, stage.id);
  return gone.length;
}

/**
 * For the daily Grady jobs: deletes stages older than STALE_MS (a closed tab,
 * a broken recording, a switch turned off mid-show) and returns the ids of
 * the ones still playing, which the jobs skip: a stage never calls the model.
 */
export async function sweepStaleStages(admin: Db, now = Date.now()): Promise<Set<string>> {
  const live = new Set<string>();
  for (const stage of await listStages(admin)) {
    if (now - stage.at <= STALE_MS) {
      live.add(stage.id);
      continue;
    }
    try {
      await deleteStage(admin, stage.id);
    } catch (error) {
      console.error("showcase stage sweep failed", error);
      live.add(stage.id);
    }
  }
  return live;
}

/** A stage of this presenter's, made now, filled, ready to sign in to. */
export async function createStage(input: {
  presenterId: string;
  locale: Locale;
  admin?: Db;
}): Promise<StageAccount> {
  const admin = input.admin ?? createAdminClient();
  await sweepStages(admin, input.presenterId);

  const tag = randomBytes(5).toString("hex");
  const email = `showcase-${tag}@gradus.local`;
  const password = `Sc-${randomBytes(18).toString("base64url")}`;
  const appMetadata = {
    showcase_stage: true,
    showcase_by: input.presenterId,
    showcase_at: new Date().toISOString(),
  };
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { locale: input.locale },
    app_metadata: appMetadata,
  });
  if (error || !data.user) throw error ?? new Error("showcase: createUser returned no user");
  const id = data.user.id;
  let colleague: string | null = null;
  try {
    // The colleague of the company scenario: a real account, so tasks and messages reach them.
    const worker = await admin.auth.admin.createUser({
      email: `showcase-${tag}-team@gradus.local`,
      password: `Sc-${randomBytes(18).toString("base64url")}`,
      email_confirm: true,
      user_metadata: { locale: input.locale },
      app_metadata: { ...appMetadata, showcase_owner: id },
    });
    if (worker.error || !worker.data.user) throw worker.error ?? new Error("showcase: no colleague");
    colleague = worker.data.user.id;
    // Like an invited registration: no trial, the beta plan.
    const beta = await admin.rpc("grant_beta_plan", { _user_id: id });
    if (beta.error) throw beta.error;
    const client = createPlainClient<Database>(supabaseUrl(), supabasePublicKey(), { auth: noSession });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    try {
      await seedStage({ admin, client, userId: id, workerUserId: colleague, locale: input.locale });
    } finally {
      await client.auth.signOut().catch(() => undefined);
    }
  } catch (setupError) {
    if (colleague) await deleteAccount(admin, colleague).catch(() => undefined);
    await deleteStage(admin, id).catch(() => undefined);
    throw setupError;
  }
  return { id, email, password };
}

/**
 * A one-time sign-in for the stage, used right away by the route's own
 * client (which sets the session cookies): the token never leaves the server.
 */
export async function stageSignInToken(admin: Db, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const token = data.properties?.hashed_token;
  if (!token) throw new Error("showcase: no sign-in token");
  return token;
}
