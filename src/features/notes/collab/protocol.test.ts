// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fromBase64, fromByteaHex, toBase64, toByteaHex } from "./encoding";
import { parseEnvelope, toWire, WireAssembler, type Envelope } from "./protocol";

const big: Envelope = { from: "u1", sid: "s1", m: { t: "update", gen: "s0", d: "x".repeat(1_000), q: 3 } };

describe("live channel messages", () => {
  it("sends a small message as it is and a big one in parts that come back whole, in any order", () => {
    expect(toWire(big, 5_000)).toEqual([big]);
    const parts = toWire(big, 300, "p1");
    expect(parts.length).toBeGreaterThan(3);
    const assembler = new WireAssembler();
    const shuffled = [...parts].reverse();
    const out = shuffled.map((part) => assembler.take(part));
    expect(out.slice(0, -1).every((value) => value === null)).toBe(true);
    expect(out.at(-1)).toEqual(big);
  });

  it("drops parts that never complete and anything that is not a message", () => {
    let now = 0;
    const assembler = new WireAssembler(() => now, 1_000);
    const [first] = toWire(big, 300, "p2");
    expect(assembler.take(first)).toBeNull();
    now = 5_000;
    expect(assembler.take({ hello: true })).toBeNull();
    expect(parseEnvelope({ from: "u", sid: "s", m: { t: "update", gen: "s0" } })).toBeNull();
    expect(parseEnvelope({ from: "u", sid: "s", m: { t: "drop table" } })).toBeNull();
  });

  it("keeps bytes intact through base64 and the bytea literal", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    const hex = toByteaHex(new Uint8Array([0, 15, 255]));
    expect(hex).toBe("\\x000fff");
    expect(fromByteaHex(hex)).toEqual(new Uint8Array([0, 15, 255]));
    expect(fromByteaHex("nope")).toBeNull();
    expect(fromByteaHex(null)).toBeNull();
  });
});
