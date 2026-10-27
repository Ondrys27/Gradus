"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useUserSettings } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { SortableList } from "@/features/contacts/sortable-list";
import { Segmented } from "@/features/finance/segmented";
import { contactLabel } from "@/features/pipeline/board-logic";
import { useContactSearch } from "@/features/pipeline/queries";
import { countryName, CURRENCIES, formatCurrency, formatNumber, todayIsoDate } from "@/lib/format";
import { COUNTRY_CODES } from "@/lib/region";
import { createClient } from "@/lib/supabase/client";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { InvoicePaper } from "./document/html";
import type { DocumentInput } from "./document/model";
import { useInvoiceDocument } from "./document/use-document";
import {
  defaultVatRate,
  draftFromRecord,
  emptyDraft,
  moveItem,
  newItem,
  parseItems,
  partyFromContact,
  shiftDays,
  toDraftInput,
  type EditorDraft,
  type ItemDraft,
  type PartyField,
} from "./editor-logic";
import { errorCodeOf } from "./errors";
import { useDeleteDraft, useIssueInvoice, useSaveInvoiceDraft } from "./queries";
import { SimpleSelect } from "./simple-select";
import { computeInvoiceTotals, lineTotal } from "./totals";
import { CZ_VAT_RATES, invoicePath, supplierFromProfile, type InvoiceParty, type InvoiceProfile, type InvoiceRecord } from "./types";

export const INVOICES_PATH = "/app/finance?tab=invoices";

type Pane = "form" | "preview";

/**
 * One page for a draft: the customer, the items, the dates and a live
 * preview of the invoice next to it (a tab on phones). Save draft keeps it
 * as it is; Issue numbers it and freezes it for good.
 */
export function InvoiceEditor({
  record,
  profile,
}: {
  record: InvoiceRecord | null;
  profile: InvoiceProfile;
}) {
  const t = useTranslations("invoices.editor");
  const tFailure = useTranslations("finance.invoiceErrors");
  const uiLocale = useLocale();
  const router = useRouter();
  const settings = useFormatSettings();
  const userSettings = useUserSettings();
  const isOwner = useWorkspace().role === "owner";
  const decimalComma = formatNumber(1.5, { decimals: 1 }, settings).includes(",");
  const today = todayIsoDate(settings);

  const [draft, setDraft] = useState<EditorDraft>(() =>
    record
      ? draftFromRecord(record, { profile, today, decimalComma })
      : emptyDraft({
          profile,
          today,
          locale: uiLocale === "en" ? "en" : "cs",
          currency: settings.currency,
          unit: t("defaultUnit"),
          decimalComma,
        }),
  );
  const [pane, setPane] = useState<Pane>("form");
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<"saved" | "contactNotSaved" | null>(null);
  const save = useSaveInvoiceDraft();
  const issue = useIssueInvoice();
  const remove = useDeleteDraft();

  const vatMode = profile.vat_payer ? "vat" : "none";
  const czechRates = profile.country === "CZ";
  const parsed = useMemo(() => parseItems(draft.items, vatMode), [draft.items, vatMode]);
  const totals = computeInvoiceTotals(parsed.items, vatMode, draft.currency);
  const money = (value: number) => formatCurrency(value, draft.currency, settings, 2);
  // A worker cannot read the owner's settings; the supplier's country stands in.
  const ownerCountry = isOwner ? userSettings.country_code : profile.country;
  const qr = profile.qr_enabled && draft.currency === "CZK" && ownerCountry === "CZ";

  const previewInput = useMemo<DocumentInput>(
    () => ({
      kind: "invoice",
      number: null,
      issuedOn: draft.issuedOn,
      taxableOn: vatMode === "vat" ? (draft.taxableOn ?? draft.issuedOn) : null,
      dueOn: draft.dueOn,
      currency: draft.currency,
      supplier: supplierFromProfile(profile),
      customer: Object.fromEntries(
        Object.entries(draft.customer).filter(([, value]) => value.trim() !== ""),
      ) as InvoiceParty,
      items: parsed.items,
      vatMode,
      variableSymbol: draft.variableSymbol || null,
      note: draft.note.trim() || null,
      style: profile.style,
      accent: profile.accent_color,
      qr,
      locale: draft.locale,
    }),
    [draft, parsed.items, profile, vatMode, qr],
  );
  const doc = useInvoiceDocument(previewInput);

  const update = (patch: Partial<EditorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSavedAt(null);
  };
  const updateCustomer = (field: PartyField, value: string) =>
    update({ customer: { ...draft.customer, [field]: value } });
  const updateItem = (id: string, patch: Partial<ItemDraft>) =>
    update({ items: draft.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });

  const busy = save.isPending || issue.isPending;
  const failure = save.error ?? issue.error;

  function check(): string[] {
    const found: string[] = [];
    if (!draft.customer.name.trim()) found.push("customerRequired");
    if (Object.keys(parsed.errors).length) found.push("itemsInvalid");
    if (!parsed.items.length || parsed.items.some((item) => !item.name)) found.push("itemsRequired");
    if (totals.total <= 0) found.push("totalInvalid");
    if (draft.variableSymbol && !/^\d{1,10}$/.test(draft.variableSymbol)) found.push("variableSymbolInvalid");
    if (draft.dueOn < draft.issuedOn) found.push("dueBeforeIssue");
    return found;
  }

  async function saveDraft() {
    if (Object.keys(parsed.errors).length) {
      setProblems(["itemsInvalid"]);
      return;
    }
    setProblems([]);
    try {
      const result = await save.mutateAsync(toDraftInput(draft, parsed.items, vatMode));
      setSavedAt(result.contactSaved === false ? "contactNotSaved" : "saved");
      if (!draft.id) {
        setDraft((current) => ({ ...current, id: result.invoice.id }));
        router.replace(invoicePath(result.invoice.id));
      }
    } catch {
      // Shown under the header.
    }
  }

  async function issueNow() {
    try {
      const result = await issue.mutateAsync(toDraftInput(draft, parsed.items, vatMode));
      setConfirmIssue(false);
      router.replace(invoicePath(result.invoice.id));
    } catch {
      setConfirmIssue(false);
    }
  }

  const form = (
    <div className="flex flex-col gap-5">
      <Card title={t("customer.title")}>
        <CustomerFields
          draft={draft}
          onPick={(contactId, customer) => update({ contactId, customer, saveToContact: false })}
          onClear={() => update({ contactId: null, saveToContact: false })}
          onChange={updateCustomer}
          onSaveToContact={(checked) => update({ saveToContact: checked })}
        />
      </Card>

      <Card title={t("items.title")}>
        <SortableList
          items={draft.items}
          nameOf={(item) => item.name || t("items.unnamed")}
          onReorder={(activeId, overId) => update({ items: moveItem(draft.items, activeId, overId) })}
          renderItem={(item, handle) => (
            <ItemRow
              item={item}
              handle={handle}
              vat={vatMode === "vat"}
              czechRates={czechRates}
              errors={parsed.errors[item.id] ?? {}}
              total={money(lineTotal(parsed.items.find((line) => line.id === item.id) ?? { quantity: 0, unit_price: 0 }))}
              canRemove={draft.items.length > 1}
              onChange={(patch) => updateItem(item.id, patch)}
              onRemove={() => update({ items: draft.items.filter((line) => line.id !== item.id) })}
            />
          )}
        />
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() =>
            update({ items: [...draft.items, newItem(t("defaultUnit"), defaultVatRate(profile), decimalComma)] })
          }
        >
          <PlusIcon aria-hidden data-icon="inline-start" />
          {t("items.add")}
        </Button>
        <dl className="ml-auto flex w-full max-w-xs flex-col gap-1.5 border-t border-line pt-3 text-sm">
          <TotalRow label={vatMode === "vat" ? t("totals.subtotal") : t("totals.items")} value={money(totals.subtotal)} />
          {vatMode === "vat" && <TotalRow label={t("totals.vat")} value={money(totals.vatTotal)} />}
          {totals.rounding !== 0 && <TotalRow label={t("totals.rounding")} value={money(totals.rounding)} />}
          <TotalRow label={t("totals.total")} value={money(totals.total)} strong />
        </dl>
      </Card>

      <Card title={t("details.title")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="invoice-issued" label={t("details.issuedOn")}>
            <DatePicker
              id="invoice-issued"
              value={draft.issuedOn}
              onValueChange={(value) => {
                if (!value) return;
                update({
                  issuedOn: value,
                  ...(draft.dueTouched ? {} : { dueOn: shiftDays(value, profile.due_days) }),
                });
              }}
            />
          </FormField>
          {vatMode === "vat" && (
            <FormField id="invoice-taxable" label={t("details.taxableOn")} hint={t("details.taxableHint")}>
              <DatePicker
                id="invoice-taxable"
                value={draft.taxableOn ?? draft.issuedOn}
                onValueChange={(value) => update({ taxableOn: value })}
              />
            </FormField>
          )}
          <FormField id="invoice-due" label={t("details.dueOn")} hint={t("details.dueHint", { days: profile.due_days })}>
            <DatePicker
              id="invoice-due"
              value={draft.dueOn}
              onValueChange={(value) => value && update({ dueOn: value, dueTouched: true })}
            />
          </FormField>
          <FormField id="invoice-vs" label={t("details.variableSymbol")} hint={t("details.variableSymbolHint")}>
            <Input
              id="invoice-vs"
              value={draft.variableSymbol}
              inputMode="numeric"
              maxLength={10}
              placeholder={t("details.variableSymbolPlaceholder")}
              onChange={(event) => update({ variableSymbol: event.target.value.replace(/\D/g, "") })}
            />
          </FormField>
          <FormField id="invoice-currency" label={t("details.currency")}>
            <SimpleSelect
              id="invoice-currency"
              value={draft.currency}
              options={[...new Set([...CURRENCIES, draft.currency])].map((code) => ({ value: code, label: code }))}
              onChange={(value) => update({ currency: value })}
            />
          </FormField>
        </div>
        <FormField id="invoice-note" label={t("details.note")} hint={t("details.noteHint")}>
          <Textarea
            id="invoice-note"
            value={draft.note}
            rows={3}
            maxLength={1000}
            onChange={(event) => update({ note: event.target.value })}
          />
        </FormField>
      </Card>
    </div>
  );

  const preview = doc ? (
    <div className="flex flex-col gap-2">
      <span className="micro-label">{t("preview")}</span>
      <InvoicePaper doc={doc} label={t("previewLabel")} />
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <Link href={INVOICES_PATH} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 self-start")}>
        <ArrowLeftIcon aria-hidden data-icon="inline-start" />
        {t("back")}
      </Link>
      <PageHeader
        title={draft.id ? t("titleDraft") : t("titleNew")}
        description={t("description")}
        actions={
          <>
            {draft.id && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("delete")}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon aria-hidden />
              </Button>
            )}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveDraft()}>
              {t("saveDraft")}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                const found = check();
                setProblems(found);
                if (!found.length) setConfirmIssue(true);
              }}
            >
              {t("issue")}
            </Button>
          </>
        }
      />

      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {savedAt === "saved" && <p className="text-sm text-green">{t("saved")}</p>}
        {savedAt === "contactNotSaved" && <p className="text-sm text-gold">{t("contactNotSaved")}</p>}
        {problems.length > 0 && (
          <FormAlert>
            <ul className="flex flex-col gap-1">
              {problems.map((problem) => (
                <li key={problem}>{t(`problems.${problem}`)}</li>
              ))}
            </ul>
          </FormAlert>
        )}
        {failure && !busy && <FormAlert>{tFailure(errorCodeOf(failure))}</FormAlert>}
      </div>

      <div className="lg:hidden">
        <Segmented
          label={t("panes")}
          value={pane}
          options={[
            { value: "form", label: t("paneForm") },
            { value: "preview", label: t("panePreview") },
          ]}
          onChange={setPane}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className={cn(pane === "preview" && "max-lg:hidden")}>{form}</div>
        <div className={cn("lg:sticky lg:top-6", pane === "form" && "max-lg:hidden")}>{preview}</div>
      </div>

      <ConfirmDialog
        open={confirmIssue}
        onOpenChange={setConfirmIssue}
        title={t("issueTitle")}
        description={t("issueDescription", { total: money(totals.total) })}
        confirmLabel={t("issueConfirm")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={issue.isPending}
        onConfirm={() => void issueNow()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("deleteConfirm")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("deleteFailed") : null}
        onConfirm={() => {
          if (!draft.id) return;
          remove.mutate(draft.id, { onSuccess: () => router.replace(INVOICES_PATH) });
        }}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", strong && "border-t border-line pt-2")}>
      <dt className={strong ? "font-semibold text-ink" : "text-ink-soft"}>{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-lg font-semibold text-ink" : "text-ink")}>{value}</dd>
    </div>
  );
}

const CONTACT_COLUMNS =
  "company_name, first_name, last_name, address, city, postal_code, country_code, email, company_reg_no, vat_no";

function CustomerFields({
  draft,
  onPick,
  onClear,
  onChange,
  onSaveToContact,
}: {
  draft: EditorDraft;
  onPick: (contactId: string, customer: EditorDraft["customer"]) => void;
  onClear: () => void;
  onChange: (field: PartyField, value: string) => void;
  onSaveToContact: (checked: boolean) => void;
}) {
  const t = useTranslations("invoices.editor.customer");
  const uiLocale = useLocale();
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), 250);
  const search = useContactSearch(debounced);
  const [pickFailed, setPickFailed] = useState(false);
  const countries = useMemo(
    () => [
      { value: "", label: t("countryNone") },
      ...COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, uiLocale) })).sort((a, b) =>
        a.label.localeCompare(b.label, uiLocale),
      ),
    ],
    [t, uiLocale],
  );

  async function pick(id: string) {
    setPickFailed(false);
    const { data, error } = await createClient()
      .from("contacts")
      .select(CONTACT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      setPickFailed(true);
      return;
    }
    onPick(id, partyFromContact(data));
    setTerm("");
  }

  const field = (key: PartyField, label: string, props: Record<string, string> = {}) => (
    <FormField id={`invoice-customer-${key}`} label={label}>
      <Input
        id={`invoice-customer-${key}`}
        value={draft.customer[key]}
        onChange={(event) => onChange(key, event.target.value)}
        {...props}
      />
    </FormField>
  );
  const results = term.trim() && debounced === term.trim() ? (search.data ?? []) : [];

  return (
    <div className="flex flex-col gap-4">
      {draft.contactId ? (
        <div className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface-hover px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            {t("linked", { name: draft.customer.name || "—" })}
          </span>
          <button
            type="button"
            aria-label={t("unlink")}
            onClick={onClear}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={term}
              aria-label={t("search")}
              placeholder={t("searchPlaceholder")}
              autoComplete="off"
              className="pl-9"
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          {results.length > 0 && (
            <ul aria-label={t("results")} className="flex flex-col overflow-hidden rounded-xl border border-line">
              {results.map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    onClick={() => void pick(contact.id)}
                    className="flex min-h-11 w-full cursor-pointer items-center px-3 text-left text-sm text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover mouse:min-h-9"
                  >
                    <span className="truncate">{contactLabel(contact)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pickFailed && <p className="text-xs text-pink">{t("pickFailed")}</p>}
          <p className="text-xs text-ink-muted">{t("manual")}</p>
        </div>
      )}

      {field("name", t("name"), { autoComplete: "organization" })}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("company_reg_no", t("companyRegNo"), { inputMode: "numeric" })}
        {field("vat_no", t("vatNo"))}
      </div>
      {field("street", t("street"))}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        {field("city", t("city"))}
        {field("postal_code", t("postalCode"))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="invoice-customer-country" label={t("country")}>
          <SimpleSelect
            id="invoice-customer-country"
            value={draft.customer.country}
            options={countries}
            onChange={(value) => onChange("country", value)}
          />
        </FormField>
        {field("email", t("email"), { type: "email", autoComplete: "email" })}
      </div>
      {draft.contactId && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
          <Checkbox checked={draft.saveToContact} onCheckedChange={(checked) => onSaveToContact(checked === true)} />
          {t("saveToContact")}
        </label>
      )}
    </div>
  );
}

function ItemRow({
  item,
  handle,
  vat,
  czechRates,
  errors,
  total,
  canRemove,
  onChange,
  onRemove,
}: {
  item: ItemDraft;
  handle: ReactNode;
  vat: boolean;
  czechRates: boolean;
  errors: Partial<Record<"name" | "quantity" | "unit_price" | "vat_rate", string>>;
  total: string;
  canRemove: boolean;
  onChange: (patch: Partial<ItemDraft>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("invoices.editor.items");
  const tErrors = useTranslations("invoices.fieldErrors");
  const id = (field: string) => `invoice-item-${item.id}-${field}`;
  const errorOf = (key: keyof typeof errors) => (errors[key] ? tErrors(errors[key] as never) : undefined);
  const rateOptions = CZ_VAT_RATES.map((rate) => ({ value: String(rate), label: `${rate} %` }));

  return (
    <div className="flex gap-2 rounded-2xl border border-line bg-canvas/40 p-3">
      <div className="pt-7">{handle}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <FormField id={id("name")} label={t("name")}>
          <Input id={id("name")} value={item.name} maxLength={200} onChange={(event) => onChange({ name: event.target.value })} />
        </FormField>
        <div className={cn("grid gap-3", vat ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
          <FormField id={id("quantity")} label={t("quantity")} error={errorOf("quantity")}>
            <Input id={id("quantity")} value={item.quantity} inputMode="decimal" onChange={(event) => onChange({ quantity: event.target.value })} />
          </FormField>
          <FormField id={id("unit")} label={t("unit")}>
            <Input id={id("unit")} value={item.unit} maxLength={20} onChange={(event) => onChange({ unit: event.target.value })} />
          </FormField>
          <FormField id={id("price")} label={vat ? t("unitPriceNet") : t("unitPrice")} error={errorOf("unit_price")}>
            <Input id={id("price")} value={item.unit_price} inputMode="decimal" onChange={(event) => onChange({ unit_price: event.target.value })} />
          </FormField>
          {vat && (
            <FormField id={id("vat")} label={t("vatRate")} error={errorOf("vat_rate")}>
              {czechRates ? (
                <SimpleSelect
                  id={id("vat")}
                  value={item.vat_rate.replace(",", ".")}
                  options={rateOptions}
                  onChange={(value) => onChange({ vat_rate: value })}
                />
              ) : (
                <Input id={id("vat")} value={item.vat_rate} inputMode="decimal" onChange={(event) => onChange({ vat_rate: event.target.value })} />
              )}
            </FormField>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-soft">
            {t("lineTotal")} <span className="font-semibold text-ink tabular-nums">{total}</span>
          </span>
          {canRemove && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={t("removeLabel", { name: item.name || t("unnamed") })}>
              <Trash2Icon aria-hidden data-icon="inline-start" />
              {t("remove")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
