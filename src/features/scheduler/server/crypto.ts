import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Secrets of integrations kept in the database (the secret ICS address of a
 * subscribed calendar) are sealed with AES-256-GCM under
 * INTEGRATIONS_ENCRYPTION_KEY: 32 bytes as base64 / base64url or 64 hex
 * characters. The token is `v1.<iv>.<tag>.<cipher>` in base64url, a fresh
 * 12-byte iv each time. The key never leaves the server; rotating it means
 * the stored secrets have to be entered again.
 */

export class IntegrationKeyError extends Error {
  constructor(readonly code: "missing" | "invalid") {
    super(code === "missing" ? "Integration key is not configured" : "Secret could not be opened");
    this.name = "IntegrationKeyError";
  }
}

const VERSION = "v1";

function readKey(): Buffer | null {
  const raw = (process.env.INTEGRATIONS_ENCRYPTION_KEY ?? "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(raw)) {
    const key = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return key.length === 32 ? key : null;
  }
  return null;
}

export function hasEncryptionKey(): boolean {
  return readKey() !== null;
}

function requireKey(): Buffer {
  const key = readKey();
  if (!key) throw new IntegrationKeyError("missing");
  return key;
}

export function encryptSecret(plain: string): string {
  const key = requireKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, sealed]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(token: string): string {
  const key = requireKey();
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new IntegrationKeyError("invalid");
  try {
    const [iv, tag, sealed] = parts.slice(1).map((part) => Buffer.from(part, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) throw new IntegrationKeyError("invalid");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(sealed), decipher.final()]).toString("utf8");
  } catch {
    throw new IntegrationKeyError("invalid");
  }
}
