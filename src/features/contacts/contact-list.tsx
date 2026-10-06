"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailIcon, PhoneIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDate } from "@/lib/format";
import { useUserSettings } from "@/features/account/queries";
import { formatPhone, telHref } from "@/lib/phone";
import { useFormatSettings } from "@/lib/use-format-settings";
import {
  contactName,
  contactPerson,
  tableTone,
  type ContactListItem,
  type ContactTable,
} from "./types";

type Props = {
  contacts: ContactListItem[];
  tables: Map<string, ContactTable>;
  /** Extra column for the Clients table: won deals of each contact. */
  renderExtra?: (contact: ContactListItem) => ReactNode;
  extraLabel?: string;
};

function TablePill({ table }: { table: ContactTable | undefined }) {
  if (!table) return null;
  return (
    <StatusPill tone={tableTone(table.color)} dot className="max-w-full">
      <span className="truncate">{table.name}</span>
    </StatusPill>
  );
}

function LastContact({ value }: { value: string | null }) {
  const t = useTranslations("contacts.list");
  const settings = useFormatSettings();
  return value ? (
    <span>{formatDate(new Date(value), settings)}</span>
  ) : (
    <span className="text-ink-muted">{t("never")}</span>
  );
}

/** A table on larger screens, cards on phones. Both are rendered; CSS picks one. */
export function ContactList(props: Props) {
  return (
    <>
      <div className="hidden md:block">
        <ContactTableView {...props} />
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {props.contacts.map((contact) => (
          <ContactCard key={contact.id} contact={contact} {...props} />
        ))}
      </ul>
    </>
  );
}

function ContactTableView({ contacts, tables, renderExtra, extraLabel }: Props) {
  const t = useTranslations("contacts.list");
  const country = useUserSettings().country_code;
  const router = useRouter();
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="border-b border-line text-xs text-ink-muted">
          <tr>
            <th scope="col" className="w-[32%] px-4 py-3 font-medium">
              {t("name")}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {t("phone")}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {t("email")}
            </th>
            <th scope="col" className="w-[17%] px-4 py-3 font-medium">
              {extraLabel ?? t("table")}
            </th>
            <th scope="col" className="w-[13%] px-4 py-3 font-medium">
              {t("lastContact")}
            </th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => {
            const name = contactName(contact);
            const person = contactPerson(contact);
            const href = `/app/kontakty/${contact.id}`;
            return (
              <tr
                key={contact.id}
                onClick={(event) => {
                  // Links and buttons inside the row keep their own action.
                  if ((event.target as HTMLElement).closest("a, button")) return;
                  router.push(href);
                }}
                className="cursor-pointer border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-hover"
              >
                <td className="px-4 py-3">
                  <Link
                    href={href}
                    className="flex min-w-0 items-center gap-3 outline-none focus-visible:underline"
                  >
                    <Avatar name={name} className="size-8 text-xs" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-ink">{name}</span>
                      {(person || contact.city) && (
                        <span className="truncate text-xs text-ink-muted">
                          {[person, contact.city].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="truncate px-4 py-3 text-ink-soft">
                  {contact.phone && (
                    <a
                      href={telHref(contact.phone, country)}
                      className="hover:text-ink hover:underline"
                    >
                      {formatPhone(contact.phone, country)}
                    </a>
                  )}
                </td>
                <td className="truncate px-4 py-3 text-ink-soft">
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="hover:text-ink hover:underline">
                      {contact.email}
                    </a>
                  )}
                </td>
                <td className="px-4 py-3">
                  {renderExtra ? (
                    renderExtra(contact)
                  ) : (
                    <TablePill
                      table={contact.table_id ? tables.get(contact.table_id) : undefined}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  <LastContact value={contact.last_contact_at} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContactCard({ contact, tables, renderExtra }: Props & { contact: ContactListItem }) {
  const t = useTranslations("contacts.list");
  const country = useUserSettings().country_code;
  const name = contactName(contact);
  const person = contactPerson(contact);
  return (
    <li className="relative flex items-center gap-3 rounded-card border border-line bg-surface p-4">
      <Avatar name={name} className="size-10" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Link
          href={`/app/kontakty/${contact.id}`}
          className="truncate font-medium text-ink outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-3 focus-visible:after:ring-violet/40"
        >
          {name}
        </Link>
        {person && <span className="truncate text-xs text-ink-muted">{person}</span>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-soft">
          {renderExtra ? (
            renderExtra(contact)
          ) : (
            <TablePill table={contact.table_id ? tables.get(contact.table_id) : undefined} />
          )}
          <span>
            {t("lastContactShort")} <LastContact value={contact.last_contact_at} />
          </span>
        </div>
      </div>
      {/* Above the card link so they stay tappable. */}
      <div className="relative flex shrink-0 gap-1">
        {contact.phone && (
          <a
            href={telHref(contact.phone, country)}
            aria-label={t("callName", { name })}
            className="grid size-11 place-items-center rounded-full border border-line text-teal outline-none focus-visible:ring-3 focus-visible:ring-teal/40"
          >
            <PhoneIcon aria-hidden className="size-4" />
          </a>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            aria-label={t("emailName", { name })}
            className="grid size-11 place-items-center rounded-full border border-line text-violet outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
          >
            <MailIcon aria-hidden className="size-4" />
          </a>
        )}
      </div>
    </li>
  );
}
