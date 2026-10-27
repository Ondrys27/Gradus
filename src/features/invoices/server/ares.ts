import "server-only";
import { ARES_URL, parseAresSubject, type AresCompany } from "../ares";
import { InvoiceError } from "../errors";
import { isValidIco, normalizeIco } from "../ico";

/** ARES answers in well under a second; past this the form just stays as it is. */
const TIMEOUT_MS = 5000;

/**
 * Looks a Czech company ID up in ARES. Public API, no key, called only from
 * the server; a slow or failed ARES never breaks the form, it only says so.
 */
export async function lookupAres(value: string): Promise<AresCompany> {
  const ico = normalizeIco(value);
  if (!ico || !isValidIco(ico)) throw new InvoiceError("aresInvalid");
  let response: Response;
  try {
    response = await fetch(`${ARES_URL}/${ico}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new InvoiceError("aresUnavailable");
  }
  if (response.status === 404 || response.status === 400) throw new InvoiceError("aresNotFound");
  if (!response.ok) throw new InvoiceError("aresUnavailable");
  const company = parseAresSubject(await response.json().catch(() => null));
  if (!company) throw new InvoiceError("aresNotFound");
  return company;
}
