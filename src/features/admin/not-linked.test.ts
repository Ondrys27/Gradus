// @vitest-environment node
//
// The administration does not exist from the outside: no sitemap entry, no
// robots.txt line pointing at it and no link anywhere in the app or the site.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

const SRC = path.resolve(__dirname, "../..");
/** Only these may know the address. */
const ALLOWED = [
  path.join(SRC, "features/admin"),
  path.join(SRC, "app/(admin)"),
  path.join(SRC, "middleware.ts"),
  path.join(SRC, "types/database.ts"),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|json)$/.test(name) ? [full] : [];
  });
}

describe("the administration is hidden", () => {
  it("is not in the sitemap", () => {
    expect(JSON.stringify(sitemap())).not.toMatch(/\/admin/);
  });

  it("is not named in robots.txt, which anyone can read", () => {
    expect(JSON.stringify(robots())).not.toMatch(/\/admin/);
  });

  it("is linked from nowhere outside itself", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !ALLOWED.some((allowed) => file.startsWith(allowed)))
      .filter((file) => /["'`]\/admin(\/|["'`?])/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
