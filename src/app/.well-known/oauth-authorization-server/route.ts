import { authorizationServerMetadata, originOf } from "@/features/mcp/oauth";
import { json, preflight } from "@/features/mcp/server/http";

export const dynamic = "force-dynamic";

/** RFC 8414: the endpoints of the app's authorization server for MCP clients. */
export function GET(request: Request) {
  return json(authorizationServerMetadata(originOf(request)), 200, {
    "cache-control": "public, max-age=300",
  });
}

export const OPTIONS = preflight;
