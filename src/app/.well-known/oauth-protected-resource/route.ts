import { protectedResourceMetadata, originOf } from "@/features/mcp/oauth";
import { json, preflight } from "@/features/mcp/server/http";

export const dynamic = "force-dynamic";

/** RFC 9728: the MCP endpoint and who issues its tokens (this app). */
export function GET(request: Request) {
  return json(protectedResourceMetadata(originOf(request)), 200, {
    "cache-control": "public, max-age=300",
  });
}

export const OPTIONS = preflight;
