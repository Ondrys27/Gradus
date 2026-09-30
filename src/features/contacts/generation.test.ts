import { describe, expect, it } from "vitest";
import { classifyGoogleError, maxRequestable, toFoundPlaces } from "./generation";

function googleError(code: number, status: string, message: string, reason?: string) {
  return {
    error: {
      code,
      status,
      message,
      details: reason ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] : [],
    },
  };
}

describe("classifyGoogleError", () => {
  it("names the cause from Google's reason", () => {
    expect(
      classifyGoogleError(
        403,
        googleError(
          403,
          "PERMISSION_DENIED",
          "Places API (New) has not been used in project 123 before or it is disabled.",
          "SERVICE_DISABLED",
        ),
      ).code,
    ).toBe("apiDisabled");
    expect(
      classifyGoogleError(
        403,
        googleError(
          403,
          "PERMISSION_DENIED",
          "This API method requires billing to be enabled.",
          "BILLING_DISABLED",
        ),
      ).code,
    ).toBe("billing");
    expect(
      classifyGoogleError(
        403,
        googleError(
          403,
          "PERMISSION_DENIED",
          "Requests from referer <empty> are blocked.",
          "API_KEY_HTTP_REFERRER_BLOCKED",
        ),
      ).code,
    ).toBe("keyRestricted");
    expect(
      classifyGoogleError(
        400,
        googleError(
          400,
          "INVALID_ARGUMENT",
          "API key not valid. Please pass a valid API key.",
          "API_KEY_INVALID",
        ),
      ).code,
    ).toBe("keyInvalid");
    expect(
      classifyGoogleError(429, googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded.")).code,
    ).toBe("quota");
  });

  it("falls back on the HTTP status and keeps Google's message", () => {
    const failure = classifyGoogleError(503, googleError(503, "UNAVAILABLE", "Try later."));
    expect(failure).toEqual({
      code: "googleUnavailable",
      httpStatus: 503,
      googleMessage: "Try later.",
      reason: null,
      googleStatus: "UNAVAILABLE",
    });
    expect(classifyGoogleError(400, googleError(400, "INVALID_ARGUMENT", "Bad field")).code).toBe(
      "badRequest",
    );
    expect(classifyGoogleError(418, "not json").code).toBe("unknown");
  });
});

describe("maxRequestable", () => {
  it("is the smaller of what is left today and this month, capped by Google", () => {
    expect(
      maxRequestable({ daily: { used: 480, limit: 500 }, monthly: { used: 10, limit: 5000 } }),
    ).toBe(20);
    expect(
      maxRequestable({ daily: { used: 0, limit: 500 }, monthly: { used: 4990, limit: 5000 } }),
    ).toBe(10);
    expect(
      maxRequestable({ daily: { used: 0, limit: 500 }, monthly: { used: 0, limit: 5000 } }),
    ).toBe(60);
    expect(
      maxRequestable({ daily: { used: 600, limit: 500 }, monthly: { used: 0, limit: 5000 } }),
    ).toBe(0);
  });
});

describe("toFoundPlaces", () => {
  it("keeps places with an id and a name", () => {
    expect(
      toFoundPlaces([
        {
          id: "a",
          displayName: { text: " Bakery ", languageCode: "cs" },
          internationalPhoneNumber: "+420 602 000 111",
          websiteUri: "https://bakery.cz",
          formattedAddress: "Pekařská 1, Praha",
        },
        { id: "b" },
        { displayName: { text: "No id" } },
      ]),
    ).toEqual([
      {
        id: "a",
        name: "Bakery",
        phone: "+420602000111",
        website: "https://bakery.cz",
        address: "Pekařská 1, Praha",
      },
    ]);
    expect(toFoundPlaces(undefined)).toEqual([]);
  });
});
