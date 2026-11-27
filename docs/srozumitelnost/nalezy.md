# Srozumitelnost celé aplikace (30.9)

Průchod jako nový majitel (nástrojový režim, prázdný účet) a nový pracovník
(šablona Obchodník) na 1440 a 390 px. Snímky `before/` a `after/` dělá
`bun scripts/srozumitelnost-shots.ts before|after` nad běžícím dev serverem
(založí a smaže účty e2e-…@gradus.local). „Prvky“ = ovládací prvky, které
na první obrazovce soupeří o pozornost (bez levého menu, bez horní lišty).

## Nálezy před (majitel, 1440 px)

| Obrazovka | Hlavní akce | Vidět do 3 s | Prvků | Nejasná slova | Prázdný stav |
|---|---|---|---|---|---|
| Přehled | žádná jasná („Upravit“ je sekundární, „Nový úkol“ je odkaz v kartě) | ne | 8 | „Co hoří“ bez vysvětlení, „Uzavření“ (Close Date) | karta „Dnes nic nečeká“ s odkazem, ok |
| Milníky | Nový milník | ano, ale vedle „Importovat mapu“ stejné váhy | 6 | — | ano, bez odkazu na ukázku |
| Poznámky | Nová poznámka | ano | 14 (5 šablon × 2 ikony bez popisku) | ikony + a mapa jen s bublinou | ano (šablony) |
| Kontakty | Nový kontakt | ne: tři tlačítka stejné velikosti v hlavičce | 15 | „Generovat kontakty“ (odkud?), „Upravit tabulky“ | ano, bez cesty ke generování a k ukázce |
| Cold Calling | Spustit časovač | ano | 16 | „Ozvat se“, „Pozastaveno“ u stopek, „Všichni / Já“ | „Tady už není komu volat“ bez akce |
| Pipeline | Nový obchod | ne: „Upravit fáze“, „+“ a „Nový obchod“ vedle sebe; prázdný stav tlačítko opakuje | 11 | „Uzavření v minulosti“ (Close Date), „+“ bez popisku u fáze | ano, bez ukázky |
| Úkoly | Nový úkol | ano | 6 | — | bez akce (jen věta „tlačítkem Nový úkol“) |
| Kalendář | Přidat událost | ano | 12 | „Očekávaná uzavření obchodů“, „Obsazenost“ | kalendář sám, ok |
| Plánovač schůzek | Nový typ | ne: karta „Tři věci“ má vlastní Hotovo / Později | 9 | „typ schůzky“, „handle“ v adrese | ano (průvodce), bez ukázky |
| Finance · Měsíc | Založit listopad | ano | 8 | „Automatické platby“, „plán“ | ano |
| Finance · Faktury | Nová faktura | ano | 7 | DUZP, VS (jen v dialogu) | ano, bez ukázky |
| Správa firmy | Pozvat pracovníka | ano | 10 | „Připojené aplikace ve firmě“ nad seznamem lidí, „Aktivita / Přehledy“ | ano |
| Zprávy | Napsat zprávu (řádek člověka) | ano | 3 | — | ano |
| Nastavení | — (rozcestník) | ano | 9 | „Integrace“ (co to je) | — |
| Nastavení · Vzhled | — | ano | 12 | — | — |

## Nálezy před (pracovník Obchodník, 390 px)

| Obrazovka | Hlavní akce | Vidět do 3 s | Prvků | Poznámka |
|---|---|---|---|---|
| Přehled | žádná | ne | 6 | „Odpracovaný čas“ až pod ohybem; lišta Přehled · Úkoly · Zprávy · Odměny · Více |
| Úkoly | Nový úkol | ano | 6 | prázdný stav bez akce |
| Kontakty | Nový kontakt | ne | 12 | tři tlačítka se lámou na dva řádky |
| Pipeline | Nový obchod | ne | 9 | tři tlačítka v jednom řádku, „+“ bez popisku |
| Cold Calling | Spustit | ano | 14 | stopky nad seznamem, dlouhá stránka |
| Kalendář | Přidat událost | ano | 10 | — |
| Plánovač | Nový typ | ne | 8 | karta „Tři věci“ soupeří |
| Zprávy | Napsat | ano | 3 | — |
| Odměny | — | ano | 4 | — |
| Správa firmy (svá větev) | — | ano | 5 | jen pro čtení, bez vysvětlení proč |
| Poznámky | Nová poznámka | ano | 12 | — |

Společné: levé menu má 12 položek bez struktury (pracovník 7–11), telefon
4–5 v liště + Více s plochou mřížkou. Sekce bez dat nemá odkaz na průvodce
30.8, ačkoli existuje. Slova „Synchronizováno“ (stav poznámky), „token“
(jen v klíčových slovech hledání), „ID“ (jen „Krátké ID“ a „Apple ID“, ok).

## Co se změnilo

1. **Menu ve skupinách** (`components/layout/nav-prefs.ts`): Dnes · Obchod ·
   Podnikání · Firma, nadpisy v širokém menu, linky v úzkém; pracovník vidí
   jen svoje sekce, prázdná skupina se nekreslí. Nastavení → Vzhled → Menu:
   připnout (nejvýš 5, první v menu i v liště na telefonu), skrýt (adresa i
   hledání fungují dál), posunout ve skupině, Výchozí menu. Panel Více na
   telefonu má stejné skupiny. Adresy se nemění.
2. **Jedna hlavní akce**: Milníky, Kontakty a Pipeline mají v hlavičce jedno
   plné tlačítko „Nový …“ a vedle „⋯ Další možnosti“ (`MoreMenu`) s Importovat
   mapu / Generovat kontakty · Upravit tabulky / Upravit fáze · Přidat fázi.
   Průvodci a ukázkový scénář jdou přes ⋯ (ui-map `milestones-more`,
   `contacts-more`, `pipeline-more`).
3. **Prázdné stavy**: každá sekce s průvodcem má pod akcí „Rychlá ukázka ·
   1–2 min“ (`EmptyState guide=…` → průvodce 30.8). Úkoly dostaly tlačítko
   Nový úkol, Cold Calling „Otevřít Kontakty“, Kontakty tišší „Generovat
   kontakty“ vedle hlavní akce.
4. **Dialog úkolu**: nový úkol ukáže 5 polí, Popis čeká za „Přidat popis“.
5. **Slovník** `docs/slovnik.md` + pravidlo v CLAUDE.md; „Synchronizováno“
   u poznámky je „Uloženo“.

## Před / po (počet prvků na první obrazovce)

| Obrazovka (majitel 1440) | Před | Po | Změna |
|---|---|---|---|
| Levé menu | 12 položek v jednom sloupci | 12 ve 4 skupinách s nadpisy | čitelné po skupinách, připnutí / skrytí |
| Milníky | 6 (2 v hlavičce) | 5 (1 + ⋯) | jedna hlavní akce, ukázka v prázdném stavu |
| Kontakty | 15 (3 v hlavičce) | 13 (1 + ⋯) | hlavní akce vidět hned; generování v prázdném stavu a pod ⋯ |
| Pipeline | 11 (3 v hlavičce) | 9 (1 + ⋯) | „+“ bez popisku je pojmenovaná položka menu |
| Úkoly | 6 | 7 (prázdný stav má akci + ukázku) | první krok bez hledání tlačítka |
| Cold Calling | 16 | 17 (prázdný stav má akci + ukázku) | cesta ke kontaktům |
| Nastavení · Vzhled | 12 | 12 + oddíl Menu | menu se dá přizpůsobit |

| Obrazovka (pracovník 390) | Před | Po |
|---|---|---|
| Pipeline hlavička | 3 tlačítka v řádku | 1 tlačítko + ⋯ |
| Kontakty hlavička | 3 tlačítka na dvou řádcích | 1 tlačítko + ⋯ |
| Více (spodní lišta) | plochá mřížka | skupiny Dnes · Obchod · Podnikání · Firma |

## Otevřené (nedělalo se v tomto kole)

- Přehled nemá jednu hlavní akci; karta „Dnes“ by měla nést plné tlačítko.
- Plánovač: karta „Tři věci“ a „Nový typ“ soupeří; po dokončení karty je to v pořádku.
- Dialogy obchodu, události a typu schůzky mají víc než 5 polí napoprvé.
- Poznámky: ikony + a mapa u šablon mají jen bublinu; popisek by pomohl na telefonu.
- Konzistentní „Zpět“ po vratných akcích existuje u poznámek, obchodních úkolů a Gradyho; u přesunu kontaktu a smazání události ne.
- Kalendářní „synchronizace“ (Google / Apple) zůstává jako název funkce; status poznámky už „sync“ neříká.
