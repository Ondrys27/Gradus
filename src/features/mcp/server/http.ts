import "server-only";

/**
 * Answers of the OAuth endpoints: JSON, never cached, readable from any
 * origin (no cookies are involved; the tokens are the credentials).
 */
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "86400",
} as const;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      pragma: "no-cache",
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** The fields of a form (application/x-www-form-urlencoded) or a JSON body. */
export async function formOf(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      for (const [key, value] of Object.entries(body ?? {})) {
        if (typeof value === "string") out[key] = value;
      }
      return out;
    }
    const text = await request.text();
    for (const [key, value] of new URLSearchParams(text)) if (!(key in out)) out[key] = value;
  } catch {
    // An unreadable body is an empty one: the endpoint says what is missing.
  }
  return out;
}
