"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isTestAddress } from "@/features/feedback/server/notify";
import { measure } from "@/lib/analytics/instrument";
import { track } from "@/lib/analytics/track";
import { sendEmail } from "@/lib/email/resend";
import { COMPANY_PATH, INVITES_PATH } from "@/lib/routes";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { parseInviteTarget } from "../invite-target";
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

/** The account a short id or e-mail names, or null. */
async function findAccount(admin: Client, value: string): Promise<string | null> {
  const parsed = parseInviteTarget(value);
  if (!parsed.ok) throw new InviteError("invalid");
  const { data, error } =
    parsed.target.kind === "id"
      ? await admin.rpc("account_by_public_id", { _public_id: parsed.target.publicId })
      : await admin.rpc("account_by_email", { _email: parsed.target.email });
  if (error) throw error;
  return data ?? null;
}

// ---------------------------------------------------------------------------
// The owner
// ---------------------------------------------------------------------------

/**
 * Before the worker record exists: whether a short id names somebody who can
 * be invited. Nothing about the account comes back, not even its name.
 */
export async function checkInviteAccount(publicId: string): Promise<InviteResult<true>> {
  return run("check", async () => {
    const { supabase, userId } = await owner();
    const parsed = parseInviteTarget(publicId);
    if (!parsed.ok || parsed.target.kind !== "id") throw new InviteError("invalid");
    const admin = createAdminClient();
    const account = await findAccount(admin, parsed.target.publicId);
    if (!account) throw new InviteError("notFound");
    if (account === userId) throw new InviteError("self");
    // Their own client: the owner reads their workers and invites (row level security).
    const [taken, waiting] = await Promise.all([
      supabase
        .from("workers")
        .select("id")
        .eq("owner_id", userId)
        .eq("user_id", account)
        .neq("status", "inactive")
        .limit(1),
      supabase
        .from("worker_invites")
        .select("id")
        .eq("owner_id", userId)
        .eq("invitee_id", account)
        .is("accepted_at", null)
        .is("declined_at", null)
        .gt("expires_at", new Date().toISOString())
        .limit(1),
    ]);
    if (taken.error) throw taken.error;
    if (waiting.error) throw waiting.error;
    if (taken.data.length || waiting.data.length) throw new InviteError("alreadyMember");
    return true as const;
  });
}

export type BindOutcome = {
  /** The invite waits for an existing account in the app; false = a link for a new person. */
  bound: boolean;
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
    if (!account && parsed.target.kind === "id") throw new InviteError("notFound");

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
      if (contact.email && !isTestAddress(contact.email)) {
        const mail = workerInviteEmail(
          {
            company: from.company,
            owner: from.owner,
            jobTitle: worker?.job_title ?? null,
            url: origin ? (account ? `${origin}${INVITES_PATH}` : inviteUrl(invite.code, origin, locale ?? undefined)) : null,
            forAccount: Boolean(account),
          },
          locale,
        );
        const sent = await sendEmail({ to: contact.email, ...mail });
        if (!sent.ok) console.error("[workers] invite e-mail failed", sent.error);
      }
    }
    return { bound };
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
    if (worker && contact.email && !isTestAddress(contact.email)) {
      const mail = workerLeftEmail(
        { worker: worker.name, company: from.company, url: origin ? `${origin}${COMPANY_PATH}` : null },
        contact.locale,
      );
      const sent = await sendEmail({ to: contact.email, ...mail });
      if (!sent.ok) console.error("[workers] leave e-mail failed", sent.error);
    }
    return true as const;
  });
}
