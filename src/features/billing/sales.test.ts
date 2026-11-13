import { describe, expect, it } from "vitest";
import { salesLiveForKey } from "./sales";

describe("salesLiveForKey", () => {
  it("is on only with a live publishable key", () => {
    expect(salesLiveForKey("pk_live_51Abc")).toBe(true);
    expect(salesLiveForKey(" pk_live_51Abc ")).toBe(true);
    expect(salesLiveForKey("pk_test_51Abc")).toBe(false);
    expect(salesLiveForKey("sk_live_51Abc")).toBe(false);
    expect(salesLiveForKey("")).toBe(false);
    expect(salesLiveForKey(undefined)).toBe(false);
    expect(salesLiveForKey("pk_live_")).toBe(false);
  });
});
