import { z } from "zod";
import {
  deleteRecurring,
  deleteTransaction,
  saveRecurring,
  saveTransaction,
} from "@/features/finance/ops";
import { savePlanCell } from "@/features/finance/plan/ops";
import { monthWeeks } from "@/features/finance/plan/weeks";
import { DESCRIPTION_MAX, recurringSchema, transactionSchema } from "@/features/finance/schemas";
import { ALL_CATEGORIES, FREQUENCIES } from "@/features/finance/types";
import {
  cancelInvoiceAction,
  createInvoiceFromDealAction,
  issueInvoiceAction,
  markInvoicePaidAction,
  saveInvoiceDraftAction,
} from "@/features/invoices/actions";
import type { ActionResult } from "@/features/invoices/errors";
import type { InvoiceDraftInput } from "@/features/invoices/schemas";
import { invoiceContext } from "@/features/invoices/server/context";
import { sendInvoiceEmail } from "@/features/invoices/server/send";
import {
  INVOICE_RECORD_COLUMNS,
  toInvoiceRecord,
  type InvoiceRecord,
} from "@/features/invoices/types";
import { formatPrice } from "@/lib/format";
import type { Json } from "@/types/database";
import { readRow, type UndoRecord } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import {
  hrefs,
  inserted,
  isoDate,
  mustFind,
  ops,
  previousOf,
  quoted,
  today,
  updated,
  uuid,
} from "./shared";

/** Transactions, recurring payments, the month plan and invoices. Grady never moves money. */

const money = z.number().positive().max(1e12);
const currency = z.string().regex(/^[A-Za-z]{3}$/);

function amountText(ctx: ToolContext, amount: number, code: string) {
  return formatPrice(amount, code, ctx.settings);
}

async function readTransaction(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("transactions")
      .select("id, type, amount, currency, category, description, occurred_on, source")
      .eq("user_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

async function readRecurring(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("recurring_payments")
      .select(
        "id, type, amount, currency, category, description, frequency, next_due_on, ends_on, due_day",
      )
      .eq("user_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

async function readInvoice(ctx: ToolContext, id: string): Promise<InvoiceRecord> {
  const row = await mustFind(
    ctx.db
      .from("invoices")
      .select(INVOICE_RECORD_COLUMNS)
      .eq("user_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
  return toInvoiceRecord(row);
}

/** An invoice action's failure as the tool's error (codes of invoices.errors). */
function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new ToolError(result.error);
  return result.data;
}

/** The draft as the invoice form would send it, with the changes of the tool. */
function draftInput(
  invoice: InvoiceRecord,
  change: Partial<Pick<InvoiceDraftInput, "items" | "dueOn" | "note" | "currency">> = {},
): InvoiceDraftInput {
  const customer = invoice.customer ?? {};
  return {
    id: invoice.id,
    contactId: invoice.contact_id,
    dealId: invoice.deal_id,
    saveToContact: false,
    customer: {
      name: customer.name ?? "",
      company_reg_no: customer.company_reg_no ?? "",
      vat_no: customer.vat_no ?? "",
      street: customer.street ?? "",
      city: customer.city ?? "",
      postal_code: customer.postal_code ?? "",
      country: customer.country ?? "",
      email: customer.email ?? "",
    },
    items: change.items ?? invoice.items,
    currency: change.currency ?? invoice.currency,
    issuedOn: invoice.issued_on,
    taxableOn: invoice.taxable_on,
    dueOn: change.dueOn === undefined ? invoice.due_on : change.dueOn,
    variableSymbol: invoice.variable_symbol ?? "",
    note: change.note ?? invoice.note ?? "",
    locale: invoice.locale,
  };
}

const itemInput = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().min(-1_000_000).max(1_000_000).optional(),
  unit: z.string().trim().max(20).optional(),
  unitPrice: z.number().min(-1e9).max(1e9),
  vatRate: z.number().min(0).max(100).optional(),
});
type ItemInput = z.infer<typeof itemInput>;

function toItems(items: ItemInput[]) {
  return items.map((item) => ({
    id: crypto.randomUUID(),
    name: item.name,
    quantity: Math.round((item.quantity ?? 1) * 1000) / 1000,
    unit: item.unit ?? "",
    unit_price: Math.round(item.unitPrice * 100) / 100,
    vat_rate: item.vatRate ?? 0,
  }));
}

function invoiceName(invoice: InvoiceRecord) {
  return invoice.number ?? invoice.customer?.name ?? "";
}

export const financeTools = [
  defineTool({
    name: "save_transaction",
    section: "finance",
    action: "write",
    kind: "write",
    risk: "instant",
    description:
      "Record an income or expense (or change one by transactionId): amount, currency (default the user's), date YYYY-MM-DD (default today), optional category key and description.",
    input: z.object({
      transactionId: uuid.optional(),
      type: z.enum(["income", "expense"]),
      amount: money,
      currency: currency.optional(),
      date: isoDate.optional(),
      category: z.enum(ALL_CATEGORIES as [string, ...string[]]).optional(),
      description: z.string().trim().max(DESCRIPTION_MAX).optional(),
    }),
    describe: (input, t) =>
      t(input.transactionId ? "update_transaction" : "create_transaction", {
        amount: String(input.amount),
      }),
    async execute(ctx, input) {
      const previous = input.transactionId ? await readTransaction(ctx, input.transactionId) : null;
      const parsed = transactionSchema.safeParse({
        type: input.type,
        amount: input.amount,
        currency: (input.currency ?? previous?.currency ?? ctx.settings.currency).toUpperCase(),
        category: input.category ?? previous?.category ?? null,
        description: input.description ?? previous?.description ?? "",
        occurred_on: input.date ?? previous?.occurred_on ?? today(ctx).day,
      });
      if (!parsed.success) throw new ToolError("invalid");
      const saved = await saveTransaction(ops(ctx), {
        workspaceId: ctx.workspaceId,
        id: previous?.id,
        input: parsed.data,
      });
      const label = amountText(ctx, parsed.data.amount, parsed.data.currency);
      return {
        output: { transactionId: saved.id },
        records: previous
          ? [
              updated(
                "transactions",
                saved.id,
                previousOf(previous, {
                  ...parsed.data,
                  description: parsed.data.description || null,
                }),
              ),
            ]
          : [inserted("transactions", saved.id)],
        summary: ctx.t(
          previous
            ? "update_transaction"
            : parsed.data.type === "income"
              ? "create_income"
              : "create_expense",
          { amount: label },
        ),
        href: hrefs.transactions,
        awards: previous ? [] : [{ reason: "transaction_added" }],
      };
    },
    undoable: true,
    invalidates: ["finance", "dashboard"],
  }),

  defineTool({
    name: "delete_transaction",
    section: "finance",
    action: "write",
    kind: "write",
    risk: "confirm",
    description: "Delete a transaction for good. The user confirms it first.",
    input: z.object({ transactionId: uuid }),
    describe: (_input, t) => t("delete_transaction", { amount: "" }),
    async prepare(ctx, input) {
      const row = await readTransaction(ctx, input.transactionId);
      return {
        summary: ctx.t("delete_transaction", { amount: amountText(ctx, row.amount, row.currency) }),
        href: hrefs.transactions,
      };
    },
    async execute(ctx, input) {
      const row = await readTransaction(ctx, input.transactionId);
      await deleteTransaction(ops(ctx), row.id);
      return {
        output: { deleted: true },
        summary: ctx.t("deleted_transaction", {
          amount: amountText(ctx, row.amount, row.currency),
        }),
      };
    },
    undoable: false,
    invalidates: ["finance", "dashboard"],
  }),

  defineTool({
    name: "save_recurring_payment",
    section: "finance",
    action: "write",
    kind: "write",
    risk: "instant",
    description:
      "Create (or change by recurringId) a recurring payment: income or expense, amount, currency, description, frequency (weekly, monthly, quarterly, yearly), next due date and an optional end date.",
    input: z.object({
      recurringId: uuid.optional(),
      type: z.enum(["income", "expense"]),
      amount: money,
      currency: currency.optional(),
      description: z.string().trim().min(1).max(DESCRIPTION_MAX),
      frequency: z.enum(FREQUENCIES as [string, ...string[]]),
      nextDueOn: isoDate,
      endsOn: isoDate.nullable().optional(),
      category: z.enum(ALL_CATEGORIES as [string, ...string[]]).optional(),
    }),
    describe: (input, t) => t("save_recurring_payment", { title: quoted(input.description) }),
    async execute(ctx, input) {
      const previous = input.recurringId ? await readRecurring(ctx, input.recurringId) : null;
      const parsed = recurringSchema.safeParse({
        type: input.type,
        amount: input.amount,
        currency: (input.currency ?? previous?.currency ?? ctx.settings.currency).toUpperCase(),
        category: input.category ?? previous?.category ?? null,
        description: input.description,
        frequency: input.frequency,
        next_due_on: input.nextDueOn,
        ends_on: input.endsOn ?? null,
      });
      if (!parsed.success) throw new ToolError("invalid");
      const saved = await saveRecurring(ops(ctx), {
        workspaceId: ctx.workspaceId,
        id: previous?.id,
        input: parsed.data,
      });
      return {
        output: { recurringId: saved.id },
        records: previous
          ? [
              updated(
                "recurring_payments",
                saved.id,
                previousOf(previous, { ...parsed.data, due_day: null }),
              ),
            ]
          : [inserted("recurring_payments", saved.id)],
        summary: ctx.t("save_recurring_payment", { title: quoted(parsed.data.description) }),
        href: hrefs.recurring,
      };
    },
    undoable: true,
    invalidates: ["finance"],
  }),

  defineTool({
    name: "delete_recurring_payment",
    section: "finance",
    action: "write",
    kind: "write",
    risk: "confirm",
    description:
      "Delete a recurring payment (the transactions it already made stay). The user confirms it first.",
    input: z.object({ recurringId: uuid }),
    describe: (_input, t) => t("delete_recurring_payment", { title: "" }),
    async prepare(ctx, input) {
      const row = await readRecurring(ctx, input.recurringId);
      return {
        summary: ctx.t("delete_recurring_payment", { title: quoted(row.description) }),
        href: hrefs.recurring,
      };
    },
    async execute(ctx, input) {
      const row = await readRecurring(ctx, input.recurringId);
      await deleteRecurring(ops(ctx), row.id);
      return {
        output: { deleted: true },
        summary: ctx.t("deleted_recurring_payment", { title: quoted(row.description) }),
      };
    },
    undoable: false,
    invalidates: ["finance"],
  }),

  defineTool({
    name: "set_plan_cell",
    section: "finance",
    action: "write",
    kind: "write",
    risk: "instant",
    description:
      "Set one planned number of the month plan (Finance → Month): the row by its name in the income or expense block, the week of the month (1–5) and the amount in the plan's currency (null clears it). The month must exist and be open.",
    input: z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      block: z.enum(["income", "expense"]),
      row: z.string().trim().min(1).max(120),
      week: z.number().int().min(1).max(5),
      amount: z.number().min(0).max(1e12).nullable(),
    }),
    describe: (input, t) => t("set_plan_cell", { row: quoted(input.row), week: input.week }),
    async execute(ctx, input) {
      const plan = await mustFind(
        ctx.db
          .from("finance_plan_months")
          .select("id, month, closed, currency")
          .eq("user_id", ctx.workspaceId)
          .eq("month", input.month)
          .maybeSingle(),
      );
      if (plan.closed) throw new ToolError("monthClosed");
      if (input.week > monthWeeks(input.month as never).length)
        throw new ToolError("invalid", "No such week in that month.");
      const rows = await ctx.db
        .from("finance_plan_rows")
        .select("id, label")
        .eq("user_id", ctx.workspaceId)
        .eq("month", plan.month)
        .eq("kind", input.block)
        .limit(300);
      if (rows.error) throw rows.error;
      const row = rows.data.find(
        (item) => item.label.toLocaleLowerCase() === input.row.toLocaleLowerCase(),
      );
      if (!row) throw new ToolError("notFound", `No row "${input.row}" in that block.`);
      const match = { row_id: row.id, week: input.week };
      const before = await readRow(ctx.db, "finance_plan_cells", match, [
        "row_id",
        "week",
        "planned",
      ]);
      await savePlanCell(ops(ctx), {
        space: ctx.workspaceId,
        rowId: row.id,
        week: input.week,
        value: input.amount,
      });
      const record: UndoRecord = {
        table: "finance_plan_cells",
        match,
        op: "update",
        before: { planned: (before?.planned as Json) ?? null },
      };
      return {
        output: { month: plan.month, row: row.label, week: input.week, amount: input.amount },
        records: [record],
        summary: ctx.t("set_plan_cell", { row: quoted(row.label), week: input.week }),
        href: hrefs.month(plan.month),
      };
    },
    undoable: true,
    // A cell has no row when empty: back through the same write as the sheet's.
    async undo(ctx, records) {
      const record = records[0];
      if (!record) return { ok: true };
      const now = await readRow(ctx.db, "finance_plan_cells", record.match, [
        "planned",
        "updated_at",
      ]);
      const left = (record.after?.planned as number | null | undefined) ?? null;
      if (((now?.planned as number | null | undefined) ?? null) !== left)
        return { ok: false, reason: "changed" };
      await savePlanCell(ops(ctx), {
        space: ctx.workspaceId,
        rowId: String(record.match.row_id),
        week: Number(record.match.week),
        value: (record.before?.planned as number | null | undefined) ?? null,
      });
      return { ok: true };
    },
    invalidates: ["finance"],
  }),
];

export const invoiceTools = [
  defineTool({
    name: "save_invoice_draft",
    section: "invoices",
    action: "issue",
    kind: "write",
    risk: "instant",
    description:
      "Create or change an invoice draft (never issues it). New: from a deal (dealId: customer from its contact, an item from its value) or for a contact with items. Change: invoiceId with new items, due date or note. Prices without VAT.",
    input: z.object({
      invoiceId: uuid.optional(),
      dealId: uuid.optional(),
      contactId: uuid.optional(),
      items: z.array(itemInput).min(1).max(50).optional(),
      dueOn: isoDate.nullable().optional(),
      note: z.string().trim().max(1000).optional(),
      currency: currency.optional(),
    }),
    describe: (_input, t) => t("save_invoice_draft", { name: "" }),
    async execute(ctx, input) {
      let invoiceId = input.invoiceId ?? null;
      let previous: InvoiceRecord | null = null;
      if (invoiceId) {
        previous = await readInvoice(ctx, invoiceId);
        if (previous.status !== "draft") throw new ToolError("alreadyIssued");
        unwrap(
          await saveInvoiceDraftAction(
            draftInput(previous, {
              items: input.items ? toItems(input.items) : undefined,
              dueOn: input.dueOn,
              note: input.note,
              currency: input.currency?.toUpperCase(),
            }),
          ),
        );
      } else if (input.dealId && !input.items) {
        invoiceId = unwrap(await createInvoiceFromDealAction(input.dealId));
      } else {
        if (!input.items)
          throw new ToolError("invalid", "Items are needed for an invoice without a deal.");
        const contact = input.contactId
          ? await mustFind(
              ctx.db
                .from("contacts")
                .select(
                  "id, company_name, first_name, last_name, company_reg_no, vat_no, address, city, postal_code, country_code, email",
                )
                .eq("user_id", ctx.workspaceId)
                .eq("id", input.contactId)
                .maybeSingle(),
            )
          : null;
        const saved = unwrap(
          await saveInvoiceDraftAction({
            id: null,
            contactId: contact?.id ?? null,
            dealId: input.dealId ?? null,
            saveToContact: false,
            customer: {
              name: contact
                ? contact.company_name ||
                  [contact.first_name, contact.last_name].filter(Boolean).join(" ")
                : "",
              company_reg_no: contact?.company_reg_no ?? "",
              vat_no: contact?.vat_no ?? "",
              street: contact?.address ?? "",
              city: contact?.city ?? "",
              postal_code: contact?.postal_code ?? "",
              country: contact?.country_code ?? "",
              email: contact?.email ?? "",
            },
            items: toItems(input.items),
            currency: (input.currency ?? ctx.settings.currency).toUpperCase(),
            issuedOn: null,
            taxableOn: null,
            dueOn: input.dueOn ?? null,
            variableSymbol: "",
            note: input.note ?? "",
            locale: ctx.locale === "cs" ? "cs" : "en",
          }),
        );
        invoiceId = saved.invoice.id;
      }
      const invoice = await readInvoice(ctx, invoiceId);
      return {
        output: {
          invoiceId: invoice.id,
          total: invoice.total,
          currency: invoice.currency,
          status: invoice.status,
        },
        records: previous
          ? [
              updated("invoices", invoice.id, {
                items: previous.items as unknown as Json,
                due_on: previous.due_on,
                note: previous.note,
                currency: previous.currency,
              }),
            ]
          : [inserted("invoices", invoice.id)],
        summary: ctx.t(previous ? "update_invoice_draft" : "save_invoice_draft", {
          name: quoted(invoice.customer?.name ?? ""),
        }),
        href: hrefs.invoice(invoice.id),
      };
    },
    undoable: true,
    invalidates: ["finance", "pipeline"],
  }),

  defineTool({
    name: "issue_invoice",
    section: "invoices",
    action: "issue",
    kind: "write",
    risk: "confirm",
    description:
      "Issue an invoice draft: it gets the next number of the series and is frozen (only a credit note corrects it then). The user confirms it first.",
    input: z.object({ invoiceId: uuid }),
    describe: (_input, t) => t("issue_invoice", { name: "", total: "" }),
    async prepare(ctx, input) {
      const invoice = await readInvoice(ctx, input.invoiceId);
      if (invoice.status !== "draft") throw new ToolError("alreadyIssued");
      return {
        summary: ctx.t("issue_invoice", {
          name: quoted(invoice.customer?.name ?? ""),
          total: amountText(ctx, invoice.total, invoice.currency),
        }),
        href: hrefs.invoice(invoice.id),
      };
    },
    async execute(ctx, input) {
      const invoice = await readInvoice(ctx, input.invoiceId);
      const issued = unwrap(await issueInvoiceAction(draftInput(invoice))).invoice;
      return {
        output: { invoiceId: issued.id, number: issued.number },
        summary: ctx.t("issued_invoice", { number: issued.number ?? "" }),
        href: hrefs.invoice(issued.id),
      };
    },
    undoable: false,
    invalidates: ["finance"],
  }),

  defineTool({
    name: "send_invoice",
    section: "invoices",
    action: "issue",
    kind: "write",
    risk: "confirm",
    description:
      "E-mail an issued invoice as PDF to the customer (to: default the customer's e-mail) with a subject and the whole message body you write. The user sees the full text and confirms it first.",
    input: z.object({
      invoiceId: uuid,
      to: z.email().max(254).optional(),
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(5000),
      ccSelf: z.boolean().optional(),
    }),
    describe: (input, t) => t("send_invoice", { number: "", to: input.to ?? "" }),
    async prepare(ctx, input) {
      const invoice = await readInvoice(ctx, input.invoiceId);
      if (invoice.status === "draft") throw new ToolError("notIssued");
      const to = input.to ?? invoice.customer?.email;
      if (!to)
        throw new ToolError("noRecipient", "The customer has no e-mail; ask the user for it.");
      return {
        summary: ctx.t("send_invoice", { number: invoice.number ?? "", to }),
        preview: `${input.subject}\n\n${input.body}`,
        href: hrefs.invoice(invoice.id),
      };
    },
    async execute(ctx, input) {
      const invoice = await readInvoice(ctx, input.invoiceId);
      const to = input.to ?? invoice.customer?.email;
      if (!to) throw new ToolError("noRecipient");
      const invoices = await invoiceContext();
      if (!invoices) throw new ToolError("forbidden");
      try {
        await sendInvoiceEmail(invoices, {
          invoiceId: invoice.id,
          to,
          subject: input.subject,
          body: input.body,
          ccSelf: input.ccSelf ?? false,
        });
      } catch (error) {
        throw new ToolError((error as { code?: string }).code ?? "sendFailed");
      }
      return {
        output: { sent: true },
        summary: ctx.t("sent_invoice", { number: invoice.number ?? "", to }),
        href: hrefs.invoice(invoice.id),
      };
    },
    undoable: false,
    invalidates: ["finance"],
  }),

  defineTool({
    name: "mark_invoice_paid",
    section: "invoices",
    action: "issue",
    kind: "write",
    risk: "confirm",
    description:
      "Mark an issued invoice paid today; its income is booked in Finance. The user confirms it first.",
    input: z.object({ invoiceId: uuid }),
    describe: (_input, t) => t("mark_invoice_paid", { number: "" }),
    async prepare(ctx, input) {
      const invoice = await readInvoice(ctx, input.invoiceId);
      return {
        summary: ctx.t("mark_invoice_paid", { number: invoiceName(invoice) }),
        href: hrefs.invoice(invoice.id),
      };
    },
    async execute(ctx, input) {
      const invoice = await readInvoice(ctx, input.invoiceId);
      unwrap(await markInvoicePaidAction(invoice.id));
      return {
        output: { paid: true },
        summary: ctx.t("marked_invoice_paid", { number: invoiceName(invoice) }),
        href: hrefs.invoice(invoice.id),
      };
    },
    undoable: false,
    invalidates: ["finance", "dashboard"],
  }),

  defineTool({
    name: "cancel_invoice",
    section: "invoices",
    action: "issue",
    kind: "write",
    risk: "confirm",
    description:
      "Cancel an issued unpaid invoice with a credit note (the next number of the series). The user confirms it first.",
    input: z.object({ invoiceId: uuid }),
    describe: (_input, t) => t("cancel_invoice", { number: "" }),
    async prepare(ctx, input) {
      const invoice = await readInvoice(ctx, input.invoiceId);
      return {
        summary: ctx.t("cancel_invoice", { number: invoiceName(invoice) }),
        href: hrefs.invoice(invoice.id),
      };
    },
    async execute(ctx, input) {
      const invoice = await readInvoice(ctx, input.invoiceId);
      const creditNote = unwrap(await cancelInvoiceAction(invoice.id));
      return {
        output: { cancelled: true, creditNoteId: creditNote },
        summary: ctx.t("cancelled_invoice", { number: invoiceName(invoice) }),
        href: hrefs.invoice(creditNote),
      };
    },
    undoable: false,
    invalidates: ["finance"],
  }),
];
