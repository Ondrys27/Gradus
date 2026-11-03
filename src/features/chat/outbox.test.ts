import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { chatCsv, chatCsvFileName } from "./export";
import { afterFailure, dueItems, isPermanentFailure, restoreItems, retryDelay, type OutboxItem } from "./outbox";

const item: OutboxItem = {
  id: "m1",
  space: "s",
  channelId: "c",
  to: null,
  body: "Ahoj",
  replyTo: null,
  files: [],
  createdAt: "2026-11-03T10:00:00Z",
  attempts: 0,
  nextAt: 0,
  failed: false,
};

describe("the outbox", () => {
  it("waits longer after every failed attempt, up to a minute", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([2_000, 5_000, 15_000, 30_000, 60_000, 60_000]);
  });

  it("keeps trying through outages and server errors, stops at a refusal", () => {
    expect(isPermanentFailure(null)).toBe(false);
    expect(isPermanentFailure(500)).toBe(false);
    expect(isPermanentFailure(429)).toBe(false);
    expect(isPermanentFailure(403)).toBe(true);
    const offline = afterFailure(item, null, "network", 1_000);
    expect(offline).toMatchObject({ attempts: 1, nextAt: 3_000, failed: false });
    expect(afterFailure(offline, 503, undefined, 5_000)).toMatchObject({ attempts: 2, nextAt: 10_000 });
    expect(afterFailure(item, 400, "fileType", 1_000)).toMatchObject({ failed: true, error: "fileType" });
  });

  it("sends what is due and not refused", () => {
    const items = [item, { ...item, id: "m2", nextAt: 5_000 }, { ...item, id: "m3", failed: true }];
    expect(dueItems(items, 1_000).map((entry) => entry.id)).toEqual(["m1"]);
    expect(dueItems(items, 6_000).map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("restores after a reload; a message whose file never went up waits as not sent", () => {
    const withFile = {
      ...item,
      id: "m2",
      nextAt: 99_999,
      files: [{ id: "f", name: "a.png", mime: "image/png", size: 1, uploaded: false }],
    };
    const uploaded = { ...withFile, id: "m3", files: [{ ...withFile.files[0]!, uploaded: true }] };
    const restored = restoreItems([item, withFile, uploaded, { nonsense: true }, null]);
    expect(restored.map((entry) => [entry.id, entry.failed, entry.nextAt])).toEqual([
      ["m1", false, 0],
      ["m2", true, 0],
      ["m3", false, 0],
    ]);
    expect(restoreItems("broken")).toEqual([]);
  });
});

describe("the CSV of a conversation", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const labels = {
    time: "Čas",
    sender: "Odesílatel",
    text: "Zpráva",
    files: "Přílohy",
    edited: "Upraveno",
    deleted: "Smazáno",
    yes: "ano",
    formerMember: "Bývalý člen",
  };

  it("has one row per message with names, mentions as @Name and files by name", () => {
    const csv = chatCsv(
      [
        {
          sender: A,
          body: `Ahoj <@${A}>, "viz" příloha`,
          attachments: [{ path: "p", name: "smlouva.pdf", size: 1, mime: "application/pdf" }],
          created_at: "2026-11-03T09:05:00Z",
          edited_at: "2026-11-03T09:06:00Z",
          deleted_at: null,
        },
        { sender: null, body: "=SUM(A1)", attachments: [], created_at: "2026-11-03T09:10:00Z", edited_at: null, deleted_at: null },
      ],
      (member) => (member === A ? "Jana" : null),
      { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Europe/Prague" },
      labels,
    );
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Čas,Odesílatel,Zpráva,Přílohy,Upraveno,Smazáno");
    expect(lines[1]).toContain(`Jana,"Ahoj @Jana, ""viz"" příloha",smlouva.pdf,ano,`);
    expect(lines[1]).toContain("10:05");
    // A former member keeps a row; a formula is never run by a spreadsheet.
    expect(lines[2]).toContain("Bývalý člen,'=SUM(A1)");
  });

  it("names the file after the conversation and the day", () => {
    expect(
      chatCsvFileName("zpravy", "Obchod & Prodej", DEFAULT_FORMAT_SETTINGS, new Date("2026-11-03T10:00:00Z")),
    ).toBe("zpravy-obchod-prodej-2026-11-03.csv");
  });
});
