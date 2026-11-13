"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, LogOutIcon, MailOpenIcon, ShieldCheckIcon, UserRoundIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GRANT_SECTIONS,
  PERMISSION_CATALOG,
  seesSection,
  templateOf,
  type PermissionGrants,
} from "@/features/workers/permissions-catalog";
import { RuleText } from "@/features/workers/rewards/rule-text";
import { formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { InviteProblemCard } from "@/features/auth/invite-link-card";
import type { InviteLinkView } from "@/features/auth/invite-link";
import { respondToInviteCode } from "@/features/workers/server/invites";
import { INVITES_PATH, localizedPath } from "@/lib/routes";
import { InboxActionError, inviterName, useInbox, useRespondInvite, type PendingInvite } from "./inbox";
import { useSignOut } from "./queries";
import { useSwitchSpace } from "./space-switch";

/** An invite link opened while signed in (`/app/pozvanky?kod=…`), as the server read it. */
export type LinkInvite = {
  code: string;
  view: InviteLinkView;
  since: string | null;
  /** The company or its owner. */
  who: string | null;
  /** Whom the invite is for: its e-mail, else the name the owner gave. */
  target: string | null;
  /** The signed-in account's e-mail. */
  current: string | null;
  /** The signed-in account is the owner who made the invite. */
  own: boolean;
};

/**
 * Invites into other companies (step 22.5): who invites ("Novák s.r.o. ·
 * Václav Novák invites you as a Sales rep"), what the person will see there
 * and the rewards the owner set, until when. Accept puts the company into
 * the switcher (and offers to go there now); decline asks first. Reached
 * from the bell, the e-mail and Grady.
 */
export function InvitesView({ linkInvite = null }: { linkInvite?: LinkInvite | null }) {
  const t = useTranslations("invites");
  const inbox = useInbox();
  const [accepted, setAccepted] = useState<{ spaceId: string; name: string } | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      {accepted && <AcceptedCard {...accepted} />}
      {linkInvite && !accepted && <LinkInviteCard invite={linkInvite} onAccepted={setAccepted} />}
      {inbox.isPending ? (
        <Skeleton className="h-56 w-full rounded-card" />
      ) : inbox.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : inbox.data.invites.length === 0 ? (
        !accepted && <EmptyState title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <ul className="flex flex-col gap-4" data-testid="invites-list">
          {inbox.data.invites.map((invite) => (
            <li key={invite.id}>
              <InviteItem invite={invite} onAccepted={setAccepted} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useInviterName() {
  const t = useTranslations("invites");
  return (invite: Pick<PendingInvite, "companyName" | "ownerName">) => inviterName(invite) ?? t("someone");
}

/** The role it invites to: the owner's job title, else the name of the rights' template. */
function useRoleOf() {
  const tTemplates = useTranslations("workers.permissions.templates");
  return (invite: PendingInvite): string | null => {
    if (invite.jobTitle) return invite.jobTitle;
    const template = templateOf(invite.grants);
    return template ? tTemplates(template) : null;
  };
}

function InviteItem({
  invite,
  onAccepted,
}: {
  invite: PendingInvite;
  onAccepted: (value: { spaceId: string; name: string }) => void;
}) {
  const t = useTranslations("invites");
  const settings = useFormatSettings();
  const respond = useRespondInvite();
  const inviter = useInviterName();
  const roleOf = useRoleOf();
  const [declining, setDeclining] = useState(false);
  const role = roleOf(invite);
  const who = inviter(invite);
  const failure =
    respond.error instanceof InboxActionError ? t(`errors.${respond.error.code}`) : respond.error ? t("errors.unknown") : null;
  // Rewards set for this worker come back with their record's id: "for you".
  const names = useMemo(
    () => new Map(invite.rewards.flatMap((rule) => (rule.workerId ? [[rule.workerId, t("forYou")]] : []))),
    [invite.rewards, t],
  );

  function answer(accept: boolean) {
    respond.mutate(
      { inviteId: invite.id, accept },
      {
        onSuccess: ({ spaceId }) => {
          setDeclining(false);
          if (accept) onAccepted({ spaceId, name: invite.companyName ?? invite.ownerName ?? t("someone") });
        },
      },
    );
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-5 md:p-6" data-testid="invite-card">
      <header className="flex items-start gap-4">
        <Avatar
          src={invite.logoUrl}
          name={who}
          className="size-12 rounded-xl border-teal/50 bg-teal/15 text-teal"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold text-balance text-ink" data-testid="invite-title">
            {role ? t("invitesAs", { who, role }) : t("invites", { who })}
          </h2>
          <p className="text-sm text-ink-muted">
            {t("validUntil", { date: formatDate(new Date(invite.expiresAt), settings) })}
          </p>
        </div>
      </header>

      <Rights grants={invite.grants} />

      {invite.rewards.length > 0 && (
        <section aria-label={t("rewardsTitle")} className="flex flex-col gap-3">
          <h3 className="micro-label">{t("rewardsTitle")}</h3>
          {invite.rewards.slice(0, 6).map((rule, index) => (
            <RuleText key={`${rule.name}-${index}`} rule={rule} workerNames={names} />
          ))}
        </section>
      )}

      <p className="text-xs text-ink-muted">{t("free")}</p>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 border-t border-line/60 pt-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => setDeclining(true)} disabled={respond.isPending}>
          <XIcon aria-hidden data-icon="inline-start" />
          {t("decline")}
        </Button>
        <Button onClick={() => answer(true)} disabled={respond.isPending} data-testid="invite-accept">
          <CheckIcon aria-hidden data-icon="inline-start" />
          {t("accept")}
        </Button>
      </div>
      <ConfirmDialog
        open={declining}
        onOpenChange={setDeclining}
        title={t("declineTitle")}
        description={t("declineText", { who })}
        confirmLabel={t("decline")}
        cancelLabel={t("cancel")}
        closeLabel={t("cancel")}
        pending={respond.isPending}
        error={declining ? failure : null}
        onConfirm={() => answer(false)}
      />
    </GlowCard>
  );
}

/** The sections the person will see there; the rest stays hidden. */
function Rights({ grants }: { grants: PermissionGrants }) {
  const t = useTranslations("invites");
  const tNav = useTranslations("nav");
  const tPermissions = useTranslations("workers.permissions");
  const sections = GRANT_SECTIONS.filter((section) => seesSection(grants, section)).map((key) => {
    const entry = PERMISSION_CATALOG.find((section) => section.key === key);
    return key === "invoices" ? tPermissions("sections.invoices") : entry ? tNav(entry.nav) : key;
  });
  return (
    <section aria-label={t("rightsTitle")} className="flex flex-col gap-2">
      <h3 className="micro-label flex items-center gap-1.5">
        <ShieldCheckIcon aria-hidden className="size-3.5" />
        {t("rightsTitle")}
      </h3>
      {sections.length ? (
        <ul className="flex flex-wrap gap-1.5" data-testid="invite-rights">
          {sections.map((name) => (
            <li
              key={name}
              className="rounded-full border border-line bg-surface/60 px-2.5 py-1 text-xs font-medium text-ink-soft"
            >
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">{t("rightsNone")}</p>
      )}
    </section>
  );
}

/** After accepting: the company is in the switcher; go there now or later. */
function AcceptedCard({ spaceId, name }: { spaceId: string; name: string }) {
  const t = useTranslations("invites");
  const { state, switchTo } = useSwitchSpace();
  return (
    <GlowCard
      interactive={false}
      className="flex flex-col gap-4 border-green/40 md:p-6"
      data-testid="invite-accepted"
    >
      <p className="flex items-center gap-2 font-semibold text-ink">
        <MailOpenIcon aria-hidden className="size-5 text-green" />
        {t("acceptedTitle", { name })}
      </p>
      <p className="text-sm text-ink-soft">{t("acceptedText")}</p>
      {state === "failed" && <FormAlert>{t("switchFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => window.location.replace(INVITES_PATH)}>
          {t("stay")}
        </Button>
        <Button onClick={() => void switchTo(spaceId)} disabled={state === "switching"} data-testid="invite-switch">
          {t("switch", { name })}
        </Button>
      </div>
    </GlowCard>
  );
}

/**
 * The invite of a link opened while signed in (27.1): accept it when it is
 * this account's; as anybody else "You are signed in as X. The invite is for
 * Y." with Sign out and continue (to the registration, or the sign-in when Y
 * has an account) and Stay. A link that no longer works says why.
 */
function LinkInviteCard({
  invite,
  onAccepted,
}: {
  invite: LinkInvite;
  onAccepted: (value: { spaceId: string; name: string }) => void;
}) {
  const t = useTranslations("auth.inviteLink");
  const tInvites = useTranslations("invites");
  const locale = useLocale();
  const router = useRouter();
  const signOut = useSignOut();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const { view } = invite;

  if (view.kind === "problem") {
    return <InviteProblemCard code={invite.code} state={view.state} since={invite.since} signedIn />;
  }

  function answer(accept: boolean) {
    setFailure(null);
    startTransition(async () => {
      const result = await respondToInviteCode({ code: invite.code, accept });
      if (!result.ok) {
        setFailure(tInvites(`errors.${result.error}`));
        return;
      }
      setDeclining(false);
      if (accept) onAccepted({ spaceId: result.data.spaceId, name: invite.who ?? tInvites("someone") });
      else router.replace(INVITES_PATH);
    });
  }

  const title = invite.who ? t("linkTitle", { who: invite.who }) : t("linkTitleNoName");
  const registration = `${localizedPath("register", locale)}?invite=${encodeURIComponent(invite.code)}`;

  if (view.kind === "accept") {
    return (
      <GlowCard interactive={false} className="flex flex-col gap-4 md:p-6" data-testid="invite-link-accept">
        <h2 className="text-lg font-semibold text-balance text-ink">{title}</h2>
        <p className="text-sm text-ink-soft">{t("linkText")}</p>
        {failure && <FormAlert>{failure}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 border-t border-line/60 pt-4 sm:flex-row sm:justify-end">
          {view.canDecline && (
            <Button variant="ghost" onClick={() => setDeclining(true)} disabled={pending}>
              <XIcon aria-hidden data-icon="inline-start" />
              {tInvites("decline")}
            </Button>
          )}
          <Button onClick={() => answer(true)} disabled={pending} data-testid="invite-link-accept-button">
            <CheckIcon aria-hidden data-icon="inline-start" />
            {tInvites("accept")}
          </Button>
        </div>
        <ConfirmDialog
          open={declining}
          onOpenChange={setDeclining}
          title={tInvites("declineTitle")}
          description={tInvites("declineText", { who: invite.who ?? tInvites("someone") })}
          confirmLabel={tInvites("decline")}
          cancelLabel={tInvites("cancel")}
          closeLabel={tInvites("cancel")}
          pending={pending}
          error={declining ? failure : null}
          onConfirm={() => answer(false)}
        />
      </GlowCard>
    );
  }

  // view.kind === "other_account" or "sign_in" (a signed-in viewer never gets "sign_in").
  const canAcceptHere = view.kind === "other_account" && view.canAcceptHere;
  return (
    <GlowCard
      interactive={false}
      className="flex flex-col gap-4 border-orange/40 md:p-6"
      data-testid="invite-other-account"
    >
      <div className="flex items-start gap-3">
        <UserRoundIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-orange" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-semibold break-words text-ink" data-testid="invite-other-current">
            {t("otherTitle", { current: invite.current ?? tInvites("someone") })}
          </h2>
          {invite.target && (
            <p className="text-sm break-words text-ink" data-testid="invite-other-target">
              {t("otherFor", { target: invite.target })}
            </p>
          )}
          <p className="text-sm text-ink-soft">{invite.own ? t("otherOwner") : t("otherText")}</p>
        </div>
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 border-t border-line/60 pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button variant="ghost" onClick={() => router.replace(INVITES_PATH)} data-testid="invite-stay">
          {t("stay")}
        </Button>
        {canAcceptHere && (
          <Button variant="secondary" onClick={() => answer(true)} disabled={pending} data-testid="invite-accept-here">
            <CheckIcon aria-hidden data-icon="inline-start" />
            {t("acceptHere", { current: invite.current ?? tInvites("someone") })}
          </Button>
        )}
        <Button onClick={() => void signOut(registration)} data-testid="invite-sign-out-continue">
          <LogOutIcon aria-hidden data-icon="inline-start" />
          {t("signOutContinue")}
        </Button>
      </div>
    </GlowCard>
  );
}
