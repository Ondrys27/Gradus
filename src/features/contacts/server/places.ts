import "server-only";
import {
  classifyGoogleError,
  toFoundPlaces,
  type FoundPlace,
  type GoogleFailure,
} from "../generation";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
/**
 * Only the fields the contact needs, so the request stays in the cheapest SKU
 * that has them. nextPageToken is not a place field; it only allows the next page.
 */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.formattedAddress",
  "nextPageToken",
].join(",");
const TIMEOUT_MS = 15_000;

export type SearchResult =
  | { ok: true; httpStatus: number; places: FoundPlace[]; nextPageToken: string | null }
  | { ok: false; failure: GoogleFailure };

/** Places API (New) Text Search. The key never leaves the server. */
export async function searchText(params: {
  apiKey: string;
  textQuery: string;
  languageCode: string;
  regionCode: string | null;
  pageSize: number;
  pageToken: string | null;
}): Promise<SearchResult> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": params.apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: params.textQuery,
        languageCode: params.languageCode,
        ...(params.regionCode ? { regionCode: params.regionCode.toLowerCase() } : {}),
        pageSize: params.pageSize,
        ...(params.pageToken ? { pageToken: params.pageToken } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: "network",
        httpStatus: 0,
        googleMessage: error instanceof Error ? error.message : String(error),
        reason: null,
        googleStatus: null,
      },
    };
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, failure: classifyGoogleError(response.status, body) };
  const data = (body ?? {}) as { places?: unknown; nextPageToken?: string };
  return {
    ok: true,
    httpStatus: response.status,
    places: toFoundPlaces(data.places),
    nextPageToken: data.nextPageToken || null,
  };
}
