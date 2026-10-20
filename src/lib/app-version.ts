/**
 * The deployed version: the short git commit Vercel built (next.config.ts
 * puts it into NEXT_PUBLIC_APP_VERSION at build time), `dev` locally. Bug
 * reports carry it, so a report says which deployment the error came from.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
