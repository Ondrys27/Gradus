"use client";

import { useMemo, useState } from "react";
import { Building2Icon, UsersRoundIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Switch } from "@/components/ui/switch";
import { useActiveMembers } from "@/features/account/active-members";
import { useSession } from "@/features/account/queries";
import { cn } from "@/lib/utils";
import {
  availableTargets,
  canManageShare,
  canShare,
  grantableRoles,
  sharingErrorKey,
  sortAccess,
  type AccessEntry,
  type NoteRole,
  type ShareRole,
  type ShareTarget,
} from "./logic";
import {
  useNoteAccess,
  useSetFolderPrivate,
  useShareGroups,
  useShareRemove,
  useShareSet,
  type ShareItem,
} from "./queries";

export type ShareDialogTarget = {
  item: ShareItem;
  /** The note's title or the folder's name. */
  title: string;
  ownerId: string;
  role: NoteRole;
  canReshare: boolean;
  /** A note in a folder: its "private in this folder" switch (the owner only). */
  inFolder?: { private: boolean } | null;
};

/** "group:<id>", "member:<user id>" or "space". */
function encodeTarget(kind: ShareTarget, id: string | null) {
  return kind === "space" ? "space" : `${kind}:${id}`;
}
function decodeTarget(value: string): { kind: ShareTarget; id: string | null } | null {
  if (value === "space") return { kind: "space", id: null };
  const [kind, id] = value.split(":");
  if ((kind === "member" || kind === "group") && id) return { kind, id };
  return null;
}

/**
 * Sharing like Google Docs: add people and groups of the company (only active
 * members) or the whole company with a role, optionally allowed to share
 * further; the list of who has access and from where (directly / from the
 * folder) with each role, and Remove. Whoever may not share further sees the
 * list only.
 */
export function ShareDialog({ target, onClose }: { target: ShareDialogTarget | null; onClose: () => void }) {
  const t = useTranslations("notes.sharing");
  const { user } = useSession();
  const open = !!target;
  const access = useNoteAccess(target?.item ?? null, open);
  const members = useActiveMembers(undefined, open);
  const groups = useShareGroups(open);
  const shareSet = useShareSet();
  const shareRemove = useShareRemove();
  const setPrivate = useSetFolderPrivate();
  const [choice, setChoice] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [reshare, setReshare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = !!target && canShare(target.role, target.canReshare);
  const roles = target ? grantableRoles(target.role) : [];
  const entries = useMemo(() => sortAccess(access.data ?? []), [access.data]);
  const available = useMemo(
    () =>
      availableTargets(
        members.data ?? [],
        groups.data ?? [],
        entries,
        target?.ownerId ?? "",
        user.id,
      ),
    [entries, groups.data, members.data, target?.ownerId, user.id],
  );
  const nothingToAdd = !available.space && available.groups.length === 0 && available.people.length === 0;

  function fail(cause: unknown) {
    setError(t(`errors.${sharingErrorKey(cause)}`));
  }

  async function add() {
    if (!target) return;
    const decoded = decodeTarget(choice);
    if (!decoded) return;
    setError(null);
    try {
      await shareSet.mutateAsync({
        item: target.item,
        target: decoded.kind,
        targetId: decoded.id,
        role: roles.includes(role) ? role : "viewer",
        canReshare: reshare,
      });
      setChoice("");
      setReshare(false);
    } catch (cause) {
      fail(cause);
    }
  }

  async function change(entry: AccessEntry, next: { role?: ShareRole; canReshare?: boolean }) {
    if (!target) return;
    setError(null);
    try {
      await shareSet.mutateAsync({
        item: target.item,
        target: entry.targetKind,
        targetId: entry.targetKind === "member" ? entry.userId : entry.targetKind === "group" ? entry.groupId : null,
        role: next.role ?? (entry.role === "editor" ? "editor" : "viewer"),
        canReshare: next.canReshare ?? entry.canReshare,
        change: true,
      });
    } catch (cause) {
      fail(cause);
    }
  }

  async function remove(entry: AccessEntry) {
    if (!target || !entry.shareId) return;
    setError(null);
    try {
      await shareRemove.mutateAsync({ shareId: entry.shareId, on: target.item.kind, target: entry.targetKind });
    } catch (cause) {
      fail(cause);
    }
  }

  const nameOf = (entry: AccessEntry) =>
    entry.targetKind === "space"
      ? t("wholeCompany")
      : (entry.name ?? "") + (entry.userId === user.id ? ` (${t("you")})` : "");

  const title = target
    ? target.item.kind === "folder"
      ? t("shareFolderTitle", { name: target.title })
      : t("shareTitle", { title: target.title })
    : "";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
      title={title}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <div className="flex flex-col gap-5" data-testid="note-share-dialog">
        {allowed ? (
          <section className="flex flex-col gap-2" aria-label={t("addLabel")}>
            <label htmlFor="note-share-target" className="text-sm font-medium text-ink-soft">
              {t("addLabel")}
            </label>
            {nothingToAdd ? (
              <p className="text-sm text-ink-muted">{t("noPeople")}</p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  id="note-share-target"
                  className="field min-w-0 flex-1 cursor-pointer"
                  value={choice}
                  onChange={(event) => setChoice(event.target.value)}
                  data-testid="note-share-target"
                >
                  <option value="">{t("choose")}</option>
                  {available.space && <option value={encodeTarget("space", null)}>{t("wholeCompany")}</option>}
                  {available.groups.length > 0 && (
                    <optgroup label={t("groups")}>
                      {available.groups.map((group) => (
                        <option key={group.id} value={encodeTarget("group", group.id)}>
                          {group.name} · {t("groupMembers", { count: group.memberCount })}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {available.people.length > 0 && (
                    <optgroup label={t("people")}>
                      {available.people.map((person) => (
                        <option key={person.userId} value={encodeTarget("member", person.userId)}>
                          {person.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <select
                  aria-label={t("roleLabel", { name: t("choose") })}
                  className="field cursor-pointer sm:w-44"
                  value={role}
                  onChange={(event) => setRole(event.target.value as ShareRole)}
                  data-testid="note-share-role"
                >
                  {roles.map((option) => (
                    <option key={option} value={option}>
                      {t(`role.${option}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!nothingToAdd && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft">
                  <Checkbox
                    checked={reshare}
                    onCheckedChange={(value) => setReshare(value === true)}
                    data-testid="note-share-reshare"
                  />
                  {t("reshare")}
                </label>
                <Button onClick={add} disabled={!choice || shareSet.isPending} data-testid="note-share-add">
                  {t("add")}
                </Button>
              </div>
            )}
            <p className="text-xs text-ink-muted">{t("onlyMembers")}</p>
          </section>
        ) : (
          <p className="text-sm text-ink-muted">{t("readOnlyHint")}</p>
        )}

        {target?.inFolder && target.role === "owner" && (
          <section className="flex items-start justify-between gap-4 rounded-2xl border border-line p-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">{t("privateInFolder")}</span>
              <span className="text-xs text-ink-muted">{t("privateInFolderHint")}</span>
            </span>
            <Switch
              aria-label={t("privateInFolder")}
              checked={target.inFolder.private}
              onCheckedChange={(value) => setPrivate.mutate({ noteId: target.item.id, value })}
              data-testid="note-share-private"
            />
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="micro-label">{t("whoHasAccess")}</h3>
          <ul className="flex flex-col gap-1" data-testid="note-share-list">
            {entries.map((entry, index) => {
              const manageable =
                entry.entry === "share" &&
                entry.source === "direct" &&
                !!target &&
                canManageShare({ created_by: entry.createdBy }, user.id, target.role);
              const name = nameOf(entry);
              return (
                <li
                  key={entry.shareId ?? `${entry.entry}-${index}`}
                  className="flex min-h-12 items-center gap-3 rounded-xl px-1 py-1.5"
                  data-testid="note-share-entry"
                  data-kind={entry.targetKind}
                  data-source={entry.source}
                >
                  {entry.targetKind === "space" ? (
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal/15 text-teal">
                      <Building2Icon aria-hidden className="size-4" />
                    </span>
                  ) : entry.targetKind === "group" ? (
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-violet/15 text-violet">
                      <UsersRoundIcon aria-hidden className="size-4" />
                    </span>
                  ) : (
                    <Avatar src={entry.avatarUrl} name={entry.name} presenceOf={entry.userId} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-ink">{name}</span>
                    <span className="truncate text-xs text-ink-muted">
                      {entry.entry === "owner"
                        ? t("role.owner")
                        : entry.entry === "folder_owner"
                          ? t("folderOwner")
                          : [
                              entry.source === "direct" ? t("direct") : t("fromFolder"),
                              entry.targetKind === "group" && entry.memberCount !== null
                                ? t("groupMembers", { count: entry.memberCount })
                                : null,
                              entry.canReshare ? t("reshareShort") : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                    </span>
                  </span>
                  {manageable ? (
                    <>
                      <select
                        aria-label={t("roleLabel", { name })}
                        className="field h-10 w-auto cursor-pointer py-0 text-sm"
                        value={entry.role === "editor" ? "editor" : "viewer"}
                        onChange={(event) => void change(entry, { role: event.target.value as ShareRole })}
                        data-testid="note-share-entry-role"
                      >
                        {roles.map((option) => (
                          <option key={option} value={option}>
                            {t(`role.${option}`)}
                          </option>
                        ))}
                      </select>
                      <Checkbox
                        aria-label={t("reshare")}
                        title={t("reshare")}
                        checked={entry.canReshare}
                        onCheckedChange={(value) => void change(entry, { canReshare: value === true })}
                      />
                      <button
                        type="button"
                        onClick={() => void remove(entry)}
                        aria-label={t("remove", { name })}
                        title={t("remove", { name })}
                        data-testid="note-share-remove"
                        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:bg-destructive/12 hover:text-destructive focus-visible:ring-3 focus-visible:ring-destructive/40 mouse:size-8"
                      >
                        <XIcon aria-hidden className="size-4" />
                      </button>
                    </>
                  ) : (
                    entry.entry !== "owner" && (
                      <span className={cn("shrink-0 text-sm", entry.role === "editor" ? "text-ink-soft" : "text-ink-muted")}>
                        {t(`role.${entry.role}`)}
                      </span>
                    )
                  )}
                </li>
              );
            })}
          </ul>
          {target?.item.kind === "note" && entries.some((entry) => entry.source === "folder") && (
            <p className="text-xs text-ink-muted">{t("overrideHint")}</p>
          )}
        </section>

        {error && (
          <p role="alert" className="text-sm text-pink">
            {error}
          </p>
        )}
      </div>
    </ResponsiveDialog>
  );
}
