"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClapperboardIcon, PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { locales } from "@/i18n/locales";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  SCENARIO_IDS,
  SHOWCASE_SIZES,
  showcaseHref,
  showcaseSearch,
  type ScenarioChoice,
  type ShowcaseParams,
} from "./params";
import { START_EVENT, writeShowcaseConfig } from "./stage-store";

/**
 * /app/ukazka (step 27.4). For the presenter: what to play, in which
 * language and for which canvas, and Start, which makes a fresh stage
 * account and signs this browser into it (the presenter's own session ends;
 * the stage is deleted when the showcase ends). On the stage: hands the
 * scenario to the host in the app frame and goes to the dashboard, where
 * the countdown begins.
 */
export function ShowcaseStart({
  role,
  params,
}: {
  role: "presenter" | "stage";
  params: ShowcaseParams;
}) {
  const t = useTranslations("showcase");
  const router = useRouter();

  useEffect(() => {
    if (role !== "stage") return;
    writeShowcaseConfig(params);
    window.dispatchEvent(new Event(START_EVENT));
    router.replace("/app");
  }, [role, params, router]);

  if (role === "stage") {
    return <p className="py-24 text-center text-ink-muted">{t("preparing")}</p>;
  }
  return <PresenterStart initial={params} />;
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  name: (value: T) => string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink-soft">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center rounded-xl border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
              value === option
                ? "border-violet/60 bg-violet/15 text-ink"
                : "border-line text-ink-soft hover:text-ink",
            )}
          >
            {name(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function PresenterStart({ initial }: { initial: ShowcaseParams }) {
  const t = useTranslations("showcase");
  const [params, setParams] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const scenarios: ScenarioChoice[] = [...SCENARIO_IDS, "all"];

  async function start() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/showcase/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new URLSearchParams(showcaseSearch(params)))),
      });
      if (!response.ok) throw new Error(String(response.status));
      // Signed into the stage now: a full load starts the app as that account.
      window.location.assign(showcaseHref(params));
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description", { appName: APP_NAME })} />
      <section className="flex flex-col gap-6 rounded-card border border-line bg-surface p-5 md:p-6">
        <Choice
          label={t("pick.scenario")}
          options={scenarios}
          value={params.scenario}
          onChange={(scenario) => setParams({ ...params, scenario })}
          name={(scenario) => t(`scenarios.${scenario}.title`)}
        />
        <Choice
          label={t("pick.language")}
          options={locales}
          value={params.locale}
          onChange={(locale) => setParams({ ...params, locale })}
          name={(locale) => t(`languages.${locale}`)}
        />
        <Choice
          label={t("pick.size")}
          options={SHOWCASE_SIZES}
          value={params.size}
          onChange={(size) => setParams({ ...params, size })}
          name={(size) => t(`sizes.${size}`)}
        />
        <p className="text-sm text-ink-soft">{t(`scenarios.${params.scenario}.text`)}</p>
        <ul className="flex flex-col gap-1 text-sm text-ink-muted">
          <li>{t("keys.space")}</li>
          <li>{t("keys.restart")}</li>
          <li>{t("keys.escape")}</li>
          <li>{t("keys.size")}</li>
        </ul>
        <p className="flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-ink">
          <ClapperboardIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
          {t("stageNote")}
        </p>
        {failed && <FormAlert>{t("startFailed")}</FormAlert>}
        <Button size="lg" className="self-start" disabled={pending} onClick={() => void start()}>
          <PlayIcon aria-hidden data-icon="inline-start" />
          {pending ? t("starting") : t("start")}
        </Button>
      </section>
    </div>
  );
}
