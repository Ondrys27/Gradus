import { writeFileSync } from "node:fs";
import { test as base, expect, type BrowserContext } from "@playwright/test";
import {
  createAccount,
  deleteAccount,
  deleteAccountByEmail,
  type Account,
  type AccountOptions,
} from "./accounts";

type Accounts = {
  /** A ready test account, removed again after the test. */
  create: (options: AccountOptions) => Promise<Account>;
  /** An address the test registers through the UI; the account is removed after the test. */
  register: (email: string) => void;
};

/** Collects every console error and uncaught page error of a browser context. */
export function watchConsole(context: BrowserContext, errors: string[]) {
  context.on("console", (message) => {
    if (message.type() !== "error") return;
    const where = message.location();
    const onPage = message.page()?.url() ?? "?";
    errors.push(
      `[on ${onPage}] ${message.text()}${where.url ? ` (${where.url}:${where.lineNumber})` : ""}`,
    );
  });
  context.on("weberror", (error) => errors.push(`Uncaught: ${error.error().message}`));
  // The console only says "500"; keep what the server answered, to find the cause.
  context.on("response", async (response) => {
    if (response.status() < 500) return;
    const request = response.request();
    const action = (await request.allHeaders())["next-action"];
    const body = await response.text().catch(() => "");
    if (process.env.E2E_DUMP_DIR) {
      writeFileSync(`${process.env.E2E_DUMP_DIR}/5xx-${Date.now()}.html`, body);
    }
    errors.push(
      `[server ${response.status()}] ${request.method()} ${response.url()}${action ? ` action=${action}` : ""} ${body.slice(0, 600)}`,
    );
  });
}

/**
 * Every test:
 *  - fails on any error in the browser console or an uncaught page error
 *    (a second browser context joins in through watchConsole),
 *  - removes every account it made, even when it fails.
 */
export const test = base.extend<{ consoleErrors: string[]; accounts: Accounts }>({
  consoleErrors: [
    async ({ context }, provide, testInfo) => {
      const errors: string[] = [];
      watchConsole(context, errors);
      await provide(errors);
      if (errors.length > 0) {
        await testInfo.attach("console-errors", { body: errors.join("\n\n") });
      }
      expect(errors, "errors in the browser console").toEqual([]);
    },
    { auto: true },
  ],
  accounts: async ({}, provide) => {
    const ids: string[] = [];
    const emails: string[] = [];
    await provide({
      create: async (options) => {
        const account = await createAccount(options);
        ids.push(account.id);
        return account;
      },
      register: (email) => {
        emails.push(email);
      },
    });
    for (const email of emails) await deleteAccountByEmail(email);
    for (const id of ids) await deleteAccount(id);
  },
});

export { expect };
