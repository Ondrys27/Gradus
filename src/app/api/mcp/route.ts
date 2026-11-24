import { handleMcpRequest } from "@/features/mcp/server/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The MCP server of Gradus (28.8): Streamable HTTP, stateless, OAuth bearer tokens. */
export function POST(request: Request) {
  return handleMcpRequest(request);
}

export function GET(request: Request) {
  return handleMcpRequest(request);
}

export function DELETE(request: Request) {
  return handleMcpRequest(request);
}
