"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkerBillingVisible } from "@/features/plan/worker-billing-server";
import { measure } from "@/lib/analytics/instrument";
import { track } from "@/lib/analytics/track";
import { deliverEmail } from "@/lib/email/e2e-outbox";
import { COMPANY_PATH, INVITES_PATH } from "@/lib/routes";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { parseAccountTarget, parseInviteTarget, type InviteTarget } from "../invite-target";
import { inviteUrl } from "../logic";
import { workerInviteEmail, workerLeftEmail } from "./invite-emails";

/**
 * Joining and leaving a company (step 22.5), called from the app. The user
 * always comes from the session.
 *   * The owner invites in their own space: their own client creates the
 *     worker record and the code invite (row level security), then
 *     bindWorkerInvite() names the account behind a short id or e-mail
 *     (worker_invite_bind, service role) and e-mails the person.
 *   * The invitee answers (worker_invite_respond) and anybody may leave a
 *     company they work for (space_leave), both with their own client: the
 *     functions check who asks. The owner hears it in the app; a leave also
 *     by e-mail.
 * Failures come back as codes, never thrown.
 */

type Client = SupabaseClient<Database>;

export type InviteErrorCode =
  | "signedOut"
  | "ownerOnly"
  | "invalid"
  | "notFound"
  | "self"
  | "alreadyMember"
  | "readOnly"
  | "otherAccount"
  | "limited"
  | "unknown";

export type InviteResult<T> = { ok: true; data: T } | { ok: false; error: InviteErrorCode };

class InviteError extends Error {
  constructor(readonly code: InviteErrorCode) {
    super(code);
  }
}

/** Invites e-mailed by one owner in an hour at most; binding goes on beyond it, only the e-mail waits. */
const INVITE_EMAILS_PER_HOUR = 30;

async function signedIn(): Promise<{ supabase: Client; userId: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) throw new InviteError("signedOut");
  return { supabase, userId };
}

/** The owner working in their own space: only they take people on. */
async function owner(): Promise<{ supabase: Client; userId: string }> {
  const ctx = await signedIn();
  const { data: space, error } = await ctx.supabase.rpc("current_workspace_id");
  if (error) throw error;
  if (space !== ctx.userId) throw new InviteError("ownerOnly");
  return ctx;
}

function fromDatabase(error: { code?: string; message?: string }): InviteErrorCode | null {
  const message = error.message ?? "";
  if (message.includes("invite_invalid")) return "invalid";
  if (message.includes("invite_self")) return "self";
  if (message.includes("invite_other_account")) return "otherAccount";
  if (message.includes("already_member")) return "alreadyMember";
  if (message.includes("not_member")) return "notFound";
  if (message.includes("read_only")) return "readOnly";
  return null;
}

function run<T>(name: string, work: () => Promise<T>): Promise<InviteResult<T>> {
  return measure(`workers.invite.${name}`, async (): Promise<InviteResult<T>> => {
    try {
      return { ok: true, data: await work() };
    } catch (error) {
      if (error instanceof InviteError) return { ok: false, error: error.code };
      const known = fromDatabase(error as { code?: string; message?: string });
      if (known) return { ok: false, error: known };
      console.error(`invite action ${name} failed`, error);
      return { ok: false, error: "unknown" };
    }
  })();
}

/** The owner's company as the invitee sees it: name, owner's name, the owner's language. */
async function companyOf(admin: Client, ownerId: string) {
  const [profile, invoice, settings] = await Promise.all([
    admin.from("profiles").select("display_name, company_name").eq("id", ownerId).maybeSingle(),
    admin.from("invoice_profiles").select("name").eq("user_id", ownerId).maybeSingle(),
    admin.from("user_settings").select("locale").eq("user_id", ownerId).maybeSingle(),
  ]);
  return {
    company: profile.data?.company_name ?? invoice.data?.name ?? null,
    owner: profile.data?.display_name ?? null,
    locale: settings.data?.locale ?? null,
  };
}

async function accountContact(admin: Client, userId: string) {
  const [{ data: user }, { data: settings }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("user_settings").select("locale").eq("user_id", userId).maybeSingle(),
  ]);
  return { email: user.user?.email ?? null, locale: settings?.locale ?? null };
}

/**
 * The account a short id, username or e-mail names, or null. Exact only; a
 * short id that names nobody is tried as a username of the same letters, as
 * invite_account_lookup() does.
 */
async function accountOf(admin: Client, target: InviteTarget): Promise<string | null> {
  if (target.kind === "email") {
    const { data, error } = await admin.rpc("account_by_email", { _email: target.email });
    if (error) throw error;
    return data ?? null;
  }
  if (target.kind === "id") {
    const { data, error } = await admin.rpc("account_by_public_id", { _public_id: target.publicId });
    if (error) throw error;
    if (data) return data;
    // Six letters of the short id alphabet are a username too ("abc234").
    const { data: byName, error: nameError } = await admin.rpc("account_by_username", {
      _username: target.publicId.toLowerCase(),
    });
    if (nameError) throw nameError;
    return byName ?? null;
  }
  const { data, error } = await admin.rpc("account_by_username", { _username: target.username });
  if (error) throw error;
  return data ?? null;
}

async function findAccount(admin: Client, value: string): Promise<string | null> {
  const parsed = parseInviteTarget(value);
  if (!parsed.ok) throw new InviteError("invalid");
  return accountOf(admin, parsed.target);
}

/** The owner already has this account in the company, or an open invite for it. */
async function alreadyInCompany(supabase: Client, ownerId: string, account: string): Promise<boolean> {
  // Their own client: the owner reads their workers and invites (row level security).
  const [taken, waiting] = await Promise.all([
    supabase
      .from("workers")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("user_id", account)
      .neq("status", "inactive")
      .limit(1),
    supabase
      .from("worker_invites")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("invitee_id", account)
      .is("accepted_at", null)
      .is("declined_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1),
  ]);
  if (taken.error) throw taken.error;
  if (waiting.error) throw waiting.error;
  return taken.data.length > 0 || waiting.data.length > 0;
}

/** E-mails an invite: the outbox for the tests' accounts, nothing for other internal addresses. */
async function mailInvite(
  to: string,
  mail: { subject: string; text: string; html: string },
  kind: "worker_invite" | "worker_left" = "worker_invite",
): Promise<boolean> {
  const sent = await deliverEmail({ kind, to, ...mail });
  if (!sent.ok && sent.error !== "internal address") console.error("[workers] invite e-mail failed", sent.error);
  return sent.ok;
}

// ---------------------------------------------------------------------------
// The owner
// ---------------------------------------------------------------------------

/**
 * Before the worker record exists: whether a short id or username names
 * somebody who can be invited. Nothing about the account comes back.
 */
export async function checkInviteAccount(value: string): Promise<InviteResult<true>> {
  return run("check", async () => {
    const { supabase, userId } = await owner();
    const parsed = parseAccountTarget(typeof value === "string" ? value : "");
    if (!parsed.ok) throw new InviteError("invalid");
    const account = await accountOf(createAdminClient(), parsed.target);
    if (!account) throw new InviteError("notFound");
    if (account === userId) throw new InviteError("self");
    if (await alreadyInCompany(supabase, userId, account)) throw new InviteError("alreadyMember");
    return true as const;
  });
}

/** Who the owner found to invite (28.1): what the card shows, nothing else. */
export type FoundAccount = {
  name: string | null;
  avatarUrl: string | null;
  username: string | null;
};

/**
 * The owner looks somebody up to invite by @username or short id: an exact
 * match only, never a list of people, at most 10 misses and 40 searches an
 * hour (invite_account_lookup). The card shows their photo, name and
 * username; it says nothing about anybody who cannot be invited.
 */
export async function lookupInviteAccount(value: string): Promise<InviteResult<FoundAccount>> {
  return run("lookup", async () => {
    const { supabase, userId } = await owner();
    const parsed = parseAccountTarget(typeof value === "string" ? value.slice(0, 64) : "");
    if (!parsed.ok) throw new InviteError("invalid");
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("invite_account_lookup", {
      _actor: userId,
      _value: value.trim(),
    });
    if (error) throw error;
    const result = (data ?? {}) as {
      outcome?: string;
      id?: string;
      name?: string | null;
      avatar_url?: string | null;
      username?: string | null;
    };
    const outcome =
      result.outcome === "found" || result.outcome === "not_found" || result.outcome === "limited"
        ? result.outcome
        : "invalid";
    await track("worker_invite_lookup", { outcome, kind: parsed.target.kind }, { userId, admin });
    if (outcome === "limited") throw new InviteError("limited");
    if (outcome === "invalid") throw new InviteError("invalid");
    if (outcome === "not_found" || !result.id) throw new InviteError("notFound");
    if (result.id === userId) throw new InviteError("self");
    if (await alreadyInCompany(supabase, userId, result.id)) throw new InviteError("alreadyMember");
    return {
      name: result.name ?? null,
      avatarUrl: result.avatar_url ?? null,
      username: result.username ?? null,
    };
  });
}

export type BindOutcome = {
  /** The invite waits for an existing account in the app; false = a link for a new person. */
  bound: boolean;
  /** The person got the invite by e-mail too (never for test addresses or past the hourly cap). */
  emailed: boolean;
};

/**
 * After the owner's client made the worker record and its code invite: names
 * the account of a short id or e-mail (an invite waiting in the app, with an
 * e-mail to that account), or, for an e-mail without an account, mails the
 * registration link. A short id without an account is refused.
 */
export async function bindWorkerInvite(input: {
  inviteId: string;
  target: string;
  locale?: string;
}): Promise<InviteResult<BindOutcome>> {
  return run("bind", async () => {
    const { supabase, userId } = await owner();
    const parsed = parseInviteTarget(input.target ?? "");
    if (!parsed.ok || typeof input.inviteId !== "string") throw new InviteError("invalid");
    // The invite must be this owner's own, read with their client.
    const { data: invite, error } = await supabase
      .from("worker_invites")
      .select("id, code, worker_id, accepted_at")
      .eq("id", input.inviteId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!invite || invite.accepted_at) throw new InviteError("invalid");
    const { data: worker } = await supabase
      .from("workers")
      .select("job_title")
      .eq("id", invite.worker_id)
      .eq("owner_id", userId)
      .maybeSingle();

    const admin = createAdminClient();
    const account = await findAccount(admin, input.target);
    if (!account && parsed.target.kind !== "email") throw new InviteError("notFound");

    let bound = false;
    if (account) {
      const { data: result, error: bindError } = await admin.rpc("worker_invite_bind", {
        _owner: userId,
        _invite: invite.id,
        _invitee: account,
      });
      if (bindError) throw bindError;
      if (result === "self") throw new InviteError("self");
      if (result === "already_member") throw new InviteError("alreadyMember");
      if (result !== "bound") throw new InviteError("invalid");
      bound = true;
    }

    // The e-mail is a courtesy: a failure or the hourly cap leaves the invite as it is.
    let emailed = false;
    const { count } = await admin
      .from("worker_invites")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) <= INVITE_EMAILS_PER_HOUR) {
      const origin = await siteOrigin().catch(() => null);
      const from = await companyOf(admin, userId);
      const contact = account
        ? await accountContact(admin, account)
        : { email: parsed.target.kind === "email" ? parsed.target.email : null, locale: null };
      const locale = contact.locale ?? input.locale ?? from.locale;
      if (contact.email) {
        const mail = workerInviteEmail(
          {
            company: from.company,
            owner: from.owner,
            jobTitle: worker?.job_title ?? null,
            url: origin ? (account ? `${origin}${INVITES_PATH}` : inviteUrl(invite.code, origin, locale ?? undefined)) : null,
            forAccount: Boolean(account),
            billingVisible: await loadWorkerBillingVisible(admin),
          },
          locale,
        );
        emailed = await mailInvite(contact.email, mail);
      }
    }
    return { bound, emailed };
  });
}

/**
 * A fresh invite for the account an earlier, expired or declined invite of
 * the same worker record named: the owner's client made the new invite row,
 * this binds it to that account (as bindWorkerInvite does for a short id)
 * and e-mails them, so the owner never has to remove the person and invite
 * them again (which made a second record).
 */
export async function renewAccountInvite(input: {
  inviteId: string;
  previousInviteId: string;
  locale?: string;
}): Promise<InviteResult<BindOutcome>> {
  return run("bind", async () => {
    const { supabase, userId } = await owner();
    if (typeof input.inviteId !== "string" || typeof input.previousInviteId !== "string") {
      throw new InviteError("invalid");
    }
    const { data: rows, error } = await supabase
      .from("worker_invites")
      .select("id, code, worker_id, invitee_id, accepted_at")
      .eq("owner_id", userId)
      .in("id", [input.inviteId, input.previousInviteId]);
    if (error) throw error;
    const fresh = rows?.find((row) => row.id === input.inviteId);
    const previous = rows?.find((row) => row.id === input.previousInviteId);
    if (!fresh || !previous || fresh.accepted_at || !previous.invitee_id || fresh.worker_id !== previous.worker_id) {
      throw new InviteError("invalid");
    }
    const admin = createAdminClient();
    const { data: result, error: bindError } = await admin.rpc("worker_invite_bind", {
      _owner: userId,
      _invite: fresh.id,
      _invitee: previous.invitee_id,
    });
    if (bindError) throw bindError;
    if (result === "self") throw new InviteError("self");
    if (result === "already_member") throw new InviteError("alreadyMember");
    if (result !== "bound") throw new InviteError("invalid");

    let emailed = false;
    const { data: worker } = await supabase
      .from("workers")
      .select("job_title")
      .eq("id", fresh.worker_id)
      .eq("owner_id", userId)
      .maybeSingle();
    const origin = await siteOrigin().catch(() => null);
    const from = await companyOf(admin, userId);
    const contact = await accountContact(admin, previous.invitee_id);
    if (contact.email) {
      const mail = workerInviteEmail(
        {
          company: from.company,
          owner: from.owner,
          jobTitle: worker?.job_title ?? null,
          url: origin ? `${origin}${INVITES_PATH}` : null,
          forAccount: true,
          billingVisible: await loadWorkerBillingVisible(admin),
        },
        contact.locale ?? input.locale ?? from.locale,
      );
      emailed = await mailInvite(contact.email, mail);
    }
    return { bound: true, emailed };
  });
}

// ---------------------------------------------------------------------------
// The invitee and the worker
// ---------------------------------------------------------------------------

/** Accepts or declines an invite naming the signed-in account; the company's space comes back. */
export async function respondToInvite(input: {
  inviteId: string;
  accept: boolean;
}): Promise<InviteResult<{ spaceId: string }>> {
  return run("respond", async () => {
    const { supabase, userId } = await signedIn();
    if (typeof input.inviteId !== "string" || typeof input.accept !== "boolean") {
      throw new InviteError("invalid");
    }
    const { data: spaceId, error } = await supabase.rpc("worker_invite_respond", {
      _invite: input.inviteId,
      _accept: input.accept,
    });
    if (error) throw error;
    const admin = createAdminClient();
    if (input.accept) await track("worker_invite_accepted", { via: "app" }, { userId, admin });
    else await track("worker_invite_declined", {}, { userId, admin });
    return { spaceId: spaceId as string };
  });
}

/**
 * Answers the invite of a link the signed-in account opened (27.1): the
 * database checks it is meant for this account (its e-mail, or the account
 * it names; an invite naming nobody only accepts) and binds it on the way.
 */
export async function respondToInviteCode(input: {
  code: string;
  accept: boolean;
}): Promise<InviteResult<{ spaceId: string }>> {
  return run("respondCode", async () => {
    const { supabase, userId } = await signedIn();
    if (typeof input.code !== "string" || typeof input.accept !== "boolean" || input.code.length > 64) {
      throw new InviteError("invalid");
    }
    const { data: spaceId, error } = await supabase.rpc("worker_invite_respond_code", {
      _code: input.code.trim(),
      _accept: input.accept,
    });
    if (error) throw error;
    const admin = createAdminClient();
    if (input.accept) await track("worker_invite_accepted", { via: "app" }, { userId, admin });
    else await track("worker_invite_declined", {}, { userId, admin });
    return { spaceId: spaceId as string };
  });
}

/**
 * The signed-in worker leaves a company. The owner hears it in the app and by
 * e-mail (never to a test address).
 */
export async function leaveCompany(spaceId: string): Promise<InviteResult<true>> {
  return run("leave", async () => {
    const { supabase, userId } = await signedIn();
    if (typeof spaceId !== "string" || spaceId === userId) throw new InviteError("invalid");
    const { data: workerId, error } = await supabase.rpc("space_leave", { _space: spaceId });
    if (error) throw error;
    const admin = createAdminClient();
    await track("space_left", {}, { userId, admin });

    const [{ data: worker }, contact, from, origin] = await Promise.all([
      admin.from("workers").select("name").eq("id", workerId as string).eq("owner_id", spaceId).maybeSingle(),
      accountContact(admin, spaceId),
      companyOf(admin, spaceId),
      siteOrigin().catch(() => null),
    ]);
    if (worker && contact.email) {
      const mail = workerLeftEmail(
        { worker: worker.name, company: from.company, url: origin ? `${origin}${COMPANY_PATH}` : null },
        contact.locale,
      );
      await mailInvite(contact.email, mail, "worker_left");
    }
    return true as const;
  });
}
