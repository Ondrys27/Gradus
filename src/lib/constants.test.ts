import { describe, expect, it } from "vitest";
import { APP_NAME } from "./constants";

describe("constants", () => {
  it("exposes the app name", () => {
    expect(APP_NAME).toBe("Gradus");
  });
});
