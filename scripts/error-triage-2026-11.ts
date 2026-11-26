/**
 * The triage of the error log of November 2026 (30.1): every group of
 * error_events by fingerprint, what it was and what was done, as a table for
 * docs/chyby-2026-11.md, and with --apply the state and a note in the log
 * (error_groups: Vyřešená with the commit, Ignorovat for noise; "nejde určit"
 * stays Nová with the note). Reads with the secret key, writes only
 * error_groups; never deletes anything.
 *
 *   bun scripts/error-triage-2026-11.ts                  the table
 *   bun scripts/error-triage-2026-11.ts --apply --commit abc1234
 */
import { createClient } from "@supabase/supabase-js";
import { statusChange } from "../src/features/admin/error-log";
import type { Database } from "../src/types/database";

type Verdict = "noise" | "fixed" | "fixedBefore" | "test" | "unknown";
type Rule = { match: (group: Group) => boolean; verdict: Verdict; what: string; done: string };
type Group = { fingerprint: string; n: number; message: string; page: string; source: string; versions: Set<string>; last: string };

const COMMIT_THIS = "COMMIT";

const RULES: Rule[] = [
  {
    match: (g) => /in the React Client Manifest/.test(g.message),
    verdict: "noise",
    what: "Turbopack na `next dev` ztratil klientský manifest (build vedle běžícího dev serveru, e2e); v produkci nikdy",
    done: "pravidlo `devBundler` v noise.ts, Ignorovat",
  },
  {
    match: (g) => /was instantiated because it was required from module/.test(g.message),
    verdict: "noise",
    what: "Turbopack HMR na `next dev`: modul po horké výměně bez instance; v produkci nikdy",
    done: "pravidlo `devBundler`, Ignorovat",
  },
  {
    match: (g) => /NextIntlClientProvider` was not found/.test(g.message) && [...g.versions].every((v) => v === "dev"),
    verdict: "noise",
    what: "následek rozbitého grafu modulů na `next dev` (dvě instance next-intl, i ve worktree vedle); v produkci nikdy",
    done: "pravidlo `devBundler` (jen na dev serveru), Ignorovat",
  },
  {
    match: (g) => /^Error: Gradus crash test/.test(g.message),
    verdict: "test",
    what: "záměrná chyba e2e 25 / 29 / 60 / 71 na /app/test-chyby (účty e2e, transport mock)",
    done: "Ignorovat; zapisovat se musí dál (testy ověřují zápis)",
  },
  {
    match: (g) => g.message === "Error: Connection closed.",
    verdict: "noise",
    what: "přerušené načítání RSC: dev server se restartoval nebo test zavřel stránku uprostřed načtení",
    done: "pravidlo `connectionLost` (dev, offline, odchod ze stránky), Ignorovat",
  },
  {
    match: (g) => g.message === "Error: aborted",
    verdict: "noise",
    what: "prohlížeč zavřel spojení uprostřed požadavku (Node `abortIncoming`), odchod ze stránky",
    done: "pravidlo `abortedRequest`, Ignorovat",
  },
  {
    match: (g) => /Minified React error #185|Maximum update depth exceeded/.test(g.message),
    verdict: "fixedBefore",
    what: "tažení widgetu na Přehledu přeskakovalo tam a zpět mezi widgety jiné velikosti (dnd-kit), React to po 50 krocích utnul",
    done: "opraveno 07fd51a (24. 11.), e2e 69c; Vyřešená",
  },
  {
    match: (g) => /Cannot read properties of undefined \(reading 'mode'\)/.test(g.message),
    verdict: "fixedBefore",
    what: "odhlášení vyprázdnilo cache dřív, než stránka odešla; ThemeSync četl profil, který už nebyl",
    done: "opraveno 4d7aa33 (13. 11.); Vyřešená",
  },
  {
    match: (g) => /Hydration failed because the server rendered text/.test(g.message) && g.page === "/app/nastaveni/vzhled",
    verdict: "fixed",
    what: "volby formátu data a času se psaly aktuálním časem: přelom minuty mezi vykreslením na serveru a hydratací změnil text",
    done: `volby píšou pevný vzorový okamžik (appearance-view.tsx), ${COMMIT_THIS}; Vyřešená`,
  },
  {
    match: (g) => /Hydration failed/.test(g.message),
    verdict: "unknown",
    what: "nesoulad hydratace Předplatného jen na `next dev` u e2e účtů; v kódu stránky nic zjevného, nepodařilo se zopakovat",
    done: "nejde určit, zůstává Nová s poznámkou",
  },
  {
    match: (g) => g.message === "unknown" && g.page === "/api/jarvis",
    verdict: "unknown",
    what: "něco, co není Error, vyhozené v chatu Gradyho na dev serveru (stará adresa /api/jarvis); od 8. 11. se neopakuje",
    done: `nejde určit; zachycení nově zapíše druh vyhozené věci místo „unknown“ (errorText), ${COMMIT_THIS}; zůstává Nová`,
  },
];

const STATUS: Record<Verdict, "resolved" | "ignored" | null> = {
  noise: "ignored",
  test: "ignored",
  fixed: "resolved",
  fixedBefore: "resolved",
  unknown: null,
};

const LABEL: Record<Verdict, string> = {
  noise: "šum",
  test: "šum (test)",
  fixed: "skutečná, opraveno teď",
  fixedBefore: "už opraveno dřív",
  unknown: "nejde určit",
};

async function main() {
  const apply = process.argv.includes("--apply");
  const commitAt = process.argv.indexOf("--commit");
  const commit = commitAt > 0 ? process.argv[commitAt + 1] : undefined;
  if (apply && !commit) throw new Error("--apply needs --commit <hash>");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or the secret key.");
  const admin = createClient<Database>(url, key, { auth: { persistSession: false } });

  const groups = new Map<string, Group>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("error_events")
      .select("fingerprint, message, page, source, app_version, created_at")
      .order("created_at")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      const group = groups.get(row.fingerprint) ?? {
        fingerprint: row.fingerprint,
        n: 0,
        message: row.message,
        page: row.page,
        source: row.source,
        versions: new Set<string>(),
        last: row.created_at,
      };
      group.n += 1;
      group.versions.add(row.app_version ?? "?");
      group.last = row.created_at;
      groups.set(row.fingerprint, group);
    }
    if ((data ?? []).length < 1000) break;
  }

  const rows = [...groups.values()].sort((a, b) => b.n - a.n);
  const lines = ["| Otisk | Počet | Kde | Co to bylo | Verdikt | Co se udělalo |", "|---|---|---|---|---|---|"];
  const unmatched: Group[] = [];
  for (const group of rows) {
    const rule = RULES.find((candidate) => candidate.match(group));
    if (!rule) {
      unmatched.push(group);
      continue;
    }
    const done = rule.done.replace(COMMIT_THIS, commit ?? "tento commit");
    lines.push(
      `| \`${group.fingerprint.slice(0, 12)}\` | ${group.n} | ${group.page} | ${rule.what} | ${LABEL[rule.verdict]} | ${done} |`,
    );
    if (!apply) continue;
    const status = STATUS[rule.verdict];
    const now = new Date().toISOString();
    const note = `${LABEL[rule.verdict]}: ${rule.what}. ${done}`.slice(0, 500);
    const { error } = await admin
      .from("error_groups")
      .upsert(
        { fingerprint: group.fingerprint, ...(status ? statusChange(status, now) : {}), note, updated_at: now },
        { onConflict: "fingerprint" },
      );
    if (error) throw error;
  }
  console.log(lines.join("\n"));
  console.log(`\n${rows.length} groups, ${rows.reduce((sum, g) => sum + g.n, 0)} events, unmatched ${unmatched.length}`);
  for (const group of unmatched) console.log(`UNMATCHED ${group.fingerprint} ${group.n} ${group.page} ${group.message.slice(0, 120)}`);
}

await main();
