"use client";

import { useMemo } from "react";
import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/features/account/queries";
import { cn } from "@/lib/utils";
import { InvoicePaper } from "./document/html";
import { sampleInvoice } from "./document/sample";
import { useInvoiceDocument } from "./document/use-document";
import { paymentIban } from "./iban";
import { InvoiceProfileForm, profileToInput } from "./profile-form";
import { useInvoiceProfile, useSaveInvoiceProfile } from "./queries";
import { ACCENT_PRESETS, INVOICE_STYLES, supplierFromProfile, type InvoiceProfile, type InvoiceStyle } from "./types";

/** Settings → Invoices: the supplier's details, then the look of the invoices. Owner only. */
export function InvoiceSettings() {
  const t = useTranslations("invoices.settings");
  const profile = useInvoiceProfile();

  if (profile.isPending) return <Skeleton className="h-96 w-full" />;
  if (profile.isError) return <p className="text-sm text-pink">{t("loadFailed")}</p>;

  return (
    <div className="flex flex-col gap-8">
      {/* A new key after the first save, so the form starts from what was saved. */}
      <InvoiceProfileForm
        key={profile.data ? "saved" : "new"}
        profile={profile.data}
        submitLabel={t("saveDetails")}
      />
      {profile.data ? (
        <InvoiceLook profile={profile.data} />
      ) : (
        <p className="text-sm text-ink-muted">{t("lookAfterDetails")}</p>
      )}
    </div>
  );
}

function InvoiceLook({ profile }: { profile: InvoiceProfile }) {
  const t = useTranslations("invoices.settings");
  const tStyles = useTranslations("invoices.styles");
  const settings = useUserSettings();
  const save = useSaveInvoiceProfile();
  const change = (patch: Partial<InvoiceProfile>) => save.mutate(profileToInput({ ...profile, ...patch }));
  const czech = settings.country_code === "CZ";
  const hasIban = Boolean(paymentIban(profile));

  return (
    <div className="flex flex-col gap-6 border-t border-line pt-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-ink">{t("styleTitle")}</h3>
        <p className="text-sm text-ink-soft">{t("styleHint")}</p>
      </div>
      <div role="radiogroup" aria-label={t("styleTitle")} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {INVOICE_STYLES.map((style) => (
          <StyleChoice
            key={style}
            style={style}
            profile={profile}
            checked={profile.style === style}
            label={tStyles(`${style}.name`)}
            description={tStyles(`${style}.description`)}
            onSelect={() => change({ style })}
          />
        ))}
      </div>

      {profile.style === "line" && (
        <div className="flex flex-col gap-3">
          <span id="invoice-accent-label" className="text-sm font-medium text-ink">
            {t("accent")}
          </span>
          <div role="radiogroup" aria-labelledby="invoice-accent-label" className="flex flex-wrap items-center gap-3">
            {ACCENT_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={profile.accent_color === color}
                aria-label={t("accentPreset", { color })}
                onClick={() => change({ accent_color: color })}
                className="grid size-11 cursor-pointer place-items-center rounded-full border border-line outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9"
                style={{ backgroundColor: color }}
              >
                {profile.accent_color === color && <CheckIcon aria-hidden className="size-4 text-white" />}
              </button>
            ))}
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft">
              <input
                type="color"
                value={profile.accent_color.toLowerCase()}
                onChange={(event) => change({ accent_color: event.target.value.toUpperCase() })}
                className="size-9 cursor-pointer rounded-full border border-line bg-transparent"
              />
              {t("accentCustom")}
            </label>
          </div>
        </div>
      )}

      {czech && (
        <div className="flex flex-col gap-2">
          <label htmlFor="invoice-qr" className="flex min-h-11 items-center justify-between gap-4">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">{t("qr")}</span>
              <span className="text-xs text-ink-muted">{t("qrHint")}</span>
            </span>
            <Switch
              id="invoice-qr"
              checked={profile.qr_enabled}
              onCheckedChange={(checked) => change({ qr_enabled: checked })}
            />
          </label>
          {profile.qr_enabled && profile.currency !== "CZK" && (
            <p className="text-xs text-gold">{t("qrCurrency", { currency: profile.currency })}</p>
          )}
          {profile.qr_enabled && !hasIban && <p className="text-xs text-gold">{t("qrAccount")}</p>}
        </div>
      )}
      {save.isError && <p className="text-sm text-pink">{t("lookFailed")}</p>}
    </div>
  );
}

function StyleChoice({
  style,
  profile,
  checked,
  label,
  description,
  onSelect,
}: {
  style: InvoiceStyle;
  profile: InvoiceProfile;
  checked: boolean;
  label: string;
  description: string;
  onSelect: () => void;
}) {
  const t = useTranslations("invoices.settings");
  const input = useMemo(() => {
    const sample = sampleInvoice(style, { accent: profile.accent_color, vatPayer: profile.vat_payer });
    return { ...sample, supplier: { ...sample.supplier, ...supplierFromProfile(profile) } };
  }, [style, profile]);
  const doc = useInvoiceDocument(input);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-2xl border p-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
        checked ? "border-violet bg-violet/10" : "border-line hover:border-line-strong",
      )}
    >
      {doc && <InvoicePaper doc={doc} label={t("thumbnail", { style: label })} className="pointer-events-none" />}
      <span className="flex items-center gap-2 px-1 text-sm font-semibold text-ink">
        {label}
        {checked && <CheckIcon aria-hidden className="size-4 text-violet" />}
      </span>
      <span className="px-1 pb-1 text-xs text-ink-muted">{description}</span>
    </button>
  );
}
