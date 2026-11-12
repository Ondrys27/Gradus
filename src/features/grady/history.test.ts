import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { EARLIER_FILE_CHARS, toModelMessages } from "./history";

describe("toModelMessages", () => {
  it("starts with the user, dropping an answer cut from its question", () => {
    expect(
      toModelMessages([
        { role: "assistant", content: "old answer" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "plan my day" },
      ]),
    ).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "plan my day" },
    ]);
  });

  it("keeps an unanswered turn next to the following one", () => {
    expect(
      toModelMessages([
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ]),
    ).toHaveLength(2);
  });

  it("is empty without a user message", () => {
    expect(toModelMessages([{ role: "assistant", content: "x" }])).toEqual([]);
  });

  it("sends files with their message, in full only on the latest one", () => {
    const long = "x".repeat(EARLIER_FILE_CHARS + 50);
    const messages = toModelMessages([
      {
        role: "user",
        content: "read this",
        attachments: [
          { name: 'offer "v2".pdf', kind: "pdf", text: long },
          { name: "photo.png", kind: "png", text: null },
        ],
      },
      { role: "assistant", content: "done" },
      {
        role: "user",
        content: "",
        attachments: [
          { name: "list.csv", kind: "csv", text: "a,b", truncated: true },
          {
            name: "shot.jpg",
            kind: "jpeg",
            text: null,
            image: { mediaType: "image/jpeg", data: "AAAA" },
          },
        ],
      },
    ]);

    const first = messages[0].content as Anthropic.ContentBlockParam[];
    expect(first).toHaveLength(3);
    const doc = first[0] as Anthropic.TextBlockParam;
    expect(doc.text).toContain('name="offer &#34;v2&#34;.pdf" type="pdf"');
    expect(doc.text).toContain("Only the beginning is repeated here");
    expect(doc.text.length).toBeLessThan(EARLIER_FILE_CHARS + 300);
    expect((first[1] as Anthropic.TextBlockParam).text).toContain("no longer visible");
    expect(first[2]).toEqual({ type: "text", text: "read this" });

    const last = messages[2].content as Anthropic.ContentBlockParam[];
    expect((last[0] as Anthropic.TextBlockParam).text).toContain(
      "only its beginning could be read",
    );
    expect(last[2]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    });
    // No empty text block for a message that is only files.
    expect(last).toHaveLength(3);
  });
});
