/**
 * The Supabase Auth e-mails (confirm sign-up, reset password, change e-mail)
 * in docs/email-templates: `bun scripts/email-templates.ts`. Run it after a
 * change of the texts (`email.auth` in the translations) or of
 * src/features/email/auth-templates.ts; a test fails until the files match.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { authTemplateFiles } from "../src/features/email/auth-templates";

const OUT = path.resolve(__dirname, "../docs/email-templates");
mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(authTemplateFiles())) {
  writeFileSync(path.join(OUT, name), content);
  console.log(`docs/email-templates/${name}`);
}
