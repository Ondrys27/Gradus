"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input, Label } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { track } from "@/lib/analytics/client";
import { customView, CUSTOM_THEMES_MAX } from "../custom-tokens";
import { saveErrorCode, useCustomThemes, useSaveCustomTheme, useSharedTheme, type CustomTheme } from "../queries";
import { formatShareCode, parseShareCode, shareLink } from "../share";
import { ThemeMiniature } from "./theme-miniature";

function CopyRow({
  id,
  label,
  value,
  onCopied,
}: {
  id: string;
  label: string;
  value: string;
  onCopied: () => void;
}) {
  const t = useTranslations("settings.appearance.share");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              onCopied();
            });
          }}
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}

/** "Share": the theme's code and link for a colleague from the same company. */
export function ShareThemeDialog({ theme, onClose }: { theme: CustomTheme | null; onClose: () => void }) {
  const t = useTranslations("settings.appearance.share");
  const tc = useTranslations("settings.appearance");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <ResponsiveDialog
      open={theme !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("title", { name: theme?.name ?? "" })}
      closeLabel={tc("close")}
    >
      {theme && (
        <div className="flex flex-col gap-4" data-testid="share-theme-dialog">
          <p className="text-sm text-ink-soft">{t("description")}</p>
          <CopyRow
            id="share-theme-code"
            label={t("code")}
            value={formatShareCode(theme.shareCode)}
            onCopied={() => track("custom_theme_shared", { via: "code" })}
          />
          <CopyRow
            id="share-theme-link"
            label={t("link")}
            value={shareLink(origin, theme.shareCode)}
            onCopied={() => track("custom_theme_shared", { via: "link" })}
          />
        </div>
      )}
    </ResponsiveDialog>
  );
}

/** "Import": a colleague's code or link → a preview → a copy among the user's own themes. */
export function ImportThemeDialog({
  open,
  initialCode,
  onClose,
  onImported,
}: {
  open: boolean;
  initialCode: string | null;
  onClose: () => void;
  onImported: (theme: CustomTheme) => void;
}) {
  const t = useTranslations("settings.appearance.import");
  const tc = useTranslations("settings.appearance");
  const [text, setText] = useState(initialCode ?? "");
  useEffect(() => {
    if (open) setText(initialCode ?? "");
  }, [open, initialCode]);
  const code = parseShareCode(text);
  const shared = useSharedTheme(open ? code : null);
  const own = useCustomThemes().data ?? [];
  const save = useSaveCustomTheme();
  const full = own.length >= CUSTOM_THEMES_MAX;

  const add = () => {
    if (!shared.data) return;
    save.mutate(
      { name: shared.data.name, tokens: shared.data.tokens },
      {
        onSuccess: (theme) => {
          track("custom_theme_saved", {
            action: "imported",
            base: theme.tokens.base,
            generated: false,
            fixes: 0,
          });
          onImported(theme);
        },
      },
    );
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("title")}
      closeLabel={tc("close")}
    >
      <div className="flex flex-col gap-4" data-testid="import-theme-dialog">
        <p className="text-sm text-ink-soft">{t("description")}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-theme-code">{t("code")}</Label>
          <Input
            id="import-theme-code"
            value={text}
            autoComplete="off"
            placeholder={t("placeholder")}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        {text.trim() && !code && <p className="text-sm text-ink-muted">{t("badCode")}</p>}
        {code && shared.isPending && <p className="text-sm text-ink-muted">{t("looking")}</p>}
        {code && shared.isSuccess && !shared.data && <FormAlert>{t("notFound")}</FormAlert>}
        {shared.data && (
          <div className="flex items-center gap-3 rounded-xl border border-line p-2">
            <ThemeMiniature view={customView(shared.data.tokens)} className="w-28 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink" data-testid="import-theme-name">
                {shared.data.name}
              </p>
              {shared.data.author && (
                <p className="truncate text-xs text-ink-muted">{t("by", { name: shared.data.author })}</p>
              )}
            </div>
          </div>
        )}
        {full && <FormAlert>{t("full", { max: CUSTOM_THEMES_MAX })}</FormAlert>}
        {save.error && <FormAlert>{t(`errors.${saveErrorCode(save.error)}`, { max: CUSTOM_THEMES_MAX })}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button type="button" disabled={!shared.data || full || save.isPending} onClick={add}>
            {t("add")}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
