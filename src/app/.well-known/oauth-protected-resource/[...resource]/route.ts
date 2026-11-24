import { MCP_PATH, protectedResourceMetadata, originOf } from "@/features/mcp/oauth";
import { json, preflight } from "@/features/mcp/server/http";

export const dynamic = "force-dynamic";

/** RFC 9728 with the resource's path (/.well-known/oauth-protected-resource/api/mcp), tried first by clients. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string[] }> },
) {
  const { resource } = await params;
  if (`/${resource.join("/")}` !== MCP_PATH) return json({ error: "not_found" }, 404);
  return json(protectedResourceMetadata(originOf(request)), 200, {
    "cache-control": "public, max-age=300",
  });
}

export const OPTIONS = preflight;
