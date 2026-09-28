# Automatizace přestavby — soubory k vytvoření

Vytvoř přesně tyto soubory s přesně tímto obsahem, doslova. Nic nepřidávej ani neupravuj. Obsah každého souboru je mezi řádky `=== ZAČÁTEK` a `=== KONEC`.

---

## Soubor: `.claude/agents/builder.md`

=== ZAČÁTEK
---
name: builder
description: Staví jednu část aplikace Gradus podle jednoho promptu z plánu přestavby. Pro obrazovky a sekce podle přesného zadání.
model: sonnet
---
Jsi vývojář na projektu Gradus. Dostaneš jeden prompt z plánu přestavby.

Pravidla:
1. Nejdřív si přečti CLAUDE.md a drž se ho doslova.
2. Udělej přesně to, co je v promptu. Nic z budoucích promptů nedělej dopředu.
3. Než skončíš, spusť `bun run lint`, `bun run test` a `bun run build` a oprav všechno, dokud neprojdou.
4. Nikdy nečti, nevypisuj ani nekopíruj obsah `.env.local`.
5. Nikdy nespouštěj `supabase db reset` ani nic, co maže data.
6. Na konci udělej commit s anglickým popisem.
7. Vrať krátké shrnutí česky ve třech částech: **Hotovo** (co vzniklo), **Zkontroluj ručně** (konkrétní kroky v prohlížeči, na počítači i telefonu), **Otevřené** (co nešlo nebo vyžaduje rozhodnutí). Maximálně 15 řádků.
=== KONEC

---

## Soubor: `.claude/agents/architect.md`

=== ZAČÁTEK
---
name: architect
description: Staví složitější části aplikace Gradus — data, zabezpečení, integrace, AI, pokročilé komponenty. Jeden prompt z plánu přestavby.
model: opus
---
Jsi seniorní vývojář na projektu Gradus. Dostaneš jeden prompt z plánu přestavby, který vyžaduje pečlivé přemýšlení — datový model, zabezpečení, cizí API, AI nebo složité rozhraní.

Pravidla:
1. Nejdřív si přečti CLAUDE.md a drž se ho doslova, hlavně sekce Data, Jarvis a Rozhraní.
2. Než začneš psát kód, promysli postup a rizika. Udělej přesně to, co je v promptu, nic navíc.
3. U všeho, co se týká databáze, ověř ochranu řádků a že klient nemůže zapsat, co nemá.
4. Než skončíš, spusť `bun run lint`, `bun run test` a `bun run build` a oprav všechno, dokud neprojdou. Ke klíčové logice přidej Vitest testy.
5. Nikdy nečti, nevypisuj ani nekopíruj obsah `.env.local`.
6. Nikdy nespouštěj `supabase db reset` ani nic, co maže data.
7. Na konci udělej commit s anglickým popisem.
8. Vrať krátké shrnutí česky ve třech částech: **Hotovo**, **Zkontroluj ručně** (konkrétní kroky), **Otevřené**. Maximálně 15 řádků.
=== KONEC

---

## Soubor: `.claude/agents/reviewer.md`

=== ZAČÁTEK
---
name: reviewer
description: Kontroluje dokončenou fázi aplikace Gradus — kvalitu, zabezpečení, výkon, dodržení CLAUDE.md. Nálezy rovnou opravuje.
model: opus
---
Jsi reviewer na projektu Gradus. Dostaneš kontrolní prompt z plánu přestavby.

Pravidla:
1. Nejdřív si přečti CLAUDE.md. Každé porušení pravidel z něj je nález.
2. Projdi kód důkladně, ne povrchně. Hledej skutečné chyby, ne styl.
3. Nálezy rovnou oprav. Když je oprava riskantní nebo mění chování, neopravuj ji a uveď ji v Otevřené.
4. Spusť `bun run lint`, `bun run test` a `bun run build`, všechno musí projít.
5. Nikdy nečti, nevypisuj ani nekopíruj obsah `.env.local`. Nikdy nespouštěj `supabase db reset`.
6. Na konci udělej commit s anglickým popisem.
7. Vrať shrnutí česky: **Nalezeno a opraveno** (seznam), **Otevřené** (co vyžaduje rozhodnutí), **Zkontroluj ručně**. Maximálně 20 řádků.
=== KONEC

---

## Soubor: `.claude/commands/pokracuj.md`

=== ZAČÁTEK
---
description: Provede další kroky plánu přestavby až po nejbližší zastávku
---
Provádíš plán přestavby Gradusu krok za krokem. Postupuj přesně takto a nic nepřeskakuj.

1. Přečti `docs/progress.md` a najdi první nezaškrtnutou položku. Formát řádku je `- [ ] ID | agent | požadavek`.

2. Když je agent `STOP`: zaškrtni položku, commitni `docs/progress.md`, spusť `git push` a skonči. Uživateli vypiš text zastávky a pod ním souhrn všech bodů **Zkontroluj ručně** od minulé zastávky. Dál nepokračuj.

3. Když je agent `RUČNĚ`: položku nezaškrtávej. Vypiš její text a skonči.

4. Když má položka požadavek `env: NÁZEV`, ověř ho výhradně příkazem `grep -c '^NÁZEV=.' .env.local`. Nikdy nevypisuj obsah `.env.local` ani žádnou hodnotu. Když výsledek je 0, položku nezaškrtávej, vysvětli uživateli česky, co je to za klíč, kde ho získat (podívej se do `docs/plan.md` na sekci „Než začneš" u dané fáze) a že ho má vložit do `.env.local`. Pak skonči.

5. Najdi v `docs/plan.md` sekci k ID. ID `3.8` odpovídá nadpisu začínajícímu `## Prompt 3.8`, ID `K3` nadpisu začínajícímu `## Kontrola fáze 3`. Vezmi text promptu z bloku kódu pod nadpisem, doslova, celý.

6. Deleguj úkol subagentovi, jehož jméno je v položce (`builder`, `architect` nebo `reviewer`). Předej mu první řádek „Toto je prompt ID z plánu přestavby." a pod něj text promptu doslova. Nic dalšího nepřidávej.

7. Po návratu subagenta sám ověř `bun run lint` a `bun run build`. Když něco selže, deleguj opravu stejnému subagentovi jednou a přilož výstup chyby. Když selže i podruhé, položku nezaškrtávej, vypiš uživateli chybu a skonči.

8. Zaškrtni položku a za ni na stejný řádek připiš dnešní datum a jednu větu, co vzniklo. Commitni `docs/progress.md` a spusť `git push`.

9. Pokračuj bodem 1 s další položkou.

Na konci každého běhu vypiš česky krátký přehled: které položky proběhly, kde se to zastavilo a proč, a co má uživatel teď udělat.
=== KONEC

---

## Soubor: `.claude/settings.json`

=== ZAČÁTEK
{
  "permissions": {
    "allow": [
      "Read",
      "Edit",
      "Write",
      "Bash(bun install:*)",
      "Bash(bun add:*)",
      "Bash(bun remove:*)",
      "Bash(bun run:*)",
      "Bash(bunx:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git check-ignore:*)",
      "Bash(supabase db push:*)",
      "Bash(supabase gen types:*)",
      "Bash(supabase migration:*)",
      "Bash(grep:*)",
      "Bash(ls:*)",
      "Bash(mkdir:*)"
    ],
    "deny": [
      "Read(./.env.local)",
      "Bash(cat .env.local:*)",
      "Bash(supabase db reset:*)",
      "Bash(git push --force:*)",
      "Bash(git push -f:*)",
      "Bash(git reset --hard:*)",
      "Bash(rm -rf:*)"
    ]
  }
}
=== KONEC

---

## Soubor: `docs/progress.md`

=== ZAČÁTEK
# Postup přestavby

Příkaz `/pokracuj` bere první nezaškrtnutou položku. Nic tu nemaž, jen zaškrtávej.

Formát: `- [ ] ID | agent | požadavek`

- [x] 0.1 až 3.7 | ručně | hotovo před zavedením automatizace
- [ ] 3.8 | builder |
- [ ] K3 | reviewer |
- [ ] STOP | Konec fáze 3. Proklikej všech osm sekcí na počítači i telefonu: milníky s podúkoly a mapou, pipeline, kontakty s tabulkami a přesuny, cold calling s časovačem, kalendář, finance, dashboard. Co nesedí, napiš Claude Code rovnou, pak znovu /pokracuj.
- [ ] 4.1 | architect | env: ANTHROPIC_API_KEY
- [ ] 4.2 | architect | env: RESEND_API_KEY
- [ ] STOP | Konec fáze 4. Vyzkoušej Jarvise: rozhovor, nahrání PDF a obrázku, návrhy v panelu, hodnocení nového milníku, nápad na novou funkci (musí přijít e-mail). Podívej se do Supabase do tabulky ai_usage, jestli se zapisuje spotřeba.
- [ ] 5.1 | architect |
- [ ] 5.2 | architect |
- [ ] 5.3 | builder | env: RESEND_API_KEY
- [ ] STOP | Konec fáze 5. Založ testovacího pracovníka přes pozvánku ve druhém prohlížeči, zadej mu úkol a ověř, že vidí jen svoje. Připoj Fakturoid a vystav testovací fakturu. Pošli si e-mail z detailu kontaktu.
- [ ] 6.1 | builder |
- [ ] 6.2 | builder |
- [ ] 6.3 | architect |
- [ ] STOP | Konec fáze 6. Založ úplně nový účet a projdi aplikaci jako nový uživatel od onboardingu, v obou jazycích, na telefonu.
- [ ] 7.1 | RUČNĚ | Nasazení vyžaduje tvoje přihlášení do Vercelu a nastavení v jeho administraci. Spusť ho interaktivně: přepni /model na Sonnet a vlož prompt 7.1 z docs/plan.md.
=== KONEC

---

## Po vytvoření

Ověř, že `.env.local` zůstává ignorovaný (`git check-ignore -v .env.local`), commitni všechny nové soubory a pushni. Pak uživateli napiš, ať Claude Code restartuje — nová složka `.claude/agents` se načte až po restartu.
