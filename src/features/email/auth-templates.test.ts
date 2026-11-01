// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_TEMPLATE_FILES,
  AUTH_TEMPLATE_KINDS,
  authTemplateFiles,
  authTemplateHtml,
  authTemplateSupabaseSubject,
} from "./auth-templates";

const DIR = path.resolve(__dirname, "../../../docs/email-templates");

describe("Supabase auth e-mail templates", () => {
  it("docs/email-templates match the code (run bun scripts/email-templates.ts)", () => {
    for (const [name, content] of Object.entries(authTemplateFiles())) {
      expect(readFileSync(path.join(DIR, name), "utf8"), name).toBe(content);
    }
  });

  it.each([
    ["confirmSignup", "cs", "type=email&amp;next=/app"],
    ["confirmSignup", "en", "type=email&amp;next=/app"],
    ["resetPassword", "cs", "type=recovery&amp;next=/nove-heslo"],
    ["resetPassword", "en", "type=recovery&amp;next=/en/reset-password"],
    ["changeEmail", "cs", "type=email_change&amp;next=/app"],
  ] as const)("%s (%s) links to /auth/confirm with the token hash", (kind, locale, tail) => {
    const html = authTemplateHtml(kind, locale);
    expect(html).toContain(
      `href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;${tail}"`,
    );
    expect(html).toContain(`<html lang="${locale}">`);
    // Supabase's default PKCE link only works in the browser that asked.
    expect(html).not.toContain("ConfirmationURL");
  });

  it("names both addresses in the e-mail change", () => {
    expect(authTemplateHtml("changeEmail", "cs")).toMatch(
      /\{\{ \.Email \}\}.*\{\{ \.NewEmail \}\}/,
    );
  });

  it("switches language on the account's metadata and falls back to Czech", () => {
    for (const kind of AUTH_TEMPLATE_KINDS) {
      const file = authTemplateFiles()[`${AUTH_TEMPLATE_FILES[kind].file}.html`];
      expect(file.startsWith('{{ $en := false }}{{ with .Data.locale }}{{ if eq . "en" }}')).toBe(
        true,
      );
      expect(file).toContain('<html lang="en">');
      expect(file).toContain('<html lang="cs">');
      expect(authTemplateSupabaseSubject(kind)).toMatch(
        /\{\{ if \$en \}\}.+\{\{ else \}\}.+\{\{ end \}\}$/,
      );
    }
  });

  it("is described in docs/supabase-email.md", () => {
    const doc = readFileSync(path.resolve(DIR, "../supabase-email.md"), "utf8");
    for (const kind of AUTH_TEMPLATE_KINDS) {
      expect(doc).toContain(`email-templates/${AUTH_TEMPLATE_FILES[kind].file}.html`);
      expect(doc).toContain(AUTH_TEMPLATE_FILES[kind].supabase);
    }
  });
});
