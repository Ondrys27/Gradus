/**
 * Bytes of a Yjs state on the way: base64 in Realtime messages (JSON), hex in
 * Postgres bytea (what PostgREST sends and expects). Works in the browser and
 * on the server.
 */

const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** The bytea literal PostgREST takes: \x followed by hex. */
export function toByteaHex(bytes: Uint8Array): string {
  let out = "\\x";
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]];
  return out;
}

/** A bytea as PostgREST returns it (\x…), or null when it is not one. */
export function fromByteaHex(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith("\\x")) return null;
  const hex = value.slice(2);
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
