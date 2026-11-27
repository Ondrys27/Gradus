"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckIcon, ChevronDownIcon, SparklesIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/features/account/queries";
import { useSettingsSave } from "@/features/settings/save-state";
import { track } from "@/lib/analytics/client";
import { APP_NAME } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { THEMES, type ThemeKey } from "@/lib/themes";
import { usePageScrollLock } from "@/lib/scroll-lock";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { BUILTIN_PALETTES } from "../builtin-palettes";
import {
  cleanThemeName,
  contrastIssues,
  customView,
  CUSTOM_THEME_NAME_MAX,
  fixAllContrast,
  fixContrast,
  generateFromColor,
  HEADING_FONTS,
  RADIUS_MAX,
  RADIUS_MIN,
  STATUS_COLORS,
  THEME_BACKDROPS,
  THEME_BASES,
  THEME_DENSITIES,
  THEME_SHADOWS,
  tokensFromBuiltin,
  type ContrastIssue,
  type CustomThemeTokens,
  type ThemeColorKey,
} from "../custom-tokens";
import { saveErrorCode, useCustomThemes, useCustomThemesAllowed, useSaveCustomTheme } from "../queries";
import { manualPickPatch } from "../schedule";
import { APPEARANCE_PATH } from "../share";
import { customRef } from "../theme-ref";
import { ColorField } from "./color-field";
import { EditorPreview, PREVIEW_SCENES, type PreviewScene } from "./editor-preview";
import { ThemeMiniature } from "./theme-miniature";

const MAIN_COLORS: ThemeColorKey[] = ["canvas", "surface", "ink", "accent", "accent2"];

/** The font each heading option is shown in (the variables of root-document.tsx). */
const FONT_SAMPLE: Record<(typeof HEADING_FONTS)[number], string> = {
  inter: "var(--font-inter)",
  poppins: "var(--font-heading-poppins)",
  bricolage: "var(--font-heading-bricolage)",
  space_grotesk: "var(--font-heading-space-grotesk)",
  fraunces: "var(--font-heading-fraunces)",
  sora: "var(--font-heading-sora)",
};

/** The generated palette with the shape choices of the current one kept. */
function regenerate(current: CustomThemeTokens, seed: string, base: CustomThemeTokens["base"]): CustomThemeTokens {
  const next = generateFromColor(seed, base);
  return { ...next, radius: current.radius, density: current.density, headingFont: current.headingFont, shadow: current.shadow, backdrop: current.backdrop };
}

/** A folding section; closed, it shows a one-line summary of what is set inside. */
function Section({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} data-editor-section={id} className="group rounded-2xl border border-line bg-surface/60 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <span className="shrink-0">{title}</span>
        {summary && <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs font-normal text-ink-muted group-open:hidden">{summary}</span>}
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  name,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  name: (option: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "min-h-11 cursor-pointer rounded-xl border px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
              value === option ? "border-violet/60 bg-violet/10 text-ink" : "border-line text-ink-soft hover:border-line-strong",
            )}
          >
            {name(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The five colours of a theme as dots, the closed summary of the Colours section. */
function Swatches({ tokens }: { tokens: CustomThemeTokens }) {
  return (
    <span className="flex items-center -space-x-1" aria-hidden>
      {MAIN_COLORS.map((key) => (
        <span key={key} className="size-4 rounded-full border border-surface" style={{ backgroundColor: tokens.colors[key] }} />
      ))}
    </span>
  );
}

/**
 * Settings → Appearance → "Create your own": the whole screen, the controls
 * on the left, on the right a live preview of the app in the theme. The
 * controls go from the one choice that makes a whole theme (one colour, or
 * one of six starting points; the palette follows the colour as it is
 * dragged) to the details in folded sections. Contrast is checked as it
 * changes; a theme whose text would not read cannot be saved, every problem
 * has a one-click repair.
 */
export function ThemeEditor() {
  const t = useTranslations("settings.appearance.editor");
  const ta = useTranslations("settings.appearance");
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get("id");
  const customs = useCustomThemes();
  const allowed = useCustomThemesAllowed().data !== false;
  const settings = useUserSettings();
  const { save: saveSettings } = useSettingsSave();
  const format = useFormatSettings();
  const save = useSaveCustomTheme();
  usePageScrollLock();

  const editing = editId ? customs.data?.find((theme) => theme.id === editId) ?? null : null;
  const startTheme: ThemeKey = (THEMES as readonly string[]).includes(settings.theme) ? (settings.theme as ThemeKey) : "gradus";
  const [tokens, setTokens] = useState<CustomThemeTokens>(() => tokensFromBuiltin(startTheme));
  const [name, setName] = useState("");
  const [loaded, setLoaded] = useState(editId === null);
  const [seed, setSeed] = useState(BUILTIN_PALETTES[startTheme].violet);
  const [scene, setScene] = useState<PreviewScene>("dashboard");
  const [generated, setGenerated] = useState(false);
  const [fixes, setFixes] = useState(0);
  const [statesOn, setStatesOn] = useState(false);

  useEffect(() => {
    if (loaded || !editing) return;
    setTokens(editing.tokens);
    setName(editing.name);
    setSeed(editing.tokens.colors.accent);
    setStatesOn(STATUS_COLORS.some((key) => editing.tokens.colors[key]));
    setLoaded(true);
  }, [editing, loaded]);

  const view = useMemo(() => customView(tokens), [tokens]);
  const issues = contrastIssues(tokens);
  const cleanName = cleanThemeName(name);
  const missing = editId !== null && customs.isSuccess && !editing;
  const canSave = loaded && allowed && issues.length === 0 && cleanName !== null && !save.isPending && !missing;

  const setColor = (key: ThemeColorKey, hex: string) =>
    setTokens((current) => ({ ...current, colors: { ...current.colors, [key]: hex } }));
  const issueOf = (key: ThemeColorKey) => issues.find((issue) => issue.color === key) ?? null;
  const describe = (issue: ContrastIssue) =>
    t("contrast.issue", {
      color: t(`colors.${issue.color}`),
      against: t(`colors.${issue.against}`),
      ratio: formatNumber(issue.ratio, { decimals: 1 }, format),
      min: formatNumber(issue.min, { decimals: 1 }, format),
    });
  const fixOne = (issue: ContrastIssue) => {
    setTokens((current) => fixContrast(current, issue));
    setFixes((count) => count + 1);
  };

  // The one colour: every change repaints the whole palette at once.
  const applySeed = (hex: string, base = tokens.base) => {
    setSeed(hex);
    setTokens((current) => regenerate(current, hex, base));
    setStatesOn(false);
    setGenerated(true);
  };

  const submit = () => {
    if (!canSave || !cleanName) return;
    const action = editing ? "updated" : "created";
    save.mutate(
      { id: editing?.id, name: cleanName, tokens },
      {
        onSuccess: (theme) => {
          track("custom_theme_saved", { action, base: theme.tokens.base, generated, fixes: Math.min(50, fixes) });
          // A new theme is put on at once; an edited one repaints wherever it is used.
          if (action === "created") saveSettings(manualPickPatch(customRef(theme.id), settings, Date.now()));
          router.push(APPEARANCE_PATH);
        },
      },
    );
  };

  const shapeSummary = [
    t("px", { value: formatNumber(tokens.radius, {}, format) }),
    t(`densities.${tokens.density}`),
    t(`backdrops.${tokens.backdrop}`),
  ].join(" · ");

  return (
    <div
      className="fixed inset-0 z-overlay flex flex-col bg-canvas"
      data-testid="theme-editor"
      role="region"
      aria-label={editing ? t("titleEdit") : t("titleNew")}
    >
      <header className="flex items-center gap-2 border-b border-line px-[max(--spacing(3),env(safe-area-inset-left))] pt-[max(--spacing(2),env(safe-area-inset-top))] pb-2 md:px-6">
        <Link href={APPEARANCE_PATH} aria-label={t("close")} className={buttonVariants({ variant: "ghost", size: "icon" })}>
          <XIcon aria-hidden />
        </Link>
        <h1 className="hidden text-base font-semibold text-ink sm:block">{editing ? t("titleEdit") : t("titleNew")}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" onClick={submit} disabled={!canSave} data-testid="theme-editor-save">
            <CheckIcon aria-hidden />
            {t("save")}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] md:grid-rows-1">
        <div className="order-2 flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-line p-3 pb-[max(--spacing(4),env(safe-area-inset-bottom))] md:order-1 md:border-t-0 md:border-r md:p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="theme-editor-name" className="text-[13px] font-medium text-ink-soft">
              {t("name")}
            </label>
            <Input
              id="theme-editor-name"
              value={name}
              maxLength={CUSTOM_THEME_NAME_MAX}
              placeholder={t("namePlaceholder")}
              aria-invalid={name.length > 0 && !cleanName ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {missing && <FormAlert>{t("missing")}</FormAlert>}
          {!allowed && <FormAlert>{ta("notInPlan")}</FormAlert>}

          <Section id="oneColor" title={t("sections.oneColor")} defaultOpen>
            <p className="text-[13px] text-ink-muted">{t("oneColorHint")}</p>
            <Segmented
              label={t("base")}
              value={tokens.base}
              options={THEME_BASES}
              name={(option) => t(`bases.${option}`)}
              onChange={(base) => {
                if (base !== tokens.base) applySeed(seed, base);
              }}
            />
            <ColorField id="theme-seed" label={t("seed")} value={seed} onChange={(hex) => applySeed(hex)} />
            <span className="pt-1 text-[13px] font-medium text-ink-soft">{t("startFrom")}</span>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  data-theme-start={theme}
                  onClick={() => {
                    setTokens(tokensFromBuiltin(theme));
                    setSeed(BUILTIN_PALETTES[theme].violet);
                    setStatesOn(false);
                  }}
                  className="flex cursor-pointer flex-col gap-1 rounded-xl border border-line p-1 text-left outline-none transition-colors hover:border-line-strong focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
                >
                  <ThemeMiniature view={customView(tokensFromBuiltin(theme))} />
                  <span className="truncate px-1 text-xs text-ink-soft">{ta(`themes.${theme}`, { appName: APP_NAME })}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section id="colors" title={t("sections.colors")} summary={<Swatches tokens={tokens} />}>
            {MAIN_COLORS.map((key) => {
              const issue = issueOf(key);
              return (
                <ColorField
                  key={key}
                  id={`theme-color-${key}`}
                  label={t(`colors.${key}`)}
                  value={tokens.colors[key] ?? "#000000"}
                  warning={issue ? describe(issue) : null}
                  onChange={(hex) => setColor(key, hex)}
                />
              );
            })}
            <div className="flex items-center justify-between gap-3 pt-1">
              <label htmlFor="theme-states" className="text-[13px] font-medium text-ink-soft">
                {t("statesToggle")}
              </label>
              <Switch
                id="theme-states"
                checked={statesOn}
                onCheckedChange={(on) => {
                  setStatesOn(on);
                  setTokens((current) => {
                    const colors = { ...current.colors };
                    const base = BUILTIN_PALETTES[current.base === "light" ? "light" : "gradus"];
                    if (on) {
                      colors.success = base.green;
                      colors.warning = base.orange;
                      colors.danger = base.pink;
                    } else {
                      delete colors.success;
                      delete colors.warning;
                      delete colors.danger;
                    }
                    return { ...current, colors };
                  });
                }}
              />
            </div>
            {statesOn &&
              STATUS_COLORS.map((key) => {
                const issue = issueOf(key);
                return (
                  <ColorField
                    key={key}
                    id={`theme-color-${key}`}
                    label={t(`colors.${key}`)}
                    value={tokens.colors[key] ?? "#000000"}
                    warning={issue ? describe(issue) : null}
                    onChange={(hex) => setColor(key, hex)}
                  />
                );
              })}
          </Section>

          <Section id="shape" title={t("sections.shape")} summary={<span className="truncate">{shapeSummary}</span>}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="theme-radius" className="flex justify-between text-[13px] font-medium text-ink-soft">
                {t("radius")}
                <span className="tabular-nums text-ink-muted">{t("px", { value: formatNumber(tokens.radius, {}, format) })}</span>
              </label>
              <input
                id="theme-radius"
                type="range"
                min={RADIUS_MIN}
                max={RADIUS_MAX}
                step={1}
                value={tokens.radius}
                onChange={(event) => setTokens((current) => ({ ...current, radius: Number(event.target.value) }))}
                className="h-11 w-full cursor-pointer accent-(--color-violet)"
              />
            </div>
            <Segmented
              label={t("density")}
              value={tokens.density}
              options={THEME_DENSITIES}
              name={(option) => t(`densities.${option}`)}
              onChange={(density) => setTokens((current) => ({ ...current, density }))}
            />
            <Segmented
              label={t("shadow")}
              value={tokens.shadow}
              options={THEME_SHADOWS}
              name={(option) => t(`shadows.${option}`)}
              onChange={(shadow) => setTokens((current) => ({ ...current, shadow }))}
            />
            <Segmented
              label={t("backdrop")}
              value={tokens.backdrop}
              options={THEME_BACKDROPS}
              name={(option) => t(`backdrops.${option}`)}
              onChange={(backdrop) => setTokens((current) => ({ ...current, backdrop }))}
            />
          </Section>

          <Section
            id="font"
            title={t("sections.font")}
            summary={
              <span className="truncate" style={{ fontFamily: FONT_SAMPLE[tokens.headingFont] }}>
                {t(`fonts.${tokens.headingFont}`)}
              </span>
            }
          >
            <div role="radiogroup" aria-label={t("headingFont")} className="grid grid-cols-2 gap-2">
              {HEADING_FONTS.map((font) => (
                <button
                  key={font}
                  type="button"
                  role="radio"
                  aria-checked={tokens.headingFont === font}
                  onClick={() => setTokens((current) => ({ ...current, headingFont: font }))}
                  className={cn(
                    "flex min-h-14 cursor-pointer flex-col items-start justify-center rounded-xl border px-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    tokens.headingFont === font ? "border-violet/60 bg-violet/10" : "border-line hover:border-line-strong",
                  )}
                >
                  <span className="text-lg font-semibold text-ink" style={{ fontFamily: FONT_SAMPLE[font] }}>
                    {t("fontSample")}
                  </span>
                  <span className="text-xs text-ink-muted">{t(`fonts.${font}`)}</span>
                </button>
              ))}
            </div>
          </Section>

          <div
            aria-live="polite"
            data-testid="theme-contrast"
            className={cn(
              "flex flex-col gap-2 rounded-2xl border p-3",
              issues.length ? "border-orange/50 bg-orange/10" : "border-green/40 bg-green/10",
            )}
          >
            {issues.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-ink">
                <CheckIcon aria-hidden className="size-4 text-green" />
                {t("contrast.ok")}
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-ink">{t("contrast.problems", { count: issues.length })}</p>
                <ul className="flex flex-col gap-1.5">
                  {issues.map((issue) => (
                    <li key={`${issue.color}-${issue.against}`} className="flex items-center justify-between gap-2 text-[13px]">
                      <span>{describe(issue)}</span>
                      <Button type="button" size="sm" variant="secondary" onClick={() => fixOne(issue)}>
                        {t("contrast.fix")}
                      </Button>
                    </li>
                  ))}
                </ul>
                {issues.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    data-testid="theme-fix-all"
                    onClick={() => {
                      setTokens((current) => fixAllContrast(current));
                      setFixes((count) => count + issues.length);
                    }}
                  >
                    <SparklesIcon aria-hidden />
                    {t("contrast.fixAll")}
                  </Button>
                )}
              </>
            )}
          </div>
          {save.error && (
            <FormAlert>{ta(`import.errors.${saveErrorCode(save.error)}`, { max: 12 })}</FormAlert>
          )}
        </div>

        <div className="order-1 flex min-h-0 flex-col gap-2 p-3 md:order-2 md:p-4">
          <div role="tablist" aria-label={t("previewLabel")} className="flex gap-1 overflow-x-auto">
            {PREVIEW_SCENES.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={scene === option}
                data-preview-scene={option}
                onClick={() => setScene(option)}
                className={cn(
                  "min-h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
                  scene === option ? "bg-surface-hover text-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {t(`scenes.${option}`)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <EditorPreview view={view} scene={scene} />
          </div>
        </div>
      </div>
    </div>
  );
}
