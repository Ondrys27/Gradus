import "server-only";
import { cookies, headers } from "next/headers";
import {
  ADMIN_BACKUP_OFFER_COOKIE,
  ADMIN_BACKUP_OFFER_SECONDS,
  ADMIN_PATH,
  backupOfferValue,
  isBackupOfferOpen,
} from "../access";

/**
 * The backup offer right after the first authenticator (see access.ts). The
 * code step's new session cookies make Next.js render the sign-in page again
 * in the same answer, and a live admin session would send it on to /admin
 * before the offer could be seen. This short-lived, account-bound cookie is
 * the explicit signal that the person is in the middle of that one decision.
 */

/** In a server action, the moment the first authenticator is verified. */
export async function openBackupOffer(userId: string): Promise<void> {
  (await cookies()).set(ADMIN_BACKUP_OFFER_COOKIE, backupOfferValue(userId), {
    path: ADMIN_PATH,
    maxAge: ADMIN_BACKUP_OFFER_SECONDS,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

/** In a server action: the decision is made, or this is an ordinary sign-in. */
export async function closeBackupOffer(): Promise<void> {
  const store = await cookies();
  if (store.has(ADMIN_BACKUP_OFFER_COOKIE)) {
    store.delete({ name: ADMIN_BACKUP_OFFER_COOKIE, path: ADMIN_PATH });
  }
}

/**
 * Whether the sign-in page should hold its redirect: only while rendering the
 * answer of a server action (never a page load), for the account whose offer
 * it is, within its few minutes.
 */
export async function isBackupOfferPending(userId: string): Promise<boolean> {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  if (!requestHeaders.has("next-action")) return false;
  return isBackupOfferOpen(store.get(ADMIN_BACKUP_OFFER_COOKIE)?.value, userId);
}
