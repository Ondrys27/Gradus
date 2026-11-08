#!/usr/bin/env python3
"""Pomocník nočního běhu (scripts/noc.sh) pro migrace databáze.

  python3 scripts/noc-migrace.py pending
      Vypíše verze migrací, které jsou jen lokálně (ve vzdálené databázi
      chybí), jednu na řádek. Kód 2, když stav nejde zjistit.

  python3 scripts/noc-migrace.py check SOUBOR...
      Ověří, že migrace jen přidávají (pravidlo z CLAUDE.md). Kód 1 a důvody
      na výstupu, když obsahují něco mazacího nebo měnícího.

Kontroluje se SQL, které se při migraci opravdu spustí: těla funkcí
(create function … as $$ … $$) se přeskočí, protože se jen definují; bloky
do $$ … $$ se spouští hned, tak se kontrolují celé i s řetězci.
"""

import json
import re
import subprocess
import sys
import time

FORBIDDEN = [
    (r"\bdrop\s+(table|column|schema|type|domain|view|materialized\s+view|function|procedure|sequence|extension)\b",
     "maže tabulku, sloupec, funkci nebo jiný objekt (drop)"),
    (r"\bdrop\b[^;]*\bcascade\b", "maže s cascade"),
    (r"\brename\b", "přejmenovává (rename)"),
    (r"\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b", "mění typ sloupce"),
    (r"\btruncate\b", "maže obsah tabulky (truncate)"),
    (r"\bdelete\s+from\b", "maže řádky (delete from)"),
    (r"\bupdate\s+auth\.", "mění data v auth"),
    (r"\bdisable\s+row\s+level\s+security\b", "vypíná RLS"),
    (r"\bno\s+force\s+row\s+level\s+security\b", "oslabuje RLS"),
]

DOLLAR = re.compile(r"\$([A-Za-z_][A-Za-z_0-9]*)?\$")


def executed_sql(text: str) -> str:
    """The parts of a migration that run when it is applied, without comments."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            out.append(" '' ")
            i = j + 1
            continue
        m = DOLLAR.match(text, i)
        if m:
            tag = m.group(0)
            end = text.find(tag, m.end())
            end = n if end < 0 else end
            body = text[m.end():end]
            before = "".join(out).rstrip().lower()
            if before.endswith("do"):
                # Runs now: check all of it, strings and dynamic SQL included.
                out.append(" " + re.sub(r"--[^\n]*", " ", body) + " ")
            else:
                out.append(" $body$ ")
            i = end + len(tag)
            continue
        out.append(c)
        i += 1
    return "".join(out)


def check(paths):
    problems = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            sql = executed_sql(f.read()).lower()
        for pattern, reason in FORBIDDEN:
            m = re.search(pattern, sql, re.S)
            if m:
                snippet = " ".join(m.group(0).split())[:80]
                problems.append(f"{path}: {reason}: „{snippet}“")
    for p in problems:
        print(p)
    return 1 if problems else 0


def list_migrations():
    """supabase migration list, tried three times: the connection to the
    database sometimes drops for a few minutes."""
    for attempt in range(1, 4):
        try:
            run = subprocess.run(
                ["bunx", "supabase", "migration", "list"],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=120,
            )
            output = run.stdout + "\n" + run.stderr
            if run.returncode == 0:
                return output
            print(f"supabase migration list (pokus {attempt}): {output[-1500:]}", file=sys.stderr)
        except (subprocess.TimeoutExpired, OSError) as error:
            print(f"supabase migration list (pokus {attempt}): {error}", file=sys.stderr)
        if attempt < 3:
            time.sleep(60)
    return None


def pending():
    output = list_migrations()
    if output is None:
        return 2
    versions = None
    m = re.search(r'\{"migrations".*\}', output)
    if m:
        try:
            data = json.loads(m.group(0))
            versions = [x["local"] for x in data["migrations"] if x.get("local") and not x.get("remote")]
        except (ValueError, KeyError, TypeError):
            versions = None
    if versions is None:
        rows = re.findall(r"^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|", output, re.M)
        if not rows:
            print("Výstupu supabase migration list nerozumím.", file=sys.stderr)
            return 2
        versions = [local for local, remote in rows if local and not remote]
    for v in versions:
        print(v)
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "pending":
        sys.exit(pending())
    if len(sys.argv) >= 3 and sys.argv[1] == "check":
        sys.exit(check(sys.argv[2:]))
    print(__doc__)
    sys.exit(2)
