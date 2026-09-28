// @vitest-environment node
//
// The Fakturoid integration without a live account: the HTTP client runs
// against a mocked fetch, the workflow against an in-memory store.

import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createFakturoidClient, FAKTUROID_BASE_URL } = await import("./client");
const { decryptSecret, encryptSecret, encryptionKey } = await import("./crypto");
const { FakturoidError, InvoiceError, toFailure, unwrap, errorFromCode } = await import("./errors");
const mapping = await import("./mapping");
const { fakturoidConnectSchema, normalizeSlug } = await import("./schema");
const { issueFakturoidInvoice, payFakturoidInvoice, syncFakturoidInvoices } =
  await import("./workflow");
type Store = import("./workflow").InvoiceStore;
type Invoice = import("../types").Invoice;

// -----------------------------------------------------------------------------
// A tiny fake of Fakturoid's HTTP API
// -----------------------------------------------------------------------------

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Routes "METHOD /path" (without the account prefix) to handlers; the token always works. */
function fakeFakturoid(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    if (url === `${FAKTUROID_BASE_URL}/oauth/token`) {
      const handler = routes["POST /oauth/token"];
      return handler ? handler(call) : json(200, { access_token: "tok", expires_in: 7200 });
    }
    const path = url.replace(`${FAKTUROID_BASE_URL}/accounts/acme`, "").split("?")[0];
    const handler = routes[`${call.method} ${path}`];
    if (!handler) return json(404, { error: "not found" });
    return handler(call);
  });
  const client = createFakturoidClient(
    { clientId: "id", clientSecret: "secret", slug: "acme" },
    { fetch: fetchMock as unknown as typeof fetch, userAgent: "Gradus (owner@example.com)" },
  );
  return { client, calls, fetchMock };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof FakturoidError || error instanceof InvoiceError ? error.code : "other";
  }
}

describe("Fakturoid client", () => {
  it("gets a token with the client credentials once and sends it as a bearer", async () => {
    const { client, calls } = fakeFakturoid({
      "GET /account.json": () => json(200, { name: "Acme s.r.o." }),
    });
    expect(await client.verify()).toEqual({ name: "Acme s.r.o." });
    await client.verify();

    const tokenCalls = calls.filter((c) => c.url.endsWith("/oauth/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].headers.authorization).toBe(
      `Basic ${Buffer.from("id:secret").toString("base64")}`,
    );
    expect(tokenCalls[0].body).toEqual({ grant_type: "client_credentials" });
    const accountCall = calls.find((c) => c.url.endsWith("/accounts/acme/account.json"));
    expect(accountCall?.headers.authorization).toBe("Bearer tok");
    expect(accountCall?.headers["user-agent"]).toBe("Gradus (owner@example.com)");
  });

  it("sorts failures into codes the user can act on", async () => {
    const badToken = fakeFakturoid({ "POST /oauth/token": () => json(401, { error: "invalid" }) });
    expect(await codeOf(badToken.client.verify())).toBe("invalidCredentials");

    const wrongSlug = fakeFakturoid({});
    expect(await codeOf(wrongSlug.client.verify())).toBe("accountNotFound");

    const down = fakeFakturoid({ "GET /account.json": () => json(503, null) });
    expect(await codeOf(down.client.verify())).toBe("unavailable");

    const limited = fakeFakturoid({ "GET /account.json": () => json(429, null) });
    expect(await codeOf(limited.client.verify())).toBe("rateLimited");

    const offline = fakeFakturoid({
      "GET /account.json": () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await codeOf(offline.client.verify())).toBe("unavailable");
  });

  it("passes Fakturoid's own reason for a rejected document along", async () => {
    const { client } = fakeFakturoid({
      "POST /invoices.json": () =>
        json(422, { errors: { subject_id: ["neexistuje"], lines: ["je povinná položka"] } }),
    });
    const error = await client
      .createInvoice({
        subject_id: 1,
        issued_on: "2026-09-28",
        due: 14,
        currency: "CZK",
        lines: [],
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FakturoidError);
    expect((error as InstanceType<typeof FakturoidError>).code).toBe("validation");
    expect((error as InstanceType<typeof FakturoidError>).detail).toBe(
      "subject_id: neexistuje; lines: je povinná položka",
    );
  });

  it("reads changed invoices page by page until a short page", async () => {
    const page = (n: number, size: number) =>
      Array.from({ length: size }, (_, i) => ({ id: n * 100 + i, number: `${n}-${i}` }));
    const { client, calls } = fakeFakturoid({
      "GET /invoices.json": (call) => {
        const p = Number(new URL(call.url).searchParams.get("page"));
        return json(200, p === 1 ? page(1, 40) : page(2, 3));
      },
    });
    const since = new Date("2026-09-01T00:00:00Z");
    const list = await client.listInvoicesUpdatedSince(since);
    expect(list).toHaveLength(43);
    const listCalls = calls.filter((c) => c.url.includes("/invoices.json"));
    expect(listCalls).toHaveLength(2);
    expect(new URL(listCalls[0].url).searchParams.get("updated_since")).toBe(since.toISOString());
  });

  it("never trusts the subject filter blindly", async () => {
    const { client } = fakeFakturoid({
      "GET /subjects.json": () =>
        json(200, [
          { id: 1, name: "Stranger", custom_id: null },
          { id: 2, name: "Acme", custom_id: "gradus-contact-c1" },
        ]),
    });
    expect(await client.findSubjectByCustomId("gradus-contact-c1")).toMatchObject({ id: 2 });
    expect(await client.findSubjectByCustomId("gradus-contact-c9")).toBeNull();
  });
});

describe("secret encryption", () => {
  const key = randomBytes(32);

  it("round-trips for the same user only", () => {
    const stored = encryptSecret('{"clientId":"a","clientSecret":"b"}', "user-1", key);
    expect(stored).not.toContain("clientSecret");
    expect(decryptSecret(stored, "user-1", key)).toBe('{"clientId":"a","clientSecret":"b"}');
    expect(() => decryptSecret(stored, "user-2", key)).toThrow();
    expect(() => decryptSecret(stored, "user-1", randomBytes(32))).toThrow();
  });

  it("refuses to run without a proper key", () => {
    expect(() => encryptionKey("")).toThrow(InvoiceError);
    expect(() => encryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(
      /encryptionKeyMissing/,
    );
    expect(encryptionKey(key.toString("base64"))).toHaveLength(32);
  });
});

describe("mapping", () => {
  const contact = {
    id: "c1",
    company_name: "  ",
    first_name: "Jana",
    last_name: "Nováková",
    email: "jana@example.com",
    phone: null,
    address: "Dlouhá 1",
    city: "Praha",
    postal_code: "110 00",
    country_code: "cz",
    website: "",
  };

  it("makes a subject from a contact, leaving empty fields out", () => {
    expect(mapping.subjectFromContact(contact)).toEqual({
      name: "Jana Nováková",
      custom_id: "gradus-contact-c1",
      email: "jana@example.com",
      street: "Dlouhá 1",
      city: "Praha",
      zip: "110 00",
      country: "CZ",
    });
    expect(mapping.subjectFromContact({ ...contact, first_name: null, last_name: " " })).toBeNull();
  });

  it("invoices the deal as one line due in 14 days", () => {
    expect(
      mapping.invoiceFromDeal(
        { id: "d1", title: "Web", value: 25000, currency: "CZK", contact_id: "c1" },
        7,
        "2026-09-28",
      ),
    ).toEqual({
      subject_id: 7,
      custom_id: "gradus-deal-d1",
      issued_on: "2026-09-28",
      due: 14,
      currency: "CZK",
      lines: [{ name: "Web", quantity: 1, unit_price: 25000 }],
    });
  });

  it("maps Fakturoid's statuses and never stores overdue", () => {
    expect(mapping.mapFakturoidStatus("overdue")).toBe("open");
    expect(mapping.mapFakturoidStatus("sent")).toBe("sent");
    expect(mapping.mapFakturoidStatus("paid")).toBe("paid");
    expect(mapping.mapFakturoidStatus("uncollectible")).toBe("uncollectible");
    expect(mapping.mapFakturoidStatus("something-new")).toBeNull();
  });

  it("parses amounts and dates defensively", () => {
    expect(mapping.parseAmount("1210.0")).toBe(1210);
    expect(mapping.parseAmount("0.0")).toBeNull();
    expect(mapping.parseAmount("abc")).toBeNull();
    expect(mapping.isoDateOrNull("2026-10-12")).toBe("2026-10-12");
    expect(mapping.isoDateOrNull("12. 10. 2026")).toBeNull();
  });

  it("starts a sync an hour before the last one, or before the oldest waiting invoice", () => {
    expect(mapping.syncSince(null, "2026-09-01T10:00:00Z").toISOString()).toBe(
      "2026-09-01T09:00:00.000Z",
    );
    expect(mapping.syncSince("2026-09-27T03:30:00Z", "2026-09-01T10:00:00Z").toISOString()).toBe(
      "2026-09-27T02:30:00.000Z",
    );
  });
});

describe("connect form", () => {
  it("accepts a pasted Fakturoid address as the slug", () => {
    expect(normalizeSlug("https://app.fakturoid.cz/MojeFirma/invoices")).toBe("mojefirma");
    expect(normalizeSlug(" mojefirma ")).toBe("mojefirma");
    expect(
      fakturoidConnectSchema.safeParse({ clientId: "a", clientSecret: "b", slug: "moje firma" })
        .success,
    ).toBe(false);
    expect(
      fakturoidConnectSchema.parse({ clientId: " a ", clientSecret: "b", slug: "Acme" }),
    ).toEqual({ clientId: "a", clientSecret: "b", slug: "acme" });
  });
});

describe("errors", () => {
  it("turns database and API errors into codes, and codes back into errors", () => {
    expect(toFailure({ message: "deal_value_required", code: "23514" })).toEqual({
      ok: false,
      error: "dealValueRequired",
    });
    expect(toFailure(new FakturoidError("validation", 422, "lines: chybí"))).toEqual({
      ok: false,
      error: "validation",
      detail: "lines: chybí",
    });
    expect(toFailure(new Error("boom"))).toEqual({ ok: false, error: "unknown" });
    expect(() => unwrap({ ok: false, error: "rateLimited" })).toThrow(InvoiceError);
    expect(unwrap({ ok: true, data: 1 })).toBe(1);
    expect(errorFromCode("unavailable").code).toBe("unavailable");
    expect(errorFromCode("<script>").code).toBe("unknown");
  });
});

// -----------------------------------------------------------------------------
// Workflow
// -----------------------------------------------------------------------------

const DEAL = { id: "d1", title: "Web", value: 25000, currency: "CZK", contact_id: "c1" };
const CONTACT = {
  id: "c1",
  company_name: "Acme s.r.o.",
  first_name: null,
  last_name: null,
  email: null,
  phone: null,
  address: null,
  city: null,
  postal_code: null,
  country_code: null,
  website: null,
};

function memoryStore(overrides: Partial<Store> = {}) {
  const inserted: Invoice[] = [];
  const applied: import("./workflow").ApplyInput[] = [];
  const store: Store = {
    loadDeal: async (id) => (id === DEAL.id ? { deal: DEAL, contact: CONTACT } : null),
    findUnpaidForDeal: async () => null,
    insertInvoice: async (row) => {
      const invoice: Invoice = { id: `inv-${inserted.length + 1}`, paid_on: null, ...row };
      inserted.push(invoice);
      return invoice;
    },
    applyInvoice: async (input) => {
      applied.push(input);
      return { invoiceId: "inv-1", paidNow: input.status === "paid", dealMoved: false };
    },
    ...overrides,
  };
  return { store, inserted, applied };
}

const created = {
  id: 555,
  number: "2026-0007",
  status: "open",
  issued_on: "2026-09-28",
  due_on: "2026-10-12",
  paid_on: null,
  total: "30250.0",
  currency: "CZK",
};

describe("issuing an invoice in Fakturoid", () => {
  let routes: Record<string, (call: Call) => Response>;
  beforeEach(() => {
    routes = {
      "GET /subjects.json": () => json(200, []),
      "POST /subjects.json": () => json(201, { id: 42, name: "Acme s.r.o.", custom_id: "x" }),
      "POST /invoices.json": () => json(201, created),
      "DELETE /invoices/555.json": () => json(204, undefined),
    };
  });

  it("creates the subject once, issues the invoice and mirrors it with its number", async () => {
    const { client, calls } = fakeFakturoid(routes);
    const { store, inserted } = memoryStore();
    const invoice = await issueFakturoidInvoice({ fakturoid: client, store }, "d1", "2026-09-28");

    expect(invoice).toMatchObject({
      number: "2026-0007",
      amount: 30250,
      status: "open",
      due_on: "2026-10-12",
      fakturoid_id: 555,
      customer_name: "Acme s.r.o.",
      deal_id: "d1",
      contact_id: "c1",
    });
    expect(inserted).toHaveLength(1);
    const subjectCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/subjects.json"));
    expect(subjectCall?.body).toEqual({ name: "Acme s.r.o.", custom_id: "gradus-contact-c1" });
    const invoiceCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/invoices.json"));
    expect(invoiceCall?.body).toMatchObject({ subject_id: 42, due: 14, currency: "CZK" });
  });

  it("reuses the subject made for the contact before", async () => {
    routes["GET /subjects.json"] = () =>
      json(200, [{ id: 9, name: "Acme", custom_id: "gradus-contact-c1" }]);
    const { client, calls } = fakeFakturoid(routes);
    await issueFakturoidInvoice(
      { fakturoid: client, store: memoryStore().store },
      "d1",
      "2026-09-28",
    );
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/subjects.json"))).toBe(false);
    const invoiceCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/invoices.json"));
    expect(invoiceCall?.body).toMatchObject({ subject_id: 9 });
  });

  it("returns the invoice still waiting for payment without calling Fakturoid", async () => {
    const { client, fetchMock } = fakeFakturoid(routes);
    const waiting = { id: "old", number: "2026-0001" } as Invoice;
    const { store } = memoryStore({ findUnpaidForDeal: async () => waiting });
    expect(await issueFakturoidInvoice({ fakturoid: client, store }, "d1", "2026-09-28")).toBe(
      waiting,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs a deal with a value and a named contact", async () => {
    const { client } = fakeFakturoid(routes);
    expect(
      await codeOf(
        issueFakturoidInvoice({ fakturoid: client, store: memoryStore().store }, "nope", "x"),
      ),
    ).toBe("dealNotFound");
    const noValue = memoryStore({
      loadDeal: async () => ({ deal: { ...DEAL, value: null }, contact: CONTACT }),
    });
    expect(
      await codeOf(issueFakturoidInvoice({ fakturoid: client, store: noValue.store }, "d1", "x")),
    ).toBe("dealValueRequired");
    const noContact = memoryStore({
      loadDeal: async () => ({ deal: { ...DEAL, contact_id: null }, contact: null }),
    });
    expect(
      await codeOf(issueFakturoidInvoice({ fakturoid: client, store: noContact.store }, "d1", "x")),
    ).toBe("contactRequired");
  });

  it("withdraws the invoice in Fakturoid when it cannot be saved here", async () => {
    const { client, calls } = fakeFakturoid(routes);
    const { store } = memoryStore({
      insertInvoice: async () => {
        throw new Error("duplicate key");
      },
    });
    expect(await codeOf(issueFakturoidInvoice({ fakturoid: client, store }, "d1", "x"))).toBe(
      "saveFailed",
    );
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/invoices/555.json"))).toBe(
      true,
    );
  });

  it("leaves nothing half-done when Fakturoid is down", async () => {
    routes["POST /invoices.json"] = () => json(502, null);
    const { client } = fakeFakturoid(routes);
    const { store, inserted } = memoryStore();
    expect(await codeOf(issueFakturoidInvoice({ fakturoid: client, store }, "d1", "x"))).toBe(
      "unavailable",
    );
    expect(inserted).toHaveLength(0);
  });
});

describe("paying and syncing", () => {
  it("records the payment in Fakturoid before booking it here", async () => {
    const { client, calls } = fakeFakturoid({
      "POST /invoices/555/payments.json": () => json(201, { id: 1 }),
    });
    const { store, applied } = memoryStore();
    await payFakturoidInvoice({ fakturoid: client, store }, 555, "2026-09-28");
    const payment = calls.find((c) => c.url.endsWith("/invoices/555/payments.json"));
    expect(payment?.body).toEqual({ paid_on: "2026-09-28", mark_document_as_paid: true });
    expect(applied).toEqual([
      expect.objectContaining({ fakturoidId: 555, status: "paid", paidOn: "2026-09-28" }),
    ]);
  });

  it("books nothing when Fakturoid refuses the payment", async () => {
    const { client } = fakeFakturoid({
      "POST /invoices/555/payments.json": () => json(403, null),
    });
    const { store, applied } = memoryStore();
    expect(await codeOf(payFakturoidInvoice({ fakturoid: client, store }, 555, "x"))).toBe(
      "forbidden",
    );
    expect(applied).toHaveLength(0);
  });

  it("applies only invoices the app is waiting for, and counts payments", async () => {
    const { client } = fakeFakturoid({
      "GET /invoices.json": () =>
        json(200, [
          { ...created, id: 1, status: "paid", paid_on: "2026-09-27" },
          { ...created, id: 2, status: "overdue" },
          { ...created, id: 3, status: "paid", paid_on: "2026-09-27" },
        ]),
    });
    const { store, applied } = memoryStore();
    const outcome = await syncFakturoidInvoices(
      { fakturoid: client, store },
      new Set([1, 2]),
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(outcome).toEqual({ checked: 2, updated: 2, paid: 1, dealsMoved: 0 });
    expect(applied.map((a) => [a.fakturoidId, a.status, a.paidOn])).toEqual([
      [1, "paid", "2026-09-27"],
      [2, "open", null],
    ]);
  });

  it("does not call Fakturoid when nothing is waiting", async () => {
    const { client, fetchMock } = fakeFakturoid({});
    const outcome = await syncFakturoidInvoices(
      { fakturoid: client, store: memoryStore().store },
      new Set(),
      new Date(),
    );
    expect(outcome.checked).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
