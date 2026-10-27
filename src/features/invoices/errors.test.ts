import { describe, expect, it } from "vitest";
import { errorCodeOf, InvoiceError, toFailure, unwrap } from "./errors";

describe("invoice errors", () => {
  it("names the database's errors", () => {
    expect(toFailure({ message: "deal_not_found" }).error).toBe("dealNotFound");
    expect(toFailure({ message: "deal_value_required" }).error).toBe("dealValueRequired");
    expect(toFailure({ message: "invoice_not_found" }).error).toBe("invoiceNotFound");
    expect(toFailure({ message: "section_access_denied" }).error).toBe("forbidden");
    expect(toFailure({ message: "read_only" }).error).toBe("readOnly");
    expect(toFailure({ message: "invoice_profile_required" }).error).toBe("profileRequired");
    expect(toFailure({ message: "invoice_issued" }).error).toBe("alreadyIssued");
    expect(toFailure({ message: "invoice_not_cancellable" }).error).toBe("notCancellable");
    expect(toFailure({ message: "invoice_due_before_issue" }).error).toBe("dueBeforeIssue");
    expect(toFailure(new Error("boom")).error).toBe("unknown");
    expect(toFailure(new InvoiceError("forbidden")).error).toBe("forbidden");
  });

  it("unwraps a result and keeps the code of a failure", () => {
    expect(unwrap({ ok: true, data: 1 })).toBe(1);
    let thrown: unknown;
    try {
      unwrap({ ok: false, error: "readOnly" });
    } catch (error) {
      thrown = error;
    }
    expect(errorCodeOf(thrown)).toBe("readOnly");
    expect(errorCodeOf(new Error("x"))).toBe("unknown");
  });
});
