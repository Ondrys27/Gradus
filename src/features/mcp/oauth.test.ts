import { describe, expect, it } from "vitest";
import { levelFromScope, scopesOf, scopeString } from "./levels";
import {
  authorizationServerMetadata,
  authorizeSchema,
  bearerOf,
  canonicalResource,
  isMetadataClientId,
  originOf,
  pkceChallenge,
  protectedResourceMetadata,
  redirectAllowed,
  redirectWith,
  registrationSchema,
  resourceMatches,
  validRedirectUri,
  verifyPkce,
  wwwAuthenticate,
} from "./oauth";

const ORIGIN = "https://app.gradus.cz";

describe("discovery", () => {
  it("names the MCP endpoint and this app as its authorization server", () => {
    expect(protectedResourceMetadata(ORIGIN)).toMatchObject({
      resource: "https://app.gradus.cz/api/mcp",
      authorization_servers: [ORIGIN],
      scopes_supported: ["gradus.read", "gradus.write", "gradus.delete"],
    });
    const server = authorizationServerMetadata(ORIGIN);
    expect(server.issuer).toBe(ORIGIN);
    expect(server.code_challenge_methods_supported).toEqual(["S256"]);
    expect(server.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(server.client_id_metadata_document_supported).toBe(true);
    expect(server.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
    expect(server.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
  });

  it("challenges with the resource metadata and the scopes", () => {
    expect(wwwAuthenticate(ORIGIN)).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="gradus.read gradus.write gradus.delete"`,
    );
    expect(wwwAuthenticate(ORIGIN, { code: "invalid_token" })).toMatch(
      /^Bearer error="invalid_token", /,
    );
  });

  it("checks the resource indicator", () => {
    expect(canonicalResource(`${ORIGIN}/`)).toBe(`${ORIGIN}/api/mcp`);
    expect(resourceMatches(undefined, ORIGIN)).toBe(true);
    expect(resourceMatches(`${ORIGIN}/api/mcp/`, ORIGIN)).toBe(true);
    expect(resourceMatches("https://evil.example/api/mcp", ORIGIN)).toBe(false);
  });

  it("reads the public origin behind a proxy", () => {
    const request = new Request("http://internal:3000/api/mcp", {
      headers: { "x-forwarded-host": "app.gradus.cz", "x-forwarded-proto": "https" },
    });
    expect(originOf(request)).toBe(ORIGIN);
    expect(originOf(new Request("http://localhost:3000/x"))).toBe("http://localhost:3000");
  });
});

describe("clients and redirects", () => {
  it("accepts https and loopback redirects only", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("http://localhost:6274/callback")).toBe(true);
    expect(validRedirectUri("http://example.com/callback")).toBe(false);
    expect(validRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
  });

  it("matches the registered redirect exactly, the loopback on any port", () => {
    const registered = [
      "https://claude.ai/api/mcp/auth_callback",
      "http://127.0.0.1:3000/callback",
    ];
    expect(redirectAllowed(registered, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectAllowed(registered, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(redirectAllowed(registered, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectAllowed(registered, "http://127.0.0.1:51234/other")).toBe(false);
    expect(redirectAllowed(registered, "https://claude.ai.evil.com/api/mcp/auth_callback")).toBe(
      false,
    );
  });

  it("registers public clients with the code flow only", () => {
    expect(
      registrationSchema.safeParse({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        client_name: "Claude",
      }).success,
    ).toBe(true);
    expect(registrationSchema.safeParse({ redirect_uris: [] }).success).toBe(false);
    expect(
      registrationSchema.safeParse({
        redirect_uris: ["https://a.b/c"],
        token_endpoint_auth_method: "client_secret_basic",
      }).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({
        redirect_uris: ["https://a.b/c"],
        grant_types: ["refresh_token"],
      }).success,
    ).toBe(false);
    expect(isMetadataClientId("https://claude.ai/oauth/mcp-oauth-client-metadata")).toBe(true);
    expect(isMetadataClientId("gmcp_abc")).toBe(false);
  });

  it("puts the code or the error, the state and the issuer on the redirect", () => {
    const url = new URL(
      redirectWith("https://claude.ai/cb?a=1", {
        code: "c",
        state: "s",
        iss: ORIGIN,
        error: undefined,
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      a: "1",
      code: "c",
      state: "s",
      iss: ORIGIN,
    });
  });
});

describe("PKCE and the request", () => {
  it("verifies S256 (RFC 7636 example)", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce("short", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(verifyPkce(undefined, "x")).toBe(false);
  });

  it("requires the code flow with S256", () => {
    const base = {
      response_type: "code",
      client_id: "gmcp_x",
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    };
    expect(authorizeSchema.safeParse(base).success).toBe(true);
    expect(authorizeSchema.safeParse({ ...base, code_challenge_method: "plain" }).success).toBe(
      false,
    );
    expect(authorizeSchema.safeParse({ ...base, response_type: "token" }).success).toBe(false);
  });

  it("reads a bearer token", () => {
    expect(bearerOf("Bearer gat_abcdefghijklmnopqrstuvwxyz")).toBe(
      "gat_abcdefghijklmnopqrstuvwxyz",
    );
    expect(bearerOf("Basic abc")).toBeNull();
    expect(bearerOf(null)).toBeNull();
  });
});

describe("levels and scopes", () => {
  it("each level grants its scope and those below", () => {
    expect(scopesOf("read")).toEqual(["gradus.read"]);
    expect(scopeString("full")).toBe("gradus.read gradus.write gradus.delete");
    expect(levelFromScope("gradus.read")).toBe("read");
    expect(levelFromScope("gradus.read gradus.delete")).toBe("full");
    expect(levelFromScope(undefined)).toBe("write");
  });
});
