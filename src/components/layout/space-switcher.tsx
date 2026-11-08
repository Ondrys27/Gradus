"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, LoaderCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { useSession } from "@/features/account/queries";
import { useSwitchSpace } from "@/features/account/space-switch";
import { spaceName, type SpaceMembership } from "@/features/account/spaces";
import { useCloseOnErrorScreen } from "@/features/errors/error-screen-state";
import { cn } from "@/lib/utils";

/** The spaces of the account and the active one. */
export function useSpaces() {
  const { spaces, spaceId, user } = useSession();
  const active = spaces.find((space) => space.spaceId === spaceId) ?? null;
  return {
    spaces,
    active,
    /** The account works in somebody else's company right now. */
    foreign: spaceId !== user.id,
    /** There is somewhere else to go: the switcher only shows then. */
    canSwitch: spaces.length > 1,
  };
}

/** The label of a space: "My company" for the own one, the company's name otherwise. */
export function useSpaceLabel() {
  const t = useTranslations("spaces");
  return useCallback(
    (space: SpaceMembership | null) =>
      !space || space.role === "owner" ? t("mine") : (spaceName(space) ?? t("unnamed")),
    [t],
  );
}

export function SpaceLogo({ space, className }: { space: SpaceMembership | null; className?: string }) {
  const label = useSpaceLabel();
  return (
    <Avatar
      src={space?.logoUrl}
      name={space ? (spaceName(space) ?? label(space)) : null}
      className={cn("size-7 rounded-lg border-teal/50 bg-teal/15 text-xs text-teal", className)}
    />
  );
}

const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none mouse:min-h-10 data-highlighted:bg-surface-hover data-highlighted:text-ink data-disabled:cursor-wait data-disabled:opacity-60";

/**
 * Top right, next to the account: which company the person works in and the
 * way to another. Only when there is another; in a company it shows the
 * company's name and colour, so it is always clear whose data is on screen.
 */
export function SpaceSwitcher({ className }: { className?: string }) {
  const t = useTranslations("spaces");
  const { spaces, active, foreign, canSwitch } = useSpaces();
  const label = useSpaceLabel();
  const { state, switchTo } = useSwitchSpace();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useCloseOnErrorScreen(close);
  if (!canSwitch) return null;

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        aria-label={t("switcher.open", { space: label(active) })}
        data-testid="space-switcher"
        className={cn(
          "inline-flex h-11 max-w-56 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-1.5 pr-3 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-9",
          foreign
            ? "border-teal/50 bg-teal/10 text-ink shadow-[0_0_18px_-6px_var(--color-teal)]"
            : "border-line bg-surface/60 text-ink-soft hover:text-ink",
          className,
        )}
      >
        <SpaceLogo space={active} className="size-7 mouse:size-6" />
        <span className="truncate" data-testid="space-current">
          {label(active)}
        </span>
        <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-popover">
          <Menu.Popup
            className={cn(
              "w-72 origin-(--transform-origin) rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none",
              "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            )}
          >
            <p className="micro-label px-3 py-1.5">{t("switcher.title")}</p>
            <SpaceItems
              spaces={spaces}
              activeId={active?.spaceId ?? null}
              busy={state === "switching"}
              render={(space, content, current) => (
                <Menu.Item
                  key={space.spaceId}
                  closeOnClick={false}
                  disabled={state === "switching"}
                  onClick={() => !current && void switchTo(space.spaceId)}
                  className={itemClass}
                >
                  {content}
                </Menu.Item>
              )}
            />
            {state === "failed" && (
              <p role="alert" className="px-3 py-2 text-xs text-pink">
                {t("switcher.failed")}
              </p>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The rows of the switcher, shared by the menu and the phone's More panel. */
function SpaceItems({
  spaces,
  activeId,
  busy,
  render,
}: {
  spaces: SpaceMembership[];
  activeId: string | null;
  busy: boolean;
  render: (space: SpaceMembership, content: ReactNode, current: boolean) => ReactNode;
}) {
  const t = useTranslations("spaces");
  const label = useSpaceLabel();
  return spaces.map((space) => {
    const current = space.spaceId === activeId;
    const sub =
      space.role === "owner"
        ? (space.companyName ?? t("mineHint"))
        : space.companyName && space.ownerName
          ? space.ownerName
          : t("workerHint");
    return render(
      space,
      <>
        <SpaceLogo space={space} className="size-8" />
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className={cn("truncate", current && "font-semibold text-ink")}>{label(space)}</span>
          <span className="truncate text-xs text-ink-muted">{sub}</span>
        </span>
        {current ? (
          <CheckIcon aria-label={t("switcher.current")} className="size-4 shrink-0 text-violet" />
        ) : busy ? (
          <LoaderCircleIcon aria-hidden className="size-4 shrink-0 animate-spin text-ink-muted motion-reduce:animate-none" />
        ) : null}
      </>,
      current,
    );
  });
}

/** The switcher in the phone's More panel. */
export function SpaceList() {
  const t = useTranslations("spaces");
  const { spaces, active, canSwitch } = useSpaces();
  const { state, switchTo } = useSwitchSpace();
  if (!canSwitch) return null;
  return (
    <section aria-label={t("switcher.title")} className="mb-4 border-b border-line pb-3">
      <p className="micro-label flex items-center gap-2 px-1 pb-2">
        <Building2Icon aria-hidden className="size-3.5" />
        {t("switcher.title")}
      </p>
      <ul className="flex flex-col gap-1">
        <SpaceItems
          spaces={spaces}
          activeId={active?.spaceId ?? null}
          busy={state === "switching"}
          render={(space, content, current) => (
            <li key={space.spaceId}>
              <button
                type="button"
                disabled={state === "switching"}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  if (!current) void switchTo(space.spaceId);
                }}
                className={cn(
                  "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait",
                  current ? "bg-violet/15 text-ink" : "text-ink-soft",
                )}
              >
                {content}
              </button>
            </li>
          )}
        />
      </ul>
      {state === "failed" && (
        <p role="alert" className="px-1 pt-2 text-xs text-pink">
          {t("switcher.failed")}
        </p>
      )}
    </section>
  );
}

/**
 * In a company: a teal line along the top of the bar, and on phones the
 * company's name next to the logo, so it is always clear where one is.
 */
export function SpaceStripe() {
  const { foreign } = useSpaces();
  if (!foreign) return null;
  return (
    <span
      aria-hidden
      data-testid="space-stripe"
      className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-teal shadow-[0_0_12px_var(--color-teal)]"
    />
  );
}

export function SpaceBadge({ className }: { className?: string }) {
  const t = useTranslations("spaces");
  const { active, foreign } = useSpaces();
  const label = useSpaceLabel();
  if (!foreign) return null;
  return (
    <span
      title={t("badge", { space: label(active) })}
      className={cn(
        "inline-flex h-7 min-w-0 max-w-40 items-center gap-1.5 rounded-full border border-teal/50 bg-teal/10 px-2 text-xs font-semibold text-teal",
        className,
      )}
    >
      <Building2Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{label(active)}</span>
    </span>
  );
}
