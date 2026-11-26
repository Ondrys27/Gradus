import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_KIND_PATTERN, EMAIL_KINDS, RESEND_PLAN, RESEND_PLANS } from "./kinds";

describe("e-mail kinds", () => {
  it("fit what email_log.kind accepts and are unique", () => {
    for (const kind of EMAIL_KINDS) expect(kind).toMatch(EMAIL_KIND_PATTERN);
    expect(new Set(EMAIL_KINDS).size).toBe(EMAIL_KINDS.length);
  });

  it("each has its row in docs/emaily.md", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/emaily.md"), "utf8");
    for (const kind of EMAIL_KINDS) expect(doc, kind).toContain(`| \`${kind}\` |`);
  });

  it("knows the plan Gradus is on", () => {
    expect(RESEND_PLANS[RESEND_PLAN].monthly).toBeGreaterThan(0);
  });
});
