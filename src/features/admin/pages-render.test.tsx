/**
 * Renders every page of the administration the way the server would, with
 * fake data, and checks two things that `next build` cannot (the pages are
 * dynamic and only run on a real request):
 *
 * - every translation key exists, in both languages;
 * - only serializable props cross into client components (no functions,
 *   class instances…), the rule React enforces at the server/client boundary.
 *
 * Client modules are replaced by stubs that record their props; server
 * components are called and their output resolved recursively.
 */
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

vi.mock("server-only", () => ({}));

const CLIENT = Symbol("client");
type ClientStub = ((props: unknown) => null) & { [CLIENT]: string };

function clientStub(name: string): ClientStub {
  const stub = (() => null) as unknown as ClientStub;
  stub[CLIENT] = name;
  return stub;
}

/** A "use client" module: every component export becomes a recording stub. */
async function stubClientModule(load: () => Promise<Record<string, unknown>>) {
  const actual = await load();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [
      name,
      typeof value === "function" && /^[A-Z]/.test(name) ? clientStub(name) : value,
    ]),
  );
}

vi.mock("@/features/admin/ui/data-blocks", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/admin-chart", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/metric-tile", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/explorer-controls", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/admin-controls", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/internal-toggle", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/ai-caps-form", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/user-ai-cap-form", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/feature-request-row", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/admin-nav", (load) => stubClientModule(load));
vi.mock("@/features/admin/ui/admin-view", (load) => stubClientModule(load));
vi.mock("@/features/admin/admin-session", (load) => stubClientModule(load));
vi.mock("next/link", () => ({ default: clientStub("Link") }));

// --- Session, audit and database --------------------------------------------------

vi.mock("@/features/admin/server/guard", () => ({
  requireAdmin: async () => ({ userId: "00000000-0000-4000-8000-000000000001", expiresAt: "2026-10-10T00:00:00Z" }),
  adminAccess: async () => ({ userId: "00000000-0000-4000-8000-000000000001", expiresAt: "2026-10-10T00:00:00Z" }),
  isOwnerAccount: async () => true,
  adminNotFound: () => new Response(null, { status: 404 }),
}));

vi.mock("@/features/admin/server/audit", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  logAdminAction: async () => true,
}));

/** A query builder that accepts any chain and resolves to nothing. */
function fakeDb(single = false): unknown {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => void) =>
          resolve({ data: single ? null : [], error: null, count: 0 });
      }
      return () => fakeDb(single || prop === "single" || prop === "maybeSingle");
    },
  });
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeDb(),
}));

/** One row with every field the registry's row metrics are read for. */
const ROW = {
  key: "true",
  section: "milestones",
  metric: "deals_won",
  currency: "CZK",
  keyword: "kavárna",
  value: 3,
  users: 2,
  active_users: 1,
  pct: 50,
  actions: 4,
  actions_per_user: 2,
  p50: 1.5,
  p95: 3,
  n: 4,
  items: 2,
  total: 1000,
};

vi.mock("@/lib/analytics/metrics-query", () => ({
  runMetric: async () => ({ kind: "rows", rows: [ROW] }),
}));

// --- Framework -------------------------------------------------------------------

let locale: "cs" | "en" = "cs";
const missing: string[] = [];

function translator(namespace?: string) {
  return createTranslator({
    locale,
    messages: locale === "cs" ? cs : en,
    namespace: namespace as never,
    onError: (error) => missing.push(error.message),
  });
}

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg?: string | { namespace?: string }) =>
    translator(typeof arg === "string" ? arg : arg?.namespace),
  getLocale: async () => locale,
}));

vi.mock("next-intl", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  useTranslations: (namespace?: string) => translator(namespace),
  useLocale: () => locale,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

// --- The walker --------------------------------------------------------------------

/** Why a value cannot be a prop of a client component, or null when it can. */
function notSerializable(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (["string", "number", "boolean", "bigint"].includes(typeof value)) return null;
  if (typeof value === "function") {
    const reference = (value as { $$typeof?: symbol }).$$typeof;
    return reference === Symbol.for("react.server.reference") ? null : `${path} is a function`;
  }
  if (typeof value !== "object") return `${path} is a ${typeof value}`;
  if (isValidElement(value)) return null; // Rendered on the server and checked by the walker.
  if (value instanceof Date) return null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const problem = notSerializable(item, `${path}[${index}]`);
      if (problem) return problem;
    }
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return `${path} is an instance of ${prototype?.constructor?.name ?? "a class"}`;
  }
  for (const [key, item] of Object.entries(value)) {
    const problem = notSerializable(item, `${path}.${key}`);
    if (problem) return problem;
  }
  return null;
}

type Walk = { problems: string[]; clients: Map<string, number> };

/** Every React element found inside a prop value (an icon, a slot…). */
function elementsIn(value: unknown): ReactNode[] {
  if (isValidElement(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(elementsIn);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).flatMap(elementsIn);
  }
  return [];
}

async function walk(node: unknown, state: Walk): Promise<void> {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") return;
  if (node instanceof Promise) return walk(await node, state);
  if (Array.isArray(node)) {
    for (const child of node) await walk(child, state);
    return;
  }
  if (!isValidElement(node)) return;

  const element = node as ReactElement<Record<string, unknown>>;
  const { type, props } = element;

  if (typeof type === "function" && CLIENT in type) {
    const name = (type as ClientStub)[CLIENT];
    state.clients.set(name, (state.clients.get(name) ?? 0) + 1);
    for (const [key, value] of Object.entries(props)) {
      const problem = notSerializable(value, `<${name}> ${key}`);
      if (problem) state.problems.push(problem);
    }
    for (const value of Object.values(props)) {
      for (const child of elementsIn(value)) await walk(child, state);
    }
    return;
  }

  if (typeof type === "function") {
    // A server component: run it like the server would.
    return walk(await (type as (props: unknown) => unknown)(props), state);
  }

  if (typeof type === "string") {
    for (const [key, value] of Object.entries(props)) {
      if (key !== "children" && typeof value === "function") {
        state.problems.push(`<${type}> ${key} is a function`);
      }
    }
  } else if (type !== Fragment && typeof type === "object") {
    // forwardRef / memo components (icons): rendered as they are.
    return;
  }
  return walk(props.children, state);
}

async function renderServer(node: ReactNode): Promise<Walk> {
  const state: Walk = { problems: [], clients: new Map() };
  await walk(node, state);
  return state;
}

// --- The pages ---------------------------------------------------------------------

type Page = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<ReactNode>;

const PAGES: Record<string, () => Promise<{ default: unknown }>> = {
  overview: () => import("@/app/(admin)/admin/(secure)/page"),
  growth: () => import("@/app/(admin)/admin/(secure)/rust/page"),
  activation: () => import("@/app/(admin)/admin/(secure)/aktivace/page"),
  retention: () => import("@/app/(admin)/admin/(secure)/retence/page"),
  features: () => import("@/app/(admin)/admin/(secure)/funkce/page"),
  ai: () => import("@/app/(admin)/admin/(secure)/ai/page"),
  game: () => import("@/app/(admin)/admin/(secure)/hra/page"),
  costs: () => import("@/app/(admin)/admin/(secure)/naklady/page"),
  health: () => import("@/app/(admin)/admin/(secure)/zdravi/page"),
  feedback: () => import("@/app/(admin)/admin/(secure)/zpetna-vazba/page"),
  users: () => import("@/app/(admin)/admin/(secure)/uzivatele/page"),
  explorer: () => import("@/app/(admin)/admin/(secure)/pruzkumnik/page"),
  audit: () => import("@/app/(admin)/admin/(secure)/audit/page"),
};

let errors: string[] = [];

// The pages pull in a large module graph; load it once, outside the per-test timeout.
beforeAll(async () => {
  await Promise.all(Object.values(PAGES).map((load) => load()));
  await import("@/app/(admin)/admin/(secure)/layout");
}, 60_000);

beforeEach(() => {
  missing.length = 0;
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => vi.restoreAllMocks());

async function renderPage(load: () => Promise<{ default: unknown }>, search: Record<string, string> = {}) {
  const Page = (await load()).default as Page;
  return renderServer(
    <Page params={Promise.resolve({})} searchParams={Promise.resolve(search)} />,
  );
}

describe.each(["cs", "en"] as const)("admin pages in %s", (language) => {
  beforeEach(() => {
    locale = language;
  });

  it.each(Object.keys(PAGES))("%s renders with plain props and every translation", async (key) => {
    const result = await renderPage(PAGES[key]);
    expect(result.problems).toEqual([]);
    expect(missing).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("features renders every section tab", async () => {
    const { FEATURE_SECTIONS } = await import("./server/page-data");
    for (const tab of FEATURE_SECTIONS) {
      const result = await renderPage(PAGES.features, { tab });
      expect(result.problems, tab).toEqual([]);
    }
    expect(missing).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("the layout passes plain props too", async () => {
    const { default: Layout } = await import("@/app/(admin)/admin/(secure)/layout");
    const result = await renderServer(<Layout>{null}</Layout>);
    expect(result.problems).toEqual([]);
    expect(missing).toEqual([]);
  });
});

describe("the boundary check", () => {
  it("catches a function passed to a client component", async () => {
    const { DataTable } = await import("@/features/admin/ui/data-blocks");
    const result = await renderServer(
      // @ts-expect-error The old shape, with render functions, is what must be caught.
      <DataTable id="x" rows={[{ a: 1 }]} columns={[{ key: "a", label: "A", render: () => "1" }]} />,
    );
    expect(result.problems).toEqual(["<DataTable> columns[0].render is a function"]);
  });

  it("sees the tables the pages render", async () => {
    locale = "cs";
    const result = await renderPage(PAGES.ai);
    expect(result.clients.get("DataTable")).toBeGreaterThan(0);
  });
});
