/**
 * The assistant was called Jarvis until 26.1. Tabs opened before the rename
 * and old cron settings still call /api/jarvis, so it answers exactly like
 * /api/grady. Segment config has to be written out here (Next.js reads it
 * statically); the handlers are the same functions.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export { GET, POST } from "../grady/route";
