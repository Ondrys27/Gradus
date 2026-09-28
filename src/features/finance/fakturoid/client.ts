import "server-only";
import { codeForStatus, describeValidation, FakturoidError } from "./errors";

/**
 * A small client for the Fakturoid API v3, OAuth 2.0 client credentials flow.
 * `fetch` is injected so tests run against a mock and nothing here needs a
 * live account. Server only: the secret never reaches the browser.
 */

export const FAKTUROID_BASE_URL = "https://app.fakturoid.cz/api/v3";
const TIMEOUT_MS = 15_000;
/** Fakturoid returns 40 documents per page; a sync reads at most this many pages. */
export const MAX_SYNC_PAGES = 10;

export type FakturoidCredentials = {
  clientId: string;
  clientSecret: string;
  slug: string;
};

export type FakturoidSubjectInput = {
  name: string;
  custom_id?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  zip?: string;
  country?: string;
  web?: string;
};

export type FakturoidSubject = { id: number; name: string; custom_id: string | null };

export type FakturoidInvoiceInput = {
  subject_id: number;
  custom_id?: string;
  issued_on: string;
  /** Days until due. */
  due: number;
  currency: string;
  lines: { name: string; quantity: number; unit_price: number }[];
};

/** The parts of a Fakturoid invoice the app mirrors. */
export type FakturoidInvoice = {
  id: number;
  number: string;
  status: string;
  issued_on: string | null;
  due_on: string | null;
  paid_on: string | null;
  total: string | number | null;
  currency: string | null;
};

export type FakturoidClient = ReturnType<typeof createFakturoidClient>;

type FetchLike = typeof fetch;

export function createFakturoidClient(
  credentials: FakturoidCredentials,
  options: { fetch?: FetchLike; userAgent: string; baseUrl?: string },
) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl ?? FAKTUROID_BASE_URL;
  const accountBase = `${base}/accounts/${encodeURIComponent(credentials.slug)}`;
  let token: { value: string; expiresAt: number } | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      // Network failure or timeout: nothing reached Fakturoid, or no answer came back.
      throw new FakturoidError("unavailable");
    }
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now()) return token.value;
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
      "base64",
    );
    const response = await send(`${base}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": options.userAgent,
      },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    });
    if (!response.ok) {
      throw new FakturoidError(codeForStatus(response.status, "token"), response.status);
    }
    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!body || typeof body.access_token !== "string") {
      throw new FakturoidError("unavailable", response.status);
    }
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 7200;
    // A minute of margin so a token never expires in the middle of a request.
    token = { value: body.access_token, expiresAt: Date.now() + Math.max(0, seconds - 60) * 1000 };
    return token.value;
  }

  async function request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const bearer = await accessToken();
    const response = await send(`${accountBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
        "User-Agent": options.userAgent,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const code = codeForStatus(response.status, "request");
      throw new FakturoidError(
        code,
        response.status,
        code === "validation" ? describeValidation(payload) : undefined,
      );
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    /** Checks the credentials and the account slug in one call. */
    async verify(): Promise<{ name: string | null }> {
      const account = await request<{ name?: string | null }>("GET", "/account.json");
      return { name: account?.name ?? null };
    },

    /** The subject the app created for a contact earlier, found by its custom id. */
    async findSubjectByCustomId(customId: string): Promise<FakturoidSubject | null> {
      const list = await request<FakturoidSubject[]>(
        "GET",
        `/subjects.json?custom_id=${encodeURIComponent(customId)}`,
      );
      // Filtered again here, so an ignored query parameter can never pick a stranger.
      return (Array.isArray(list) ? list : []).find((s) => s.custom_id === customId) ?? null;
    },

    createSubject(input: FakturoidSubjectInput): Promise<FakturoidSubject> {
      return request<FakturoidSubject>("POST", "/subjects.json", input);
    },

    createInvoice(input: FakturoidInvoiceInput): Promise<FakturoidInvoice> {
      return request<FakturoidInvoice>("POST", "/invoices.json", input);
    },

    async deleteInvoice(id: number): Promise<void> {
      await request<void>("DELETE", `/invoices/${id}.json`);
    },

    /** Records a full payment; Fakturoid then marks the invoice paid. */
    async payInvoice(id: number, paidOn: string): Promise<void> {
      await request<unknown>("POST", `/invoices/${id}/payments.json`, {
        paid_on: paidOn,
        mark_document_as_paid: true,
      });
    },

    /** Invoices changed since a moment, page by page, up to MAX_SYNC_PAGES. */
    async listInvoicesUpdatedSince(since: Date): Promise<FakturoidInvoice[]> {
      const all: FakturoidInvoice[] = [];
      for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
        const list = await request<FakturoidInvoice[]>(
          "GET",
          `/invoices.json?updated_since=${encodeURIComponent(since.toISOString())}&page=${page}`,
        );
        if (!Array.isArray(list) || list.length === 0) break;
        all.push(...list);
        if (list.length < 40) break;
      }
      return all;
    },
  };
}
