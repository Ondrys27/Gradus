import { describe, expect, it } from "vitest";
import { humanizeKey } from "./error-handling";

describe("humanizeKey", () => {
  it("turns the last key segment into a readable fallback", () => {
    expect(humanizeKey("pipeline.stage.depositPaid")).toBe("Deposit paid");
    expect(humanizeKey("milestones.tasks.status.in_progress")).toBe("In progress");
    expect(humanizeKey("delete")).toBe("Delete");
  });
});
