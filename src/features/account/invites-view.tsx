"use client";

import { useMemo, useState } from "react";
import { CheckIcon, MailOpenIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { InboxActionError, inviterName, useInbox, useRespondInvite, type PendingInvite } from "./inbox";
import { useSwitchSpace } from "./space-switch";

/**
 * Invites into other companies (step 22.5): who invites ("Novák s.r.o. ·
 * Václav Novák invites you as a Sales rep"), what the person will see there
 * and the rewards the owner set, until when. Accept puts the company into
 * the switcher (and offers to go there now); decline asks first. Reached
 * from the bell, the e-mail and Jarvis.
 */
export function InvitesView() {
  const t = useTranslations("invites");
  const inbox = useInbox();
  const [accepted, setAccepted] = useState<{ spaceId: string; name: string } | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      {accepted && <AcceptedCard {...accepted} />}
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
        <Button variant="ghost" onClick={() => window.location.reload()}>
          {t("stay")}
        </Button>
        <Button onClick={() => void switchTo(spaceId)} disabled={state === "switching"} data-testid="invite-switch">
          {t("switch", { name })}
        </Button>
      </div>
    </GlowCard>
  );
}
