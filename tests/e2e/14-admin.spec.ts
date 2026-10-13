import { signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";

test("14 · /admin answers 404 to an ordinary signed-in user", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "notadmin" });
  await signIn(page, account);

  // Through the signed-in browser session, without rendering the error page.
  for (const path of ["/admin", "/admin/uzivatele", "/admin/prihlaseni"]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
  }
});
