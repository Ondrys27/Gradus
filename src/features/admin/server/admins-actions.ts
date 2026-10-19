"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml, sendEmail } from "@/lib/email/resend";
import { formatDateTime } from "@/lib/format";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_INVITE_PATH, ADMIN_PATH } from "../access";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import {
  generateInviteToken,
  hashInviteToken,
  inviteState,
  isWellFormedInviteToken,
} from "../invite-token";
import { logAdminAction } from "./audit";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * The owner's actions in the Administrators section. Each checks the owner's
 * admin session first; the database function checks it again from the
 * signed token, makes the change and writes admin_audit in one transaction.
 */

const SECTION_PATH = `${ADMIN_PATH}/administratori`;

type Failure = { ok: false; error: "forbidden" | "invalid" | "failed" };

async function ipHash(): Promise<string> {
  const { ip } = await requestInfo();
  return fingerprint("ip", ip);
}

function refused(error: { code?: string; message: string }, what: string): Failure {
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  if (error.code === "22023") return { ok: false, error: "invalid" };
  console.error(`[admin] ${what} failed`, error.message);
  return { ok: false, error: "failed" };
}

const inviteSchema = z.object({
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(254)]).default(""),
  note: z.string().trim().max(200).default(""),
});

/**
 * A new invitation. The token goes back to the owner once, as a link; the
 * database keeps only its hash, so the link can never be shown again.
 */
export async function createAdminInvite(input: {
  email?: string;
  note?: string;
}): Promise<{ ok: true; id: string; url: string; expiresAt: string } | Failure> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("manageAdmins"))) return { ok: false, error: "forbidden" };

  const token = generateInviteToken();
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("admin_invite_create", {
    _token_hash: hashInviteToken(token),
    _email: parsed.data.email || undefined,
    _note: parsed.data.note || undefined,
    _ip_hash: await ipHash(),
  });
  if (error || !id) return refused(error ?? { message: "no id" }, "creating an invitation");
  revalidatePath(SECTION_PATH);
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return { ok: true, id, url: `${await siteOrigin()}${ADMIN_INVITE_PATH}/${token}`, expiresAt };
}

/**
 * Sends the link to the e-mail given with the invitation. The owner's page
 * still holds the token; it must match the stored hash of an open invitation.
 */
export async function sendAdminInviteEmail(
  id: string,
  token: string,
): Promise<{ ok: true } | Failure> {
  if (!z.uuid().safeParse(id).success || !isWellFormedInviteToken(token)) {
    return { ok: false, error: "invalid" };
  }
  const context = await adminAccessFor("manageAdmins");
  if (!context) return { ok: false, error: "forbidden" };

  const { data: invite, error } = await createAdminClient()
    .from("admin_invites")
    .select("email, token_hash, accepted_at, revoked_at, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return refused(error, "reading an invitation");
  if (
    !invite?.email ||
    invite.token_hash !== hashInviteToken(token) ||
    inviteState(invite) !== "open"
  ) {
    return { ok: false, error: "invalid" };
  }

  const t = serverTranslator(await getLocale());
  const values = {
    appName: APP_NAME,
    url: `${await siteOrigin()}${ADMIN_INVITE_PATH}/${token}`,
    expires: formatDateTime(new Date(invite.expires_at), ADMIN_FORMAT_SETTINGS),
  };
  const lines = [
    t("admin.inviteEmail.intro", values),
    t("admin.inviteEmail.link", values),
    t("admin.inviteEmail.expires", values),
    t("admin.inviteEmail.ignore", values),
  ];
  const sent = await sendEmail({
    to: invite.email,
    subject: t("admin.inviteEmail.subject", values),
    text: [lines[0], "", values.url, "", lines[2], "", lines[3]].join("\n"),
    html: `<p>${escapeHtml(lines[0])}</p>
<p><a href="${escapeHtml(values.url)}">${escapeHtml(lines[1])}</a></p>
<p>${escapeHtml(lines[2])}</p>
<p>${escapeHtml(lines[3])}</p>`,
  });
  if (!sent.ok) {
    console.error("[admin] invitation e-mail failed", sent.error);
    return { ok: false, error: "failed" };
  }
  await logAdminAction(context, "update", "admins.invite_email");
  return { ok: true };
}

export async function revokeAdminInvite(id: string): Promise<{ ok: true } | Failure> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("manageAdmins"))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_invite_revoke", { _id: id, _ip_hash: await ipHash() });
  if (error) return refused(error, "revoking an invitation");
  revalidatePath(SECTION_PATH);
  return { ok: true };
}

/** Takes the role away; the database ends that admin's live session at once. */
export async function removeAdmin(userId: string): Promise<{ ok: true } | Failure> {
  if (!z.uuid().safeParse(userId).success) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("manageAdmins"))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_remove", { _user_id: userId, _ip_hash: await ipHash() });
  if (error) return refused(error, "removing an admin");
  revalidatePath(SECTION_PATH);
  return { ok: true };
}
