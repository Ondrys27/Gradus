import { describe, expect, it, vi } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

describe("feature sections", () => {
  it("has a label for every tab in admin.users.sections, in both languages", async () => {
    const { FEATURE_SECTIONS } = await import("./page-data");
    for (const messages of [cs, en]) {
      const labels = messages.admin.users.sections as Record<string, string>;
      for (const section of FEATURE_SECTIONS) expect(labels[section], section).toBeTruthy();
    }
  });
});
