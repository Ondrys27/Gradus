// @vitest-environment node
//
// The whole connection of an MCP client (28.8) against the app's own routes,
// in process: the official SDK client discovers the server, registers itself
// (RFC 7591), is sent to the consent (here the consent's own server step
// makes the grant), exchanges the code with PKCE, lists the tools, calls
// them, and is cut off at once when the person disconnects. The OAuth store
// runs for real on an in-memory database; the person's Supabase client and
// the rights of each company are fixtures (the rights themselves are covered
// by tools.test.ts and the database tests).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceFor, type Workspace } from "@/features/account/workspace";
import { templateGrants } from "@/features/workers/permissions-catalog";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";

vi.mock("server-only", () => ({}));

const OWNER = "00000000-0000-4000-8000-000000000001";
const WORKER = "00000000-0000-4000-8000-000000000002";
const ORIGIN = "http://localhost:3000";

// --- An in-memory database for the admin client ------------------------------------

type Row = Record<string, unknown>;
const tables = vi.hoisted(() => new Map<string, Record<string, unknown>[]>());

function fakeAdmin() {
  const rowsOf = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  function builder(table: string) {
    let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: Row | Row[] = {};
    let returning = false;
    let mode: "many" | "single" | "maybe" = "many";
    let head = false;
    const filters: Array<(row: Row) => boolean> = [];
    const api: Record<string, unknown> = {
      select(_columns?: string, options?: { head?: boolean }) {
        if (op !== "select") returning = true;
        head = Boolean(options?.head);
        return api;
      },
      insert(values: Row | Row[]) {
        op = "insert";
        payload = values;
        return api;
      },
      upsert(values: Row) {
        op = "upsert";
        payload = values;
        return api;
      },
      update(values: Row) {
        op = "update";
        payload = values;
        return api;
      },
      delete() {
        op = "delete";
        return api;
      },
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), api),
      neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), api),
      is: (column: string, value: unknown) => (
        filters.push((row) => (row[column] ?? null) === value),
        api
      ),
      in: (column: string, values: unknown[]) => (
        filters.push((row) => values.includes(row[column])),
        api
      ),
      gt: (column: string, value: string) => (
        filters.push((row) => String(row[column]) > value),
        api
      ),
      gte: (column: string, value: string) => (
        filters.push((row) => String(row[column]) >= value),
        api
      ),
      order: () => api,
      limit: () => api,
      range: () => api,
      maybeSingle: () => ((mode = "maybe"), api),
      single: () => ((mode = "single"), api),
      then(resolve: (value: unknown) => void) {
        const rows = rowsOf(table);
        let data: Row[] = [];
        if (op === "insert" || op === "upsert") {
          const list = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
            id: row.id ?? crypto.randomUUID(),
            created_at: new Date().toISOString(),
            revoked_at: null,
            used_at: null,
            last_used_at: null,
            ...row,
          }));
          for (const row of list) {
            const index = op === "upsert" ? rows.findIndex((item) => item.id === row.id) : -1;
            if (index >= 0) rows[index] = { ...rows[index], ...row };
            else rows.push(row);
          }
          data = list;
        } else {
          const hit = rows.filter((row) => filters.every((filter) => filter(row)));
          if (op === "update") hit.forEach((row) => Object.assign(row, payload));
          if (op === "delete")
            tables.set(
              table,
              rows.filter((row) => !hit.includes(row)),
            );
          data = hit.map((row) => ({ ...row }));
        }
        const value =
          mode === "many" ? (op === "select" || returning ? data : null) : (data[0] ?? null);
        resolve({ data: head ? null : value, error: null, count: data.length });
      },
    };
    return api;
  }
  const rate = new Map<string, number>();
  return {
    from: builder,
    rpc: async (name: string, args: Record<string, string>) => {
      if (name === "mcp_rate_hit") {
        const hits = (rate.get(args._grant) ?? 0) + 1;
        rate.set(args._grant, hits);
        return { data: hits, error: null };
      }
      return { data: null, error: null };
    },
    auth: { admin: {} },
  };
}
const admin = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.current }));
vi.mock("@/lib/analytics/track", () => ({ track: async () => {}, trackLater: () => {} }));

// --- The person's own client and the companies' rights ----------------------------

const userClients = vi.hoisted(() => [] as Array<{ space: string; grant: string }>);
const workspaces = vi.hoisted(() => new Map<string, unknown>());

function fakeUserDb() {
  const result = (data: unknown) => ({
    then: (resolve: (value: unknown) => void) => resolve({ data, error: null, count: 0 }),
  });
  const chain = (data: unknown): unknown =>
    new Proxy(function () {}, {
      get: (_target, prop) => (prop === "then" ? result(data).then : () => chain(data)),
    });
  return {
    from: (table: string) =>
      chain(
        table === "profiles" ? { display_name: "Ondřej" } : table === "user_settings" ? null : [],
      ),
    rpc: async (name: string) => {
      if (name === "mcp_space_open") return { data: true, error: null };
      if (name === "trash_retention_days") return { data: 7, error: null };
      if (name === "my_spaces")
        return {
          data: [
            {
              space_id: OWNER,
              role: "owner",
              worker_id: null,
              company_name: "Pekárna",
              logo_url: null,
              owner_name: "Ondřej",
            },
          ],
          error: null,
        };
      return { data: null, error: null };
    },
  };
}

vi.mock("./session", () => ({
  MCP_GRANT_HEADER: "x-gradus-mcp-grant",
  newGrantSession: async () => "sealed",
  endGrantSession: async () => {},
  grantAccessToken: async () => "user-session-token",
  userClient: (_token: string, space: string, grant: string) => {
    userClients.push({ space, grant });
    return fakeUserDb();
  },
}));

vi.mock("@/features/grady/server/tools/context", () => ({
  loadToolWorkspace: async (_db: unknown, userId: string, spaceId: string) =>
    workspaces.get(`${userId}:${spaceId}`),
  createToolContext: async (args: { db: unknown; userId: string; workspace: Workspace }) => ({
    db: args.db,
    userId: args.userId,
    workspaceId: args.workspace.id,
    workspace: args.workspace,
    settings: DEFAULT_FORMAT_SETTINGS,
    timezone: "Europe/Prague",
    locale: "cs",
    country: "CZ",
    t: (key: string) => key,
    track: () => {},
  }),
}));

const { handleMcpRequest } = await import("./handler");
const register = await import("@/app/api/oauth/register/route");
const token = await import("@/app/api/oauth/token/route");
const resourceMeta = await import("@/app/.well-known/oauth-protected-resource/[...resource]/route");
const rootResourceMeta = await import("@/app/.well-known/oauth-protected-resource/route");
const serverMeta = await import("@/app/.well-known/oauth-authorization-server/route");
const store = await import("./store");
const oauth = await import("../oauth");

/** The app's routes, as the client's fetch reaches them. */
async function appFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const { pathname } = new URL(request.url);
  if (pathname === "/api/mcp") return handleMcpRequest(request);
  if (pathname === "/api/oauth/register") return register.POST(request);
  if (pathname === "/api/oauth/token") return token.POST(request);
  if (pathname === "/.well-known/oauth-protected-resource/api/mcp")
    return resourceMeta.GET(request, { params: Promise.resolve({ resource: ["api", "mcp"] }) });
  if (pathname === "/.well-known/oauth-protected-resource") return rootResourceMeta.GET(request);
  if (pathname === "/.well-known/oauth-authorization-server") return serverMeta.GET(request);
  return new Response("not found", { status: 404 });
}

/** A client app with its storage, like Claude's: it registers itself and keeps its tokens. */
function clientApp() {
  const state: {
    info?: OAuthClientInformationMixed;
    tokens?: OAuthTokens;
    verifier?: string;
    authorizeUrl?: URL;
  } = {};
  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return "https://claude.ai/api/mcp/auth_callback";
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },
    clientInformation: () => state.info,
    saveClientInformation: (info) => void (state.info = info),
    tokens: () => state.tokens,
    saveTokens: (tokens) => void (state.tokens = tokens),
    redirectToAuthorization: (url) => void (state.authorizeUrl = url),
    saveCodeVerifier: (verifier) => void (state.verifier = verifier),
    codeVerifier: () => state.verifier!,
  };
  const transport = () =>
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), {
      authProvider: provider,
      fetch: appFetch,
    });
  return { state, provider, transport };
}

/** The consent step: the request the client sent the browser with, allowed by the person. */
async function consent(
  authorizeUrl: URL,
  who: { userId: string; level: "read" | "write" | "full"; spaces: string[] },
) {
  const params = oauth.authorizeParams(authorizeUrl.searchParams);
  const request = oauth.authorizeSchema.parse(params);
  const client = await store.findClient(admin.current as never, request.client_id);
  expect(client).not.toBeNull();
  expect(oauth.redirectAllowed(client!.redirect_uris, request.redirect_uri)).toBe(true);
  expect(oauth.resourceMatches(request.resource, ORIGIN)).toBe(true);
  return store.createGrantWithCode(admin.current as never, {
    userId: who.userId,
    client: client!,
    level: who.level,
    spaceIds: who.spaces,
    spaceId: who.spaces[0],
    redirectUri: request.redirect_uri,
    codeChallenge: request.code_challenge,
    resource: oauth.canonicalResource(ORIGIN),
  });
}

async function connect(who: {
  userId: string;
  level: "read" | "write" | "full";
  spaces: string[];
}) {
  const app = clientApp();
  const first = new Client({ name: "test-client", version: "1.0.0" });
  await expect(first.connect(app.transport())).rejects.toThrow(/Unauthorized/i);
  expect(app.state.info?.client_id).toMatch(/^gmcp_/);
  expect(app.state.authorizeUrl?.pathname).toBe("/oauth/authorize");
  const code = await consent(app.state.authorizeUrl!, who);
  const finishing = app.transport();
  await finishing.finishAuth(code);
  expect(app.state.tokens?.access_token).toMatch(/^gat_/);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(app.transport());
  return { app, client };
}

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text: string }> }).content[0]?.text ?? "") as string;
}

beforeEach(() => {
  tables.clear();
  userClients.length = 0;
  admin.current = fakeAdmin();
  workspaces.set(`${OWNER}:${OWNER}`, workspaceFor(OWNER, null));
  workspaces.set(
    `${WORKER}:${OWNER}`,
    workspaceFor(WORKER, { id: "w1", ownerId: OWNER }, templateGrants("assistant")),
  );
});

describe("an MCP client end to end", () => {
  it("registers, is authorised, lists and calls tools, and is cut off on disconnect", async () => {
    const { app, client } = await connect({ userId: OWNER, level: "read", spaces: [OWNER] });

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["whoami", "switch_space", "list_trash", "list_deals"]),
    );
    // Read only: no writing tool is even offered.
    expect(names).not.toContain("create_crm_task");
    expect(tools.find((tool) => tool.name === "list_deals")?.annotations?.readOnlyHint).toBe(true);

    const me = await client.callTool({ name: "whoami", arguments: {} });
    expect(me.isError).toBeFalsy();
    expect(textOf(me)).toContain("<gradus_data");
    expect(me.structuredContent).toMatchObject({
      result: { access: "read", company: { spaceId: OWNER, role: "owner" } },
    });

    const trash = await client.callTool({ name: "list_trash", arguments: {} });
    expect(trash.structuredContent).toMatchObject({ result: { items: [], retentionDays: 7 } });

    // A write tool called anyway: refused by the level, and recorded.
    const write = await client.callTool({
      name: "create_crm_task",
      arguments: { title: "Zavolat", dealId: crypto.randomUUID() },
    });
    expect(write.isError).toBe(true);
    expect(write.structuredContent).toMatchObject({ error: "insufficientLevel" });

    // Every call ran as the person in the grant's company, never as the admin.
    expect(userClients.every((entry) => entry.space === OWNER)).toBe(true);
    const calls = tables.get("mcp_calls") ?? [];
    expect(calls.map((call) => [call.tool, call.ok])).toEqual([
      ["whoami", true],
      ["list_trash", true],
      ["create_crm_task", false],
    ]);

    // Disconnect: the very next call is unauthorised.
    const grant = (tables.get("mcp_grants") ?? [])[0];
    expect(await store.revokeGrant(admin.current as never, OWNER, grant.id as string)).toBe(true);
    expect(tables.get("oauth_tokens") ?? []).toHaveLength(0);
    await expect(client.callTool({ name: "whoami", arguments: {} })).rejects.toThrow();
    expect(app.state.tokens).toBeDefined();
  }, 30_000);

  it("rotates refresh tokens and refuses a replayed one", async () => {
    const { app } = await connect({ userId: OWNER, level: "write", spaces: [OWNER] });
    const clientId = app.state.info!.client_id;
    const first = app.state.tokens!.refresh_token!;
    const body = (refresh: string) =>
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: clientId,
      });
    const ok = await appFetch(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body(first),
    });
    expect(ok.status).toBe(200);
    const next = (await ok.json()) as { refresh_token: string; scope: string };
    expect(next.refresh_token).not.toBe(first);
    expect(next.scope).toBe("gradus.read gradus.write");
    const again = await appFetch(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body(first),
    });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });
  }, 30_000);

  it("a worker gets nothing above their rights, and the token stays in its company", async () => {
    const { client } = await connect({ userId: WORKER, level: "full", spaces: [OWNER] });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    // Assistant: tasks and the calendar, no pipeline, finance or company rights.
    expect(names).toContain("create_crm_task");
    for (const name of [
      "list_deals",
      "delete_deal",
      "finance_month",
      "issue_invoice",
      "set_worker_permissions",
    ]) {
      expect(names, name).not.toContain(name);
    }
    const deals = await client.callTool({ name: "list_deals", arguments: {} });
    expect(deals.structuredContent).toMatchObject({ error: "forbidden" });

    // The worker's own company was not allowed on the consent: it can not be switched to.
    const switched = await client.callTool({
      name: "switch_space",
      arguments: { spaceId: WORKER },
    });
    expect(switched.structuredContent).toMatchObject({ error: "spaceNotAllowed" });
    expect(userClients.every((entry) => entry.space === OWNER)).toBe(true);
  }, 30_000);

  it("answers without a token with the resource metadata to discover", async () => {
    const response = await appFetch(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    const get = await appFetch(`${ORIGIN}/api/mcp`, { method: "GET" });
    expect(get.status).toBe(405);
    const evil = await appFetch(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(evil.status).toBe(403);
  });
});
