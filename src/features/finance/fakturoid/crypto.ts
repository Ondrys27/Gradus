import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { InvoiceError } from "./errors";

/**
 * AES-256-GCM for integration secrets stored in the database. The key lives in
 * INTEGRATIONS_ENCRYPTION_KEY (32 bytes, base64) and the row's user id is bound
 * in as associated data, so a ciphertext copied to another user's row does not
 * decrypt.
 */

const VERSION = "v1";

export function encryptionKey(raw = process.env.INTEGRATIONS_ENCRYPTION_KEY): Buffer {
  const key = raw ? Buffer.from(raw.trim(), "base64") : null;
  if (!key || key.length !== 32) throw new InvoiceError("encryptionKeyMissing");
  return key;
}

export function encryptSecret(plain: string, userId: string, key: Buffer = encryptionKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(
    ":",
  );
}

export function decryptSecret(stored: string, userId: string, key: Buffer = encryptionKey()) {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("unknown_secret_format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
