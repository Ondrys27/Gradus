import { NextResponse } from "next/server";
import { z } from "zod";
import { chatCsv, chatCsvFileName } from "@/features/chat/export";
import { CHAT_MESSAGE_COLUMNS, type ChatMessage } from "@/features/chat/types";
import { serverTranslator } from "@/i18n/server-translator";
import { track } from "@/lib/analytics/track";
import { toFormatSettings, USER_SETTINGS_COLUMNS, type UserSettings } from "@/lib/user-settings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Messages read per query, and at most in one file. */
const PAGE = 1000;
const MAX_MESSAGES = 20_000;

/**
 * The owner of the space downloads one of their conversations as CSV. Read
 * with the owner's own client, so only conversations they are in (a direct
 * one between two workers is not theirs). The space's data, not the
 * administration's: no admin_audit.
 */
export async function GET(request: Request) {
  const channelId = new URL(request.url).searchParams.get("c");
  if (!z.uuid().safeParse(channelId).success) {
    return NextResponse.json({ error: "notFound" }, { status: 404 });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims().catch(() => ({ data: null }));
  const userId = claims?.claims?.sub ?? null;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: channel } = await supabase
    .from("chat_channels")
    .select("id, owner_id, kind, name")
    .eq("id", channelId!)
    .maybeSingle();
  if (!channel) return NextResponse.json({ error: "notFound" }, { status: 404 });
  if (channel.owner_id !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [{ data: settingsRow }, { data: people }] = await Promise.all([
    supabase.from("user_settings").select(USER_SETTINGS_COLUMNS).eq("user_id", userId).maybeSingle(),
    supabase.rpc("chat_people"),
  ]);
  const settings = toFormatSettings(settingsRow as UserSettings | null);
  const t = serverTranslator((settingsRow as UserSettings | null)?.locale ?? null);
  const names = new Map((people ?? []).map((person) => [person.member, person.name]));
  const ownerName = t("messages.owner");
  const nameOf = (member: string) =>
    names.get(member) || (member === channel.owner_id ? ownerName : null);

  const messages: ChatMessage[] = [];
  let cursor: { at: string; id: string } | null = null;
  while (messages.length < MAX_MESSAGES) {
    let query = supabase
      .from("chat_messages")
      .select(CHAT_MESSAGE_COLUMNS)
      .eq("channel_id", channel.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) {
      query = query.or(
        `created_at.gt."${cursor.at}",and(created_at.eq."${cursor.at}",id.gt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
    const page = (data ?? []) as ChatMessage[];
    messages.push(...page);
    if (page.length < PAGE) break;
    const last = page[page.length - 1]!;
    cursor = { at: last.created_at, id: last.id };
  }

  let title = channel.name;
  if (channel.kind === "direct") {
    const { data: members } = await supabase
      .from("chat_members")
      .select("member")
      .eq("channel_id", channel.id)
      .limit(2);
    const peer = members?.find((row) => row.member !== userId)?.member;
    title = (peer && nameOf(peer)) || null;
  }
  const csv = chatCsv(messages, nameOf, settings, {
    time: t("messages.export.time"),
    sender: t("messages.export.sender"),
    text: t("messages.export.text"),
    files: t("messages.export.files"),
    edited: t("messages.export.edited"),
    deleted: t("messages.export.deleted"),
    yes: t("messages.export.yes"),
    formerMember: t("messages.formerMember"),
  });
  await track(
    "chat_conversation_exported",
    { kind: channel.kind === "direct" ? "direct" : "group", messages: messages.length },
    { userId, ownerId: userId },
  );
  const fileName = chatCsvFileName(
    t("messages.export.filePrefix"),
    title ?? t("messages.title"),
    settings,
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
