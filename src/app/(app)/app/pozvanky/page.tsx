import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InvitesView, type LinkInvite } from "@/features/account/invites-view";
import { inviteLinkView } from "@/features/auth/invite-link";
import { loadWorkerInviteLink } from "@/features/auth/worker-invite";
import { track } from "@/lib/analytics/track";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invites");
  return { title: t("title") };
}

/**
 * Invites into other companies waiting for the account, in any space. With
 * `?kod=` an invite link opened while signed in (the middleware sends the
 * registration link here): whose it is, accept it when it is this account's,
 * otherwise "You are signed in as X. The invite is for Y." Reading the link
 * never changes the invite.
 */
export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { kod } = await searchParams;
  const code = typeof kod === "string" ? kod.trim().slice(0, 64) : "";
  let linkInvite: LinkInvite | null = null;
  if (code) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const viewerId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    const viewerEmail = typeof data?.claims?.email === "string" ? data.claims.email : null;
    const link = await loadWorkerInviteLink(code).catch((error) => {
      console.error("[invites] invite link failed", error);
      return null;
    });
    const view = inviteLinkView({
      state: link?.status.state ?? "unknown",
      invite: link?.invite ?? null,
      viewer: viewerId ? { id: viewerId, email: viewerEmail } : null,
      accountForEmail: false,
    });
    await track(
      "worker_invite_link_opened",
      { state: link?.status.state ?? "unknown", view: view.kind, signed_in: true },
      { userId: viewerId },
    );
    linkInvite = {
      code,
      view,
      since: link?.status.since ?? null,
      who: link?.companyName ?? link?.ownerName ?? null,
      target: link?.email ?? link?.workerName ?? null,
      current: viewerEmail,
      own: Boolean(viewerId && link?.invite?.ownerId === viewerId),
    };
  }
  return <InvitesView linkInvite={linkInvite} />;
}
