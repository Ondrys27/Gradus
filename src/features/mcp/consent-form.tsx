"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BadgeCheckIcon, BookOpenIcon, PencilLineIcon, ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { ChoiceTile } from "@/features/settings/ui";
import { MCP_LEVELS, type McpLevel } from "./levels";
import { decideConsent, verifyConsentSecondFactor } from "./server/consent-actions";
import type { ConsentSpace } from "./server/consent";

const LEVEL_ICONS = { read: BookOpenIcon, write: PencilLineIcon, full: ShieldAlertIcon } as const;

/**
 * The consent screen's choices (28.8): the level and the companies. The
 * server checks all of it again; nothing here grants anything by itself.
 */
export function ConsentForm({
  params,
  clientName,
  redirectHost,
  verifiedClient,
  initialLevel,
  spaces,
  activeSpaceId,
  secondFactor,
}: {
  params: Record<string, string>;
  clientName: string;
  redirectHost: string | null;
  verifiedClient: boolean;
  initialLevel: McpLevel;
  spaces: ConsentSpace[];
  activeSpaceId: string | null;
  secondFactor: boolean;
}) {
  const t = useTranslations("mcp.consent");
  const router = useRouter();
  const [level, setLevel] = useState<McpLevel>(initialLevel);
  const open = spaces.filter((space) => space.open);
  const startIn = open.find((space) => space.spaceId === activeSpaceId) ?? open[0];
  const [chosen, setChosen] = useState<string[]>(startIn ? [startIn.spaceId] : []);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();

  if (secondFactor) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const result = await verifyConsentSecondFactor(code.trim());
            if (result.ok) router.refresh();
            else setError(t("errors.secondFactor"));
          });
        }}
      >
        <p className="text-sm text-ink-soft">{t("secondFactorHint")}</p>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          aria-label={t("secondFactorLabel")}
          className="text-center text-lg tracking-[0.4em]"
        />
        {error && <FormAlert>{error}</FormAlert>}
        <Button type="submit" disabled={pending || code.length !== 6}>
          {t("secondFactorSubmit")}
        </Button>
      </form>
    );
  }

  const decide = (allow: boolean) =>
    start(async () => {
      setError(null);
      const result = await decideConsent({
        params,
        allow,
        level,
        spaceIds: chosen,
        activeSpaceId:
          startIn && chosen.includes(startIn.spaceId) ? startIn.spaceId : (chosen[0] ?? ""),
      });
      // A redirect leaves the page; only a refusal comes back.
      if (result && !result.ok) setError(t(`errors.${result.error}`));
    });

  const spaceName = (space: ConsentSpace) =>
    space.role === "owner"
      ? t("ownCompany")
      : (space.companyName ?? space.ownerName ?? t("company"));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-sm text-ink-soft">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          {clientName}
          {verifiedClient && (
            <BadgeCheckIcon aria-label={t("verifiedClient")} className="size-4 text-teal" />
          )}
        </p>
        {redirectHost && <p>{t("returnsTo", { host: redirectHost })}</p>}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-ink">{t("levelLabel")}</legend>
        <div role="radiogroup" aria-label={t("levelLabel")} className="flex flex-col gap-2">
          {MCP_LEVELS.map((option) => {
            const Icon = LEVEL_ICONS[option];
            return (
              <ChoiceTile
                key={option}
                checked={level === option}
                onSelect={() => setLevel(option)}
                icon={<Icon className="size-4 shrink-0" aria-hidden />}
                title={t(`levels.${option}.title`)}
                description={t(`levels.${option}.description`)}
              />
            );
          })}
        </div>
        {level === "full" && <p className="text-xs text-orange">{t("fullWarning")}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-ink">{t("spacesLabel")}</legend>
        {spaces.length === 0 ? (
          <FormAlert>{t("errors.spaces")}</FormAlert>
        ) : (
          <ul className="flex flex-col gap-1">
            {spaces.map((space) => {
              const checked = chosen.includes(space.spaceId);
              return (
                <li key={space.spaceId}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface/60 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
                    <Checkbox
                      checked={checked}
                      disabled={!space.open}
                      onCheckedChange={(value) =>
                        setChosen((list) =>
                          value
                            ? [...list, space.spaceId]
                            : list.filter((id) => id !== space.spaceId),
                        )
                      }
                    />
                    <span className="flex flex-col">
                      <span className="text-sm text-ink">{spaceName(space)}</span>
                      {!space.open && (
                        <span className="text-xs text-ink-muted">{t("spaceClosed")}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-ink-muted">{t("spacesHint")}</p>
      </fieldset>

      {error && <FormAlert>{error}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" disabled={pending} onClick={() => decide(false)}>
          {t("deny")}
        </Button>
        <Button disabled={pending || chosen.length === 0} onClick={() => decide(true)}>
          {t("allow")}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">{t("revokeHint")}</p>
    </div>
  );
}
