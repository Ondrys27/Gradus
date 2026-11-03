"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { MailIcon, PencilIcon, PhoneIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { toneFill, toneSoft } from "@/components/ui/tone";
import { useUserSettings } from "@/features/account/queries";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useCompanyGroups, useCompanyTree } from "../company/queries";
import { EditableText, fieldClass } from "./editable-field";
import { dashboardErrorOf, useSetGroupMember, useUpdateCompanyWorker } from "./queries";
import { parseMarkdown, type Inline } from "./simple-markdown";
import type { DashboardViewer, DashboardWorker } from "./types";

export const DESCRIPTION_MAX = 4000;
const EMAIL_MAX = 254;

/**
 * Who the person is: how to reach them, a few words about them and the
 * groups they belong to. Edited in place by whoever may change them; the
 * person themself changes their phone.
 */
export function InfoCard({
  worker,
  viewer,
  readOnly,
  onShowGroups,
}: {
  worker: DashboardWorker;
  viewer: DashboardViewer;
  readOnly: boolean;
  onShowGroups: () => void;
}) {
  const t = useTranslations("workers.dashboard.info");
  const tErrors = useTranslations("workers.dashboard.errors");
  const update = useUpdateCompanyWorker(worker);
  const editable = worker.canEdit && !readOnly;
  const phoneEditable = (worker.canEdit || worker.isSelf) && !readOnly;

  return (
    <GlowCard interactive={false} className="flex flex-col gap-5" data-testid="worker-info">
      <div className="grid gap-4 sm:grid-cols-2">
        <Contact icon={<MailIcon />} label={t("email")}>
          {editable ? (
            <EditableText
              id="worker-email-field"
              type="email"
              value={worker.email}
              label={t("email")}
              placeholder={t("emailPlaceholder")}
              maxLength={EMAIL_MAX}
              className="text-sm"
              onSave={(value) => update.mutate({ email: value })}
            />
          ) : worker.email ? (
            <a
              href={`mailto:${worker.email}`}
              className="truncate text-sm text-ink hover:underline"
            >
              {worker.email}
            </a>
          ) : (
            <span className="text-sm text-ink-muted">{t("none")}</span>
          )}
        </Contact>
        <Contact icon={<PhoneIcon />} label={t("phone")}>
          <PhoneField
            worker={worker}
            editable={phoneEditable}
            onSave={(value) => update.mutate({ phone: value })}
          />
        </Contact>
      </div>

      <Description
        worker={worker}
        editable={editable}
        onSave={(value) => update.mutate({ description: value })}
      />

      <Groups worker={worker} viewer={viewer} editable={editable} onShowGroups={onShowGroups} />

      {update.isError && <FormAlert>{tErrors(dashboardErrorOf(update.error))}</FormAlert>}
    </GlowCard>
  );
}

function Contact({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="micro-label flex items-center gap-1.5 [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

function PhoneField({
  worker,
  editable,
  onSave,
}: {
  worker: DashboardWorker;
  editable: boolean;
  onSave: (value: string | null) => void;
}) {
  const t = useTranslations("workers.dashboard.info");
  const country = useUserSettings().country_code;
  const saved = worker.phone ?? "";
  const [value, setValue] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    setValue(saved);
  }
  if (!editable) {
    return worker.phone ? (
      <a href={`tel:${worker.phone}`} className="text-sm text-ink hover:underline">
        {formatPhone(worker.phone, country)}
      </a>
    ) : (
      <span className="text-sm text-ink-muted">{t("none")}</span>
    );
  }
  return (
    <PhoneInput
      id="worker-phone"
      aria-label={t("phone")}
      value={value}
      country={country}
      onChange={setValue}
      onBlur={() => {
        if (value !== saved) onSave(value || null);
      }}
      className={cn(fieldClass, "text-sm")}
    />
  );
}

function Description({
  worker,
  editable,
  onSave,
}: {
  worker: DashboardWorker;
  editable: boolean;
  onSave: (value: string | null) => void;
}) {
  const t = useTranslations("workers.dashboard.info");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(worker.description ?? "");

  function start() {
    setText(worker.description ?? "");
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    const clean = text.trim();
    if (clean.length > DESCRIPTION_MAX) return;
    if (clean !== (worker.description ?? "")) onSave(clean || null);
  }

  return (
    <section aria-labelledby={`worker-description-${worker.id}`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`worker-description-${worker.id}`} className="micro-label">
          {t("description")}
        </h3>
        {editable && !editing && (
          <Button variant="ghost" size="sm" onClick={start}>
            <PencilIcon aria-hidden data-icon="inline-start" />
            {worker.description ? t("editDescription") : t("addDescription")}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            autoFocus
            value={text}
            rows={6}
            maxLength={DESCRIPTION_MAX}
            aria-label={t("description")}
            placeholder={t("descriptionPlaceholder")}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setEditing(false);
              }
            }}
          />
          <p className="text-xs text-ink-muted">{t("markdownHint")}</p>
        </div>
      ) : worker.description ? (
        <Markdown source={worker.description} />
      ) : (
        <p className="text-sm text-ink-muted">{editable ? t("descriptionEmpty") : t("none")}</p>
      )}
    </section>
  );
}

/** The description drawn from parsed data, never as HTML. */
function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink-soft">
      {parseMarkdown(source).map((block, index) =>
        block.kind === "list" ? (
          <ul key={index} className="flex list-disc flex-col gap-1 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineText parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="break-words">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                <InlineText parts={line} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

function InlineText({ parts }: { parts: Inline[] }) {
  return parts.map((part, index) => {
    switch (part.kind) {
      case "bold":
        return (
          <strong key={index} className="font-semibold text-ink">
            {part.text}
          </strong>
        );
      case "italic":
        return <em key={index}>{part.text}</em>;
      case "link":
        return (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-violet underline-offset-2 hover:underline"
          >
            {part.text}
          </a>
        );
      default:
        return <Fragment key={index}>{part.text}</Fragment>;
    }
  });
}

/** The person's groups; whoever may change them adds and removes them here. */
function Groups({
  worker,
  viewer,
  editable,
  onShowGroups,
}: {
  worker: DashboardWorker;
  viewer: DashboardViewer;
  editable: boolean;
  onShowGroups: () => void;
}) {
  const t = useTranslations("workers.dashboard.groups");
  const tErrors = useTranslations("workers.dashboard.errors");
  const people = useCompanyTree();
  const groups = useCompanyGroups();
  const setMember = useSetGroupMember(worker);
  const memberOf = new Set(people.data?.find((person) => person.id === worker.id)?.groupIds ?? []);
  const all = groups.data ?? [];
  const mine = all.filter((group) => memberOf.has(group.id));
  const others = all.filter((group) => !memberOf.has(group.id));
  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9";

  return (
    <section aria-labelledby={`worker-groups-${worker.id}`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`worker-groups-${worker.id}`} className="micro-label">
          {t("title")}
        </h3>
        {viewer === "owner" && (
          <Button variant="link" size="sm" onClick={onShowGroups}>
            {t("manage")}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="worker-groups">
        {mine.length === 0 && <span className="text-sm text-ink-muted">{t("none")}</span>}
        {mine.map((group) => (
          <span
            key={group.id}
            data-testid="worker-group-chip"
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-full border pr-1 pl-3 text-sm font-medium",
              toneSoft[group.color],
              !editable && "pr-3",
            )}
          >
            <span aria-hidden className={cn("size-2 rounded-full", toneFill[group.color])} />
            {group.name}
            {editable && (
              <button
                type="button"
                aria-label={t("remove", { group: group.name })}
                disabled={setMember.isPending}
                onClick={() => setMember.mutate({ groupId: group.id, member: false })}
                className="grid size-11 cursor-pointer place-items-center rounded-full outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-6"
              >
                <XIcon aria-hidden className="size-3.5" />
              </button>
            )}
          </span>
        ))}
        {editable && others.length > 0 && (
          <Menu.Root>
            <Menu.Trigger
              data-testid="worker-group-add"
              className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full border border-dashed border-line-strong px-3 text-sm text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
            >
              <PlusIcon aria-hidden className="size-3.5" />
              {t("add")}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={6} align="start" className="z-popover">
                <Menu.Popup className="max-h-72 min-w-48 overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
                  {others.map((group) => (
                    <Menu.Item
                      key={group.id}
                      className={itemClass}
                      onClick={() => setMember.mutate({ groupId: group.id, member: true })}
                    >
                      <span
                        aria-hidden
                        className={cn("size-2 rounded-full", toneFill[group.color])}
                      />
                      {group.name}
                    </Menu.Item>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
        {editable && all.length === 0 && viewer === "owner" && (
          <span className="text-sm text-ink-muted">{t("noGroupsYet")}</span>
        )}
      </div>
      {setMember.isError && <FormAlert>{tErrors(dashboardErrorOf(setMember.error))}</FormAlert>}
    </section>
  );
}
