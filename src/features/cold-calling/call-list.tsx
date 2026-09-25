"use client";

import { AnimatePresence, motion } from "framer-motion";
import { GlobeIcon, PhoneIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { telHref } from "@/features/contacts/contact-search";
import { websiteHref } from "@/features/contacts/schemas";
import { contactName, contactPerson, type ContactListItem } from "@/features/contacts/types";
import { cn } from "@/lib/utils";

type Props = {
  contacts: ContactListItem[];
  openId: string | null;
  onOpen: (contact: ContactListItem) => void;
};

/** Company, a phone that dials on tap and the website. A contact moved away slides out. */
export function CallList({ contacts, openId, onOpen }: Props) {
  const t = useTranslations("coldCalling.list");
  return (
    <ul className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {contacts.map((contact) => {
          const name = contactName(contact);
          const detail = [contactPerson(contact), contact.city].filter(Boolean).join(" · ");
          return (
            <motion.li
              key={contact.id}
              layout="position"
              exit={{ opacity: 0, x: 48, transition: { duration: 0.25 } }}
              className={cn(
                "relative flex items-center gap-2 rounded-card border bg-surface py-2 pr-2 pl-4 transition-colors",
                openId === contact.id ? "border-violet/60" : "border-line hover:border-line-strong",
              )}
            >
              <button
                type="button"
                onClick={() => onOpen(contact)}
                className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center text-left outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-3 focus-visible:after:ring-violet/40"
              >
                <span className="truncate font-medium text-ink">{name}</span>
                {detail && <span className="truncate text-xs text-ink-muted">{detail}</span>}
              </button>
              {/* Above the row button so a tap dials instead of opening the panel. */}
              {contact.phone && (
                <a
                  href={telHref(contact.phone)}
                  aria-label={t("call", { name })}
                  className="relative inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-teal/30 px-3 text-sm text-teal tabular-nums outline-none hover:bg-teal/10 focus-visible:ring-3 focus-visible:ring-teal/40"
                >
                  <PhoneIcon aria-hidden className="size-4" />
                  <span className="hidden sm:inline">{contact.phone}</span>
                </a>
              )}
              {contact.website && (
                <a
                  href={websiteHref(contact.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("website", { name })}
                  className="relative grid size-11 shrink-0 place-items-center rounded-full text-ink-soft outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
                >
                  <GlobeIcon aria-hidden className="size-4" />
                </a>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
