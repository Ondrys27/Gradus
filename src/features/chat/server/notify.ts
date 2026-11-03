import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTestAddress } from "@/features/feedback/server/notify";
import { settingsHref } from "@/features/settings/groups";
import { track } from "@/lib/analytics/track";
import { sendEmail } from "@/lib/email/resend";
import type { Database } from "@/types/database";
import { CHAT_EMAIL_IDLE_MINUTES, MESSAGES_PATH, type ChatKind } from "../types";
import { chatDigestEmail, type ChatDigestLine } from "./emails";

type Admin = SupabaseClient<Database>;

/**
 * After a message: who of the conversation should hear about it by e-mail.
 * The other person of a direct conversation and everybody mentioned, never
 * the sender. Pure, so the rule has a test.
 */
export function chatRecipients(input: {
  kind: ChatKind;
  sender: string;
  members: readonly string[];
  mentions: readonly string[];
}): string[] {
  const members = new Set(input.members);
  const out = new Set<string>();
  if (input.kind === "direct") {
    for (const member of input.members) if (member !== input.sender) out.add(member);
  }
  for (const member of input.mentions) {
    if (member !== input.sender && members.has(member)) out.add(member);
  }
  return [...out];
}

/**
 * E-mails the recipients of a new message who are away: at most one an hour
 * each (chat_email_claim also checks the 10 minutes without the app), only
 * with e-mails about messages on, never to test addresses, with the counts
 * of what waits for them (chat_email_digest). Never throws.
 */
export async function notifyChatRecipients(
  admin: Admin,
  input: {
    channelId: string;
    ownerId: string;
    kind: ChatKind;
    sender: string;
    mentions: readonly string[];
    origin: string | null;
  },
): Promise<void> {
  const { data: memberRows, error } = await admin
    .from("chat_members")
    .select("member, worker_id")
    .eq("channel_id", input.channelId)
    .limit(500);
  if (error || !memberRows) return;
  const recipients = chatRecipients({
    kind: input.kind,
    sender: input.sender,
    members: memberRows.map((row) => row.member!).filter(Boolean),
    mentions: input.mentions,
  });
  if (!recipients.length) return;

  // The account behind each member: the owner's own, or an active worker's.
  const workerIds = recipients.filter((member) => member !== input.ownerId);
  const accounts = new Map<string, string>();
  if (recipients.includes(input.ownerId)) accounts.set(input.ownerId, input.ownerId);
  if (workerIds.length) {
    const { data: workers } = await admin
      .from("workers")
      .select("id, user_id, status")
      .eq("owner_id", input.ownerId)
      .in("id", workerIds);
    for (const worker of workers ?? []) {
      if (worker.user_id && worker.status === "active") accounts.set(worker.id, worker.user_id);
    }
  }

  for (const userId of new Set(accounts.values())) {
    try {
      await mailOne(admin, userId, input.origin);
    } catch (failure) {
      console.error("[chat] e-mail failed", failure instanceof Error ? failure.message : "unknown");
    }
  }
}

async function mailOne(admin: Admin, userId: string, origin: string | null) {
  const [{ data: settings }, { data: user }] = await Promise.all([
    admin
      .from("user_settings")
      .select("locale, chat_email_notifications")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  if (settings && !settings.chat_email_notifications) return;
  const email = user.user?.email;
  if (!email || isTestAddress(email)) return;

  const { data: digest } = await admin.rpc("chat_email_digest", { _user: userId });
  if (!digest?.length) return;
  const { data: claimed } = await admin.rpc("chat_email_claim", {
    _user: userId,
    _idle_minutes: CHAT_EMAIL_IDLE_MINUTES,
  });
  if (!claimed) return;

  const lines = await digestLines(admin, digest);
  if (!lines.length) return;
  const mail = chatDigestEmail(
    lines,
    {
      appUrl: origin ? `${origin}${MESSAGES_PATH}?ref=email` : null,
      settingsUrl: origin ? `${origin}${settingsHref("chatEmail")}` : null,
    },
    settings?.locale ?? null,
  );
  const result = await sendEmail({ to: email, ...mail });
  if (!result.ok) {
    console.error("[chat] e-mail failed", result.error);
    return;
  }
  await track(
    "chat_email_sent",
    {
      conversations: lines.length,
      mentions: lines.reduce((sum, line) => sum + line.mentions, 0),
    },
    { userId, admin },
  );
}

type DigestRow = Database["public"]["Functions"]["chat_email_digest"]["Returns"][number];

async function digestLines(admin: Admin, rows: readonly DigestRow[]): Promise<ChatDigestLine[]> {
  // The names of the people of direct conversations, per space.
  const peersBySpace = new Map<string, string[]>();
  for (const row of rows) {
    if (row.kind === "direct" && row.peer) {
      peersBySpace.set(row.owner_id, [...(peersBySpace.get(row.owner_id) ?? []), row.peer]);
    }
  }
  const names = new Map<string, string>();
  for (const [space, members] of peersBySpace) {
    const { data } = await admin.rpc("chat_member_names", { _owner: space, _members: members });
    for (const row of data ?? []) if (row.name) names.set(row.member, row.name);
  }
  return rows.flatMap((row): ChatDigestLine[] => {
    if (row.kind === "direct") {
      const name = (row.peer && names.get(row.peer)) || null;
      return [{ kind: "direct", name, messages: row.messages, mentions: row.mentions }];
    }
    return row.mentions > 0 ? [{ kind: "group", name: row.name || null, mentions: row.mentions }] : [];
  });
}
