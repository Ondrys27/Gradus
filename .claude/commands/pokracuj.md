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
