import { z } from "zod";

/**
 * The account slug is the part after app.fakturoid.cz/ in the address bar. A
 * pasted address is accepted and trimmed down to it.
 */
export function normalizeSlug(input: string): string {
  const value = input.trim();
  const fromUrl = /fakturoid\.cz\/(?:api\/v\d\/accounts\/)?([^/?#\s]+)/i.exec(value);
  return (fromUrl?.[1] ?? value).replace(/^\/+|\/+$/g, "").toLowerCase();
}

export const fakturoidConnectSchema = z.object({
  clientId: z.string().trim().min(1, "required").max(200, "tooLong"),
  clientSecret: z.string().trim().min(1, "required").max(200, "tooLong"),
  slug: z
    .string()
    .transform(normalizeSlug)
    .pipe(
      z
        .string()
        .min(1, "required")
        .max(100, "tooLong")
        .regex(/^[a-z0-9][a-z0-9_-]*$/, "invalidSlug"),
    ),
});
export type FakturoidConnectInput = z.input<typeof fakturoidConnectSchema>;

/** What the settings screen may know about the connection; never the secret. */
export type FakturoidStatus =
  | { connected: false }
  | {
      connected: true;
      slug: string;
      connectedAt: string;
      lastSyncedAt: string | null;
      lastSyncError: string | null;
      moveDealOnPaid: boolean;
    };

/** Link to an invoice in Fakturoid's own web app. */
export function fakturoidInvoiceUrl(slug: string, fakturoidId: number): string {
  return `https://app.fakturoid.cz/${encodeURIComponent(slug)}/invoices/${fakturoidId}`;
}
