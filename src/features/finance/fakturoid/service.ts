import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/constants";
import { todayIsoDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { toFormatSettings, USER_SETTINGS_COLUMNS } from "@/lib/user-settings";
import type { Database } from "@/types/database";
import { INVOICE_COLUMNS, type Invoice } from "../types";
import { createLocalInvoiceProvider } from "./adapter";
import { createFakturoidClient, type FakturoidClient } from "./client";
import { decryptSecret, encryptSecret, encryptionKey } from "./crypto";
import { FakturoidError, InvoiceError } from "./errors";
import { syncSince } from "./mapping";
import type { FakturoidConnectInput, FakturoidStatus } from "./schema";
import { fakturoidConnectSchema } from "./schema";
import {
  issueFakturoidInvoice,
  payFakturoidInvoice,
  syncFakturoidInvoices,
  type ApplyResult,
  type InvoiceStore,
  type SyncOutcome,
} from "./workflow";

/**
 * Fakturoid on the server. Every function takes the user id from the session
 * (or, for the cron, from the connection row) and filters the admin client by it.
 */

type Db = SupabaseClient<Database>;
type ConnectionRow = Database["public"]["Tables"]["fakturoid_connections"]["Row"];

const CONNECTION_COLUMNS =
  "user_id, account_slug, encrypted_credentials, connected_at, last_synced_at, last_sync_error, move_deal_on_paid";
/** Invoices a single sync looks at, oldest first. */
const SYNC_INVOICE_LIMIT = 500;
const CRON_CONNECTION_LIMIT = 1000;
const UNPAID: Database["public"]["Enums"]["invoice_status"][] = [
  "draft",
  "open",
  "sent",
  "overdue",
];

type Connection = Pick<
  ConnectionRow,
  | "user_id"
  | "account_slug"
  | "encrypted_credentials"
  | "connected_at"
  | "last_synced_at"
  | "last_sync_error"
  | "move_deal_on_paid"
>;

/** Fakturoid asks every integration to name itself and a contact. */
function userAgent(): string {
  const contact = process.env.OWNER_EMAIL?.trim();
  return contact ? `${APP_NAME} (${contact})` : APP_NAME;
}

async function loadConnection(admin: Db, userId: string): Promise<Connection | null> {
  const { data, error } = await admin
    .from("fakturoid_connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function clientFor(connection: Connection): FakturoidClient {
  let secret: { clientId: string; clientSecret: string };
  try {
    secret = JSON.parse(decryptSecret(connection.encrypted_credentials, connection.user_id));
  } catch (error) {
    if (error instanceof InvoiceError) throw error;
    // The key changed or the row was tampered with: the user has to connect again.
    throw new InvoiceError("invalidCredentials");
  }
  return createFakturoidClient(
    { ...secret, slug: connection.account_slug },
    { userAgent: userAgent() },
  );
}

async function userToday(admin: Db, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("user_settings")
    .select(USER_SETTINGS_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return todayIsoDate(toFormatSettings(data));
}

/**
 * The function takes SQL nulls ("keep what is there"), which the generated
 * types do not express; an omitted argument would not match its signature.
 */
function sqlNull<T>(value: T | null): T {
  return value as T;
}

/**
 * Storage for the workflow. `reader` is the user's own client where there is a
 * session (RLS applies); writes to server-owned columns go through the admin
 * client, always with this user's id.
 */
function storeFor(reader: Db, admin: Db, userId: string, moveDeal: boolean): InvoiceStore {
  return {
    async loadDeal(dealId) {
      const { data: deal, error } = await reader
        .from("deals")
        .select("id, title, value, currency, contact_id")
        .eq("id", dealId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      if (!deal) return null;
      if (!deal.contact_id) return { deal, contact: null };
      const contact = await reader
        .from("contacts")
        .select(
          "id, company_name, first_name, last_name, email, phone, address, city, postal_code, country_code, website",
        )
        .eq("id", deal.contact_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (contact.error) throw contact.error;
      return { deal, contact: contact.data };
    },
    async findUnpaidForDeal(dealId) {
      const { data, error } = await reader
        .from("invoices")
        .select(INVOICE_COLUMNS)
        .eq("user_id", userId)
        .eq("deal_id", dealId)
        .in("status", UNPAID)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async insertInvoice(row) {
      const { data, error } = await admin
        .from("invoices")
        .insert({ ...row, user_id: userId })
        .select(INVOICE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    async applyInvoice(input) {
      const { data, error } = await admin.rpc("fakturoid_apply_invoice", {
        _user_id: userId,
        _fakturoid_id: input.fakturoidId,
        _status: sqlNull(input.status),
        _number: sqlNull(input.number),
        _amount: sqlNull(input.amount),
        _due_on: sqlNull(input.dueOn),
        _paid_on: sqlNull(input.paidOn),
        _move_deal: moveDeal,
      });
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      const result = data as { invoice_id?: string; paid_now?: boolean; deal_moved?: boolean };
      if (!result.invoice_id) return null;
      return {
        invoiceId: result.invoice_id,
        paidNow: Boolean(result.paid_now),
        dealMoved: Boolean(result.deal_moved),
      };
    },
  };
}

// -----------------------------------------------------------------------------
// Connection
// -----------------------------------------------------------------------------

export async function getFakturoidStatus(userId: string): Promise<FakturoidStatus> {
  const connection = await loadConnection(createAdminClient(), userId);
  if (!connection) return { connected: false };
  return {
    connected: true,
    slug: connection.account_slug,
    connectedAt: connection.connected_at,
    lastSyncedAt: connection.last_synced_at,
    lastSyncError: connection.last_sync_error,
    moveDealOnPaid: connection.move_deal_on_paid,
  };
}

/** Checks the credentials against Fakturoid before anything is stored. */
export async function connectFakturoid(
  userId: string,
  input: FakturoidConnectInput,
): Promise<FakturoidStatus> {
  const parsed = fakturoidConnectSchema.safeParse(input);
  if (!parsed.success) throw new InvoiceError("validation");
  const { clientId, clientSecret, slug } = parsed.data;
  const key = encryptionKey();

  await createFakturoidClient(
    { clientId, clientSecret, slug },
    { userAgent: userAgent() },
  ).verify();

  const admin = createAdminClient();
  const { error } = await admin.from("fakturoid_connections").upsert(
    {
      user_id: userId,
      account_slug: slug,
      encrypted_credentials: encryptSecret(JSON.stringify({ clientId, clientSecret }), userId, key),
      connected_at: new Date().toISOString(),
      last_synced_at: null,
      last_sync_error: null,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
  return getFakturoidStatus(userId);
}

/** Invoices already issued stay, as plain invoices kept in the app. */
export async function disconnectFakturoid(userId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("fakturoid_connections")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

export async function setMoveDealOnPaid(userId: string, value: boolean): Promise<void> {
  const { data, error } = await createAdminClient()
    .from("fakturoid_connections")
    .update({ move_deal_on_paid: value })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw error;
  if (!data?.length) throw new InvoiceError("notConnected");
}

// -----------------------------------------------------------------------------
// Invoices
// -----------------------------------------------------------------------------

/** Fakturoid when connected, otherwise the app's own invoice. */
export async function issueInvoice(
  supabase: Db,
  userId: string,
  dealId: string,
): Promise<{ invoice: Invoice; external: boolean }> {
  const admin = createAdminClient();
  const connection = await loadConnection(admin, userId);
  if (!connection) {
    return {
      invoice: await createLocalInvoiceProvider(supabase).createFromDeal(dealId),
      external: false,
    };
  }
  const invoice = await issueFakturoidInvoice(
    {
      fakturoid: clientFor(connection),
      store: storeFor(supabase, admin, userId, connection.move_deal_on_paid),
    },
    dealId,
    await userToday(admin, userId),
  );
  return { invoice, external: true };
}

export async function markInvoicePaid(
  supabase: Db,
  userId: string,
  invoiceId: string,
): Promise<{ dealMoved: boolean }> {
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, fakturoid_id, status")
    .eq("id", invoiceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) throw new InvoiceError("invoiceNotFound");
  if (invoice.fakturoid_id === null) {
    await createLocalInvoiceProvider(supabase).markPaid(invoiceId);
    return { dealMoved: false };
  }
  if (invoice.status === "paid") return { dealMoved: false };

  const admin = createAdminClient();
  const connection = await loadConnection(admin, userId);
  if (!connection) throw new InvoiceError("notConnected");
  const result: ApplyResult = await payFakturoidInvoice(
    {
      fakturoid: clientFor(connection),
      store: storeFor(supabase, admin, userId, connection.move_deal_on_paid),
    },
    invoice.fakturoid_id,
    await userToday(admin, userId),
  );
  return { dealMoved: result.dealMoved };
}

/**
 * Brings the state of this user's Fakturoid invoices back into the app and
 * records the outcome on the connection, so the settings can show it.
 */
export async function syncUser(userId: string): Promise<SyncOutcome> {
  const admin = createAdminClient();
  const connection = await loadConnection(admin, userId);
  if (!connection) throw new InvoiceError("notConnected");
  const startedAt = new Date().toISOString();

  try {
    const { data: waiting, error } = await admin
      .from("invoices")
      .select("fakturoid_id, created_at")
      .eq("user_id", userId)
      .not("fakturoid_id", "is", null)
      .in("status", UNPAID)
      .order("created_at", { ascending: true })
      .limit(SYNC_INVOICE_LIMIT);
    if (error) throw error;

    const ids = new Set(
      waiting.flatMap((row) => (row.fakturoid_id === null ? [] : [row.fakturoid_id])),
    );
    const outcome =
      ids.size === 0
        ? { checked: 0, updated: 0, paid: 0, dealsMoved: 0 }
        : await syncFakturoidInvoices(
            {
              fakturoid: clientFor(connection),
              store: storeFor(admin, admin, userId, connection.move_deal_on_paid),
            },
            ids,
            syncSince(connection.last_synced_at, waiting[0]?.created_at ?? startedAt),
          );

    await admin
      .from("fakturoid_connections")
      .update({ last_synced_at: startedAt, last_sync_error: null })
      .eq("user_id", userId);
    return outcome;
  } catch (error) {
    const code =
      error instanceof FakturoidError || error instanceof InvoiceError ? error.code : "unknown";
    await admin
      .from("fakturoid_connections")
      .update({ last_sync_error: code })
      .eq("user_id", userId);
    throw error;
  }
}

/** The daily job: every connected account, one after another, failures logged. */
export async function syncAllConnections(): Promise<{
  users: number;
  failed: number;
  paid: number;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fakturoid_connections")
    .select("user_id")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(CRON_CONNECTION_LIMIT);
  if (error) throw error;
  let failed = 0;
  let paid = 0;
  for (const { user_id } of data) {
    try {
      // After the trial the workspace stays as it was; last_synced_at is kept,
      // so the first sync after choosing a plan catches up.
      const { data: readOnly, error: planError } = await admin.rpc("workspace_read_only", {
        _owner: user_id,
      });
      if (planError) throw planError;
      if (readOnly) continue;
      paid += (await syncUser(user_id)).paid;
    } catch (syncError) {
      failed++;
      console.error("fakturoid sync failed", user_id, syncError);
    }
  }
  return { users: data.length, failed, paid };
}
