# Finance jako tabulka příjmů a výdajů — kolo 14

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 21 — Finance jako plánovací tabulka

*Předloha: majitelova tabulka v Google Sheets „Příjmy a výdaje". Jeden list = jeden měsíc, sloupce Týden 1–4 + Celkem, bloky Počáteční kapitál · PŘÍJMY (řádek = zdroj, např. klient) · VÝDAJE (řádek = položka) · KAPITÁL (bilance týdne, konečný kapitál). Vpravo Shrnutí měsíce: vstupní kapitál, příjmy celkem, výdaje celkem, bilance, konečný kapitál, nejnižší stav a kdy nastane. Modrá čísla se přepisují, černá se počítají. Nová položka = nový řádek nad součtem. Smysl tabulky: plánovat dopředu (listopad má vyplněné 4 týdny včetně budoucích), ne jen evidovat.*

## Prompt 21.1 — Plánovací tabulka měsíce · **Opus 5.5**

```
Sekce Finance dostane nový hlavní pohled „Měsíc" — tabulku příjmů
a výdajů po týdnech, jako je majitelova tabulka v Google Sheets
(popis nad touto fází). Dnešní evidence (transactions,
recurring_payments, faktury, grafy) zůstává a napojí se.

1. DATA. Tabulka finance_plan_rows (user_id prostor, month
   'YYYY-MM', kind income|expense, label, position, source
   manual|contact|deal|recurring|invoice, source_id, created_at)
   a finance_plan_cells (row_id, week 1–5, planned numeric,
   actual numeric null, note). Plus finance_plan_months (user_id,
   month, opening_capital, currency, closed boolean). Týden = ISO
   týdny spadající do měsíce (4 nebo 5; týden přesahující do
   dalšího měsíce patří měsíci, ve kterém je jeho pondělí; napiš
   to do nápovědy a testuj přelom roku). RLS podle prostoru;
   pracovník jen s právem finance.
2. TABULKA (finance-view → nový pohled Měsíc, výchozí):
   - přepínač měsíce ‹ Listopad 2026 ›, sloupce Týden 1…4/5 ·
     Celkem, vpravo panel Shrnutí měsíce,
   - řádek Počáteční kapitál (týden 1 = zadané číslo, další týdny
     = konečný kapitál předchozího týdne, Celkem = týden 1),
   - blok PŘÍJMY: řádky podle položek, prázdný řádek nad součtem
     pro novou položku (napsat název → vznikne řádek), součet
     Příjmy celkem,
   - blok VÝDAJE stejně,
   - blok KAPITÁL: Bilance týdne (příjmy − výdaje), Konečný
     kapitál (počáteční + bilance),
   - Shrnutí: vstupní kapitál, příjmy celkem, výdaje celkem,
     bilance měsíce, konečný kapitál, nejnižší stav a ve kterém
     týdnu nastane (varování, když je nejnižší stav pod nulou
     nebo pod zadanou rezervou).
   - Barvy jako v tabulce: zadávaná čísla modře, počítaná černě
     (tokeny z CLAUDE.md, žádné tvrdé barvy), záporné červeně.
   - Buňka se edituje na místě (klik nebo šipky + psaní, Tab/Enter
     posun jako v tabulkovém editoru, Esc zruší), ukládá se hned
     (optimisticky, s vrácením při chybě), podporuje zadání
     „12500", „12 500", „12,5k", výraz „3*4000".
   - Řádky jde přejmenovat, přesunout tažením, smazat (s potvrzením,
     když má čísla), skrýt prázdné.
   - Na telefonu: sloupce týdnů horizontálně posuvné s přilepeným
     prvním sloupcem, Shrnutí nad tabulkou jako karty.
3. PLÁN vs. SKUTEČNOST. Každá buňka má plán (modré číslo) a
   skutečnost (z transactions za daný týden a položku). Přepínač
   nad tabulkou: Plán · Skutečnost · Rozdíl. Ve Skutečnosti jsou
   buňky počítané (nejde je přepsat), klik otevře seznam
   transakcí týdne pro tu položku s možností přidat transakci.
   Přiřazení transakce k řádku: podle source (faktura/obchod/
   pravidelná platba/kontakt) automaticky, jinak podle kategorie
   = název řádku; nepřiřazené transakce týdne v řádku „Ostatní"
   dole v každém bloku. Když týden už uplynul, zobrazí se
   skutečnost vedle plánu i v režimu Plán (malé šedé číslo pod
   plánem).
4. PŘENOS DO DALŠÍHO MĚSÍCE: tlačítko „Založit prosinec z listopadu"
   (zkopíruje řádky bez čísel, nebo s čísly, nebo jen pravidelné;
   počáteční kapitál = konečný kapitál listopadu, s možností
   přepsat). Pravidelné platby (recurring_payments) se do nového
   měsíce dosadí automaticky jako plán do správného týdne podle
   splatnosti; faktury vystavené s datem splatnosti v měsíci jako
   plánovaný příjem u řádku klienta; obchody s Close Date
   v měsíci jako navrhovaný příjem (šedý řádek „očekávané
   z pipeline", který jde jedním klikem přijmout do plánu).
5. Dnešní pohledy (transakce, pravidelné platby, grafy, souhrnné
   dlaždice) zůstávají jako další záložky: Měsíc · Transakce ·
   Pravidelné · Přehled. Graf vývoje kapitálu po týdnech (plán
   i skutečnost, 3 měsíce dozadu a 3 dopředu) do Přehledu.
6. Export měsíce do CSV/XLSX se stejným rozvržením jako tabulka
   (xlsx skill), import z CSV ve stejném rozvržení (pro přenesení
   majitelovy tabulky).
7. Jarvis: zná plán měsíce, nejnižší stav a kdy nastane; umí
   upozornit („ve 4. týdnu ti klesne kapitál pod 5 000 Kč kvůli
   nájmu, chybí 2 příjmy") — přidat do souhrnu situace a mezi
   typy návrhů (cashLow), respektovat pravidla z 20.1.
8. Vitest pro týdny v měsíci (přelom roku, 5 týdnů), součty,
   nejnižší stav, parsování čísel, přenos měsíce; E2E: založit
   měsíc → zadat kapitál, 2 příjmy, 3 výdaje → shrnutí sedí
   s předlohou (použij čísla z listopadu: kapitál 8 500, příjmy
   74 500, výdaje 66 000, konečný 17 000, nejnižší 6 500 v týdnu 1)
   → založit další měsíc → export XLSX. Doplň CLAUDE.md sekci
   Finance.
```

---

## Prompt 21.2 — Vzhled tabulky financí · **Fable 5.1**

```
Tabulka z 21.1 funguje; teď ať je radost ji používat a ať je
na první pohled jasné, co se přepisuje a co se počítá. Použij
skill frontend-design a dataviz.

1. Snímky před do docs/finance-redesign/before/ (1440 i 390 px),
   krátká diagnóza.
2. Tabulka jako nástroj na čísla: tabulární číslice, jednotné
   zarovnání vpravo, mezera jako oddělovač tisíců, měna jen
   v hlavičce; řádky bloků s jemným pozadím, součtové řádky tučně
   s horní linkou, hlavička sloupců přilepená při scrollu;
   aktuální týden zvýrazněný sloupcem, minulé týdny lehce ztlumené.
   Modrá pro zadávané hodnoty jako jediná akcentová barva v
   tabulce; záporné hodnoty červeně, nejnižší stav pod rezervou
   výrazně.
3. Shrnutí měsíce jako klidný panel vpravo (na telefonu nahoře):
   konečný kapitál jako hlavní číslo, pod ním malý sparkline
   kapitálu po týdnech, ostatní čísla v jedné sloupcové tabulce.
4. Prázdný stav měsíce: krátký průvodce „Zadej počáteční kapitál
   → přidej první příjem → první výdaj" přímo v tabulce.
5. Mikrointerakce: při zadání čísla se přepočítané buňky krátce
   zvýrazní; žádné skákání rozvržení; reduced motion.
6. Snímky po do docs/finance-redesign/after/, E2E financí projdou
   (jen selektory).
```

---

## Kontrola fáze 21 · **Opus 5.5**

```
Zkontroluj fázi 21 podle CLAUDE.md:
- RLS finance_plan_* a práva pracovníka na finance,
- výpočty: ověř proti předloze (listopad 2026: konečný kapitál
  17 000, nejnižší stav 6 500 v týdnu 1), 5týdenní měsíc, přelom
  roku, měna prostoru, zaokrouhlení,
- skutečnost z transactions se počítá jen z transakcí prostoru
  a správného týdne; přiřazení k řádku je deterministické,
- přenos měsíce nevytváří duplicitní řádky při opakovaném
  spuštění, pravidelné platby se nedosazují dvakrát,
- import CSV nepadá na cizím souboru, limit velikosti,
- Jarvisův návrh cashLow respektuje pravidla a nevymýšlí čísla,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 21.1 | architect |
- [ ] 21.2 | designer |
- [ ] K21 | reviewer |
- [ ] STOP | Konec fáze 21. Ve Financích otevři pohled Měsíc, zadej listopad podle své tabulky (kapitál 8 500, příjmy Grid, Fajn Jídlo, Carwest, Auto Matulka, výdaje) a porovnej Shrnutí s Google Sheets — musí sedět na korunu. Přepni Plán/Skutečnost/Rozdíl, založ prosinec z listopadu, exportuj XLSX a otevři ho. Zeptej se Jarvise, kdy ti bude nejmíň peněz. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek` nebo `/clear` a `/pokracuj`. První poběží 21.1.
