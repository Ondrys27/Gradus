import type { Page } from "@playwright/test";
import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;

/** A photo drawn by the browser: a 1600 × 1200 JPG, bigger than the 512 px that is stored. */
async function drawPhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1200;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgb(124, 92, 255)";
    context.fillRect(0, 0, 1600, 1200);
    context.fillStyle = "rgb(47, 227, 200)";
    context.fillRect(400, 300, 800, 600);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

/**
 * The settings page and the account menu show the photo (at least two
 * pictures), and every one has really loaded: complete, with pixels.
 */
async function avatarsLoaded(page: Page) {
  const states = await page.locator("img[data-avatar-image]").evaluateAll((images) =>
    images.map((image) => {
      const img = image as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    }),
  );
  return states.length >= 2 && states.every(Boolean);
}

test("72 · profile photo: shows after upload and reload, initials when it cannot load", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "photo" });
  await signIn(page, account);
  await openApp(page, "/app/nastaveni/ucet");

  await page.getByTestId("avatar-file").setInputFiles({
    name: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    buffer: await drawPhoto(page),
  });
  const crop = page.getByRole("dialog", { name: exact(L, "profile.avatar.cropTitle") });
  await crop.getByRole("button", { name: exact(L, "profile.avatar.save") }).click();
  await expect(crop).toBeHidden();

  // The settings page and the account menu: both pictures load (no broken image).
  await expect.poll(() => avatarsLoaded(page)).toBe(true);
  const stored = await admin().from("profiles").select("avatar_url").eq("id", account.id).single();
  expect(stored.data?.avatar_url).toMatch(/\/storage\/v1\/object\/public\/avatars\/.+\/avatar\?v=\d+$/);
  // Served as the file itself, not through the metered image optimiser.
  const src = await page.locator("img[data-avatar-image]").first().getAttribute("src");
  expect(src).not.toContain("/_next/image");

  await page.reload();
  await expect.poll(() => avatarsLoaded(page)).toBe(true);

  // A picture that does not load (here: an answer that is no image) shows
  // the initials, never a question mark.
  const missing = "https://example.invalid/avatar.jpg";
  await page.route(missing, (route) =>
    route.fulfill({ status: 200, contentType: "image/jpeg", body: "not an image" }),
  );
  await admin().from("profiles").update({ avatar_url: missing }).eq("id", account.id);
  await page.reload();
  const menu = page.locator('[data-tour="account"]').first();
  await expect(menu.locator("img")).toHaveCount(0);
  await expect(menu).toContainText(/^[A-Z0-9ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]{1,2}$/);

  await admin().storage.from("avatars").remove([`${account.id}/avatar`]);
});
