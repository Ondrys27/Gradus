"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeftIcon,
  BriefcaseBusinessIcon,
  ExternalLinkIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrentTableCard } from "@/features/contacts/contact-detail";
import { useUserSettings } from "@/features/account/queries";
import { useCan } from "@/features/account/workspace-queries";
import { MoveContactDialog, type MoveResult } from "@/features/contacts/move-contact-dialog";
import { useContact, useContactEntry, useOpenDeals } from "@/features/contacts/queries";
import { NewDealFromContactDialog } from "@/features/pipeline/new-deal-from-contact";
import { websiteHref } from "@/features/contacts/schemas";
import { contactName, contactPerson, type ContactTable } from "@/features/contacts/types";
import { formatPhone, telHref } from "@/lib/phone";
import { cn } from "@/lib/utils";

type Props = {
  contactId: string | null;
  tables: ContactTable[];
  onClose: () => void;
  onMoved: (contactId: string, result: MoveResult) => void;
};

/** The contact being called: dial, see what is known, move it on. */
export function CallContactPanel({ contactId, tables, onClose, onMoved }: Props) {
  const t = useTranslations("coldCalling.panel");
  // Keep the last contact on screen while the panel slides out.
  const [shown, setShown] = useState(contactId);
  if (contactId && contactId !== shown) setShown(contactId);
  const current = contactId ?? shown;

  return (
    <SidePanel
      open={contactId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("title")}
      closeLabel={t("close")}
    >
      {current && <PanelBody key={current} contactId={current} tables={tables} onMoved={onMoved} />}
    </SidePanel>
  );
}

function PanelBody({
  contactId,
  tables,
  onMoved,
}: {
  contactId: string;
  tables: ContactTable[];
  onMoved: (contactId: string, result: MoveResult) => void;
}) {
  const t = useTranslations("coldCalling.panel");
  const country = useUserSettings().country_code;
  const contact = useContact(contactId);
  const entry = useContactEntry(contactId).data;
  const [moving, setMoving] = useState(false);
  const [makingDeal, setMakingDeal] = useState(false);
  const canMove = useCan("cold_calling", "edit");
  const canSeeDeals = useCan("pipeline", "view");
  const canMakeDeal = useCan("pipeline", "edit");
  const ids = useMemo(() => [[contactId]], [contactId]);
  const openDeals = useOpenDeals(ids, canSeeDeals);
  const deal = openDeals.deals[contactId];
  // The full detail lives under Contacts, which is a section of its own.
  const canOpenDetail = useCan("contacts", "view");

  if (contact.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-32 rounded-card" />
      </div>
    );
  }
  if (!contact.data) return <p className="text-sm text-ink-muted">{t("notFound")}</p>;

  const data = contact.data;
  const person = contactPerson(data);
  const dealContact = {
    id: data.id,
    company_name: data.company_name,
    first_name: data.first_name,
    last_name: data.last_name,
  };
  const address = [data.address, data.city].filter(Boolean).join(", ");
  const row = "flex items-center gap-3 text-sm text-ink-soft [&_svg]:size-4 [&_svg]:shrink-0";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold text-ink">{contactName(data)}</h3>
        {person && <p className="text-sm text-ink-soft">{person}</p>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {data.phone ? (
          <a
            href={telHref(data.phone, country)}
            className={cn(buttonVariants({ size: "lg" }), "flex-1")}
          >
            <PhoneIcon aria-hidden data-icon="inline-start" />
            {t("call", { phone: formatPhone(data.phone, country) })}
          </a>
        ) : (
          <p className="flex-1 text-sm text-ink-muted">{t("noPhone")}</p>
        )}
        {canMove && (
          <Button
            size="lg"
            variant="outline"
            className="flex-1"
            disabled={tables.length === 0}
            onClick={() => setMoving(true)}
          >
            <ArrowRightLeftIcon aria-hidden data-icon="inline-start" />
            {t("move")}
          </Button>
        )}
      </div>

      {deal ? (
        <Link
          href={`/app/pipeline?deal=${deal.id}`}
          className="flex min-h-11 items-center gap-3 rounded-xl border border-violet/30 px-4 py-2 text-sm text-ink outline-none hover:bg-violet/10 focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          <BriefcaseBusinessIcon aria-hidden className="size-4 shrink-0 text-violet" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-ink-muted">{t("deal")}</span>
            <span className="truncate font-medium">{deal.title}</span>
          </span>
        </Link>
      ) : (
        // Offered only once it is known that the contact has no open deal yet.
        canMakeDeal &&
        !openDeals.pending && (
          <Button variant="outline" onClick={() => setMakingDeal(true)}>
            <BriefcaseBusinessIcon aria-hidden data-icon="inline-start" />
            {t("createDeal")}
          </Button>
        )
      )}

      <div className="flex flex-col gap-3">
        {data.website && (
          <p className={row}>
            <GlobeIcon aria-hidden />
            <a
              href={websiteHref(data.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate text-violet underline-offset-4 hover:underline"
            >
              {data.website}
            </a>
          </p>
        )}
        {data.email && (
          <p className={row}>
            <MailIcon aria-hidden />
            <a href={`mailto:${data.email}`} className="min-w-0 truncate hover:text-ink">
              {data.email}
            </a>
          </p>
        )}
        {address && (
          <p className={row}>
            <MapPinIcon aria-hidden />
            <span className="min-w-0">{address}</span>
          </p>
        )}
      </div>

      {data.notes && (
        <div className="flex flex-col gap-1">
          <span className="micro-label">{t("notes")}</span>
          <p className="text-sm whitespace-pre-line text-ink-soft">{data.notes}</p>
        </div>
      )}

      <CurrentTableCard contactId={contactId} />

      {canOpenDetail && (
        <Link
          href={`/app/kontakty/${contactId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
        >
          <ExternalLinkIcon aria-hidden data-icon="inline-start" />
          {t("openDetail")}
        </Link>
      )}

      <MoveContactDialog
        open={moving}
        onOpenChange={setMoving}
        contactId={contactId}
        currentTableId={entry?.table_id ?? null}
        tables={tables}
        dealContact={canMakeDeal && !deal && !openDeals.pending ? dealContact : undefined}
        onMoved={(result) => onMoved(contactId, result)}
      />
      {canMakeDeal && (
        <NewDealFromContactDialog
          open={makingDeal}
          onOpenChange={setMakingDeal}
          contact={dealContact}
          source="cold_calling"
          // A contact booked for a meeting earlier: the deal takes that meeting.
          linkMeeting
          onCreated={() => undefined}
        />
      )}
    </div>
  );
}
