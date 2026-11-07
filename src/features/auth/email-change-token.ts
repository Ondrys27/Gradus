import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The link of an e-mail change the administration started (support, step
 * 22.1): the new address confirms it, then the account's e-mail changes.
 * Nothing is stored: the link carries who, from which address, to which, who
 * asked and until when, signed with a key derived from the secret key. It
 * works only while the account still has the old address, so once used (or
 * after any other change of the e-mail) it is spent.
 */

export const EMAIL_CHANGE_TTL_SECONDS = 24 * 60 * 60;

const payloadSchema = z.object({
  /** The account. */
  u: z.uuid(),
  /** Its e-mail when the change was asked for. */
  o: z.string().min(3).max(320),
  /** The new e-mail. */
  n: z.email().max(320),
  /** Who asked, from the administration. */
  a: z.uuid(),
  /** Until when, Unix seconds. */
  e: z.number().int().positive(),
});

export type EmailChangeClaim = {
  userId: string;
  oldEmail: string;
  newEmail: string;
  requestedBy: string;
  expiresAt: number;
};

function sign(body: string, secret: string): string {
  const key = createHmac("sha256", secret).update("gradus:email-change:v1").digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function createEmailChangeToken(
  claim: Omit<EmailChangeClaim, "expiresAt">,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const body = Buffer.from(
    JSON.stringify({
      u: claim.userId,
      o: claim.oldEmail.trim().toLowerCase(),
      n: claim.newEmail.trim().toLowerCase(),
      a: claim.requestedBy,
      e: nowSeconds + EMAIL_CHANGE_TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** The claim of a genuine, unexpired link; null for anything else. */
export function readEmailChangeToken(
  token: string | null | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): EmailChangeClaim | null {
  if (!token || token.length > 2000) return null;
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: z.infer<typeof payloadSchema>;
  try {
    const result = payloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }
  if (parsed.e <= nowSeconds) return null;
  return {
    userId: parsed.u,
    oldEmail: parsed.o,
    newEmail: parsed.n,
    requestedBy: parsed.a,
    expiresAt: parsed.e,
  };
}

/** Whether the account still has the address the link was made for (case aside). */
export function emailChangeStillApplies(claim: EmailChangeClaim, currentEmail: string | null | undefined) {
  return (currentEmail ?? "").trim().toLowerCase() === claim.oldEmail;
}
