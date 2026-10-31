# Schůzka s Vášou: obchody, úkoly, pipeline — kolo 10

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 17 — Obchod jako střed aplikace

*Ze schůzky s Vášou 30. 10. Váša chce aplikaci začít používat sám; bez těchto věcí nemůže. Pořadí: nejdřív datový model úkolů (17.1), na něm stojí všechno ostatní.*

## Prompt 17.1 — Úkoly k obchodům a kontaktům, sekce Úkoly · **Opus 5.5**

```
Dnes jsou úkoly jen v milnících (hra) a u pracovníků. Obchod ani
kontakt úkoly nemají. Zaveď obchodní úkoly jako samostatnou entitu
a sekci v hlavním menu.

1. DATA. Tabulka crm_tasks: id, user_id (prostor), title,
   description, due_at (timestamptz, s časem), duration_minutes
   (15/30/60/120/vlastní, výchozí 15), assignee_id (profil
   pracovníka nebo majitel; výchozí = kdo úkol zakládá),
   deal_id | contact_id (aspoň jedno, může obojí), status
   (open | done), completed_at, completion_note, created_by,
   created_at, updated_at. RLS: majitel všechno; pracovník úkoly,
   které má přiřazené, plus úkoly u obchodů a kontaktů v sekcích,
   kam má právo. Indexy na due_at, assignee_id, deal_id.
   Milníkové úkoly (tasks s parent_task_id) se nemění.
2. ZALOŽENÍ ÚKOLU (dialog, stejný všude): název; popis; „Do kdy"
   — kalendář s výběrem dne i času (výchozí zítra 9:00, rychlé
   volby Dnes / Zítra / Za týden); „Jak dlouho" — 15 / 30 / 60 /
   120 min / vlastní; „Kdo" — výběr pracovníka, předvyplněný
   zakladatel. Jediné povinné pole je název: Enter po názvu
   úkol uloží s výchozími hodnotami.
3. HOTOVO. Označení Hotovo nabídne jedním krokem nepovinnou
   poznámku („Volal jsem s klientkou, pošle podklady v pondělí"),
   která se uloží jako completion_note a objeví se v historii
   obchodu/kontaktu. Hotovo jde vrátit.
4. SEKCE ÚKOLY. Hlavní menu, za Pipeline, ikona ListChecks,
   adresa /app/ukoly-crm (i18n CS „Úkoly", EN „Tasks"). Pozor:
   /app/ukoly už používá pracovník pro úkoly od majitele — sjednoť:
   pracovník v sekci Úkoly vidí obojí v jednom seznamu se štítkem
   původu, adresa /app/ukoly zůstává a stará stránka se přesměruje.
   Seznam řazený výchozím způsobem od nejstaršího termínu (nejdřív
   co hoří), v řádku: název, u kterého obchodu/kontaktu (odkaz),
   do kdy (s relativním časem), trvání, kdo, zaškrtávátko Hotovo.
   Rozklik = detail s popisem, historií a tlačítky Otevřít obchod /
   Otevřít kontakt. Skupiny v seznamu: Po termínu · Dnes · Zítra ·
   Tento týden · Později · Hotové (sbalené).
5. FILTRY (štítky jako v administraci, stav v adrese): Termín
   (po termínu / dnes / zítra / tento týden / příští týden /
   vlastní rozsah), Kdo (já / konkrétní pracovník / kdokoli),
   Stav (otevřené / hotové / vše), Trvání (do 15 / do 30 / do 60 /
   nad 60 min), podle obchodu nebo kontaktu. Rychlé přepínače
   nahoře: Vše · Otevřené · Po termínu · Dnes.
6. PO TERMÍNU = due_at < teď (včetně času: úkol na 15:00 je
   v 15:01 po termínu). Štítek červeně. Jarvis o úkolech po
   termínu ví (souhrn situace, proaktivní návrhy) a při návrhu
   „zavolej" respektuje časové okno z 13.6.
7. Kalendář: úkoly s časem se zobrazují v kalendáři jako položky
   (odlišené od schůzek), přesun v kalendáři změní due_at.
8. Analytika: crm_task_created, crm_task_completed (s trváním
   a zpožděním v minutách, bez názvů). Doplň CLAUDE.md sekci
   Úkoly. Vitest pro řazení, skupiny a výpočet „po termínu";
   E2E: založit z obchodu → vidět v Úkolech → filtr Dnes →
   Hotovo s poznámkou → v historii obchodu.
```

---

## Prompt 17.2 — Detail obchodu · **Opus 5.5**

```
Detail obchodu se dnes vysouvá zprava a je v něm málo. Nově je to
velké okno uprostřed (na počítači modal ~960 px, na telefonu celá
obrazovka), ve kterém je vše o obchodu na jednom místě. Inspirace
Bigin od Zoho, ale na jedné kartě, ne v pěti.

1. HLAVIČKA: název, fáze (přepínatelná na místě), částka a měna,
   Close Date, pracovník, datum vzniku.
   - Datum vzniku: created_at, zobrazené jen pro čtení, nejde
     měnit. U existujících obchodů zůstává.
   - „Očekávané uzavření" se přejmenuje: CS „Očekávané uzavření",
     EN musí být přesně „Close Date" (projdi všechna místa v EN
     překladech, i v Jarvisovi, exportech a analytice).
   - Pracovník: právě jeden; při založení se automaticky nastaví
     zakládající, jde změnit. Sloupec deals.assignee_id (přidávací,
     stávající obchody dostanou created_by nebo majitele).
   - Datum realizace (deadline): nepovinné, CS „Datum realizace
     (deadline)", EN „Delivery date (deadline)". Po vyplnění se
     automaticky založí celodenní událost v kalendáři s názvem
     obchodu a odkazem na něj; změna data událost posune, smazání
     data ji odstraní (vazba calendar_events.deal_id + typ
     deal_deadline). Událost nejde upravit mimo obchod, jen
     otevřít obchod.
2. KONTAKTY: víc kontaktů u jednoho obchodu, každý s rolí/poznámkou
   („rozhoduje", „fakturace", „řeším s ním web"). Tabulka
   deal_contacts (deal_id, contact_id, note, is_primary, position);
   stávající deals.contact_id se stane primárním kontaktem a zůstane
   pro zpětnou kompatibilitu synchronizovaný. Přidání z výběru
   kontaktů s hledáním, nebo nový kontakt na místě.
3. ÚKOLY: sekce s otevřenými úkoly obchodu (z 17.1), tlačítko
   „+ Přidat úkol", zaškrtnutí Hotovo s poznámkou přímo tady.
   Hotové úkoly sbalené pod tím.
4. POZNÁMKA obchodu zůstává (volný text) + propojené Poznámky
   z 13.4 (sekce Poznámky, „Zapsat do poznámek").
5. HISTORIE (časová osa) dole: založení, změny fáze, změny částky
   a Close Date, přidání kontaktu, založení a dokončení úkolu
   s completion_note, schůzky z kalendáře, odeslané e-maily,
   faktury, výhra/prohra s důvodem. Chronologicky, nejnovější
   nahoře, s ikonami podle typu. Rozšiř deal-activity-timeline.
   Poslední změna obchodu (deals.last_activity_at) se aktualizuje
   při každé z těchto událostí — bude potřeba pro filtry v 17.3.
6. Vzhled podle CLAUDE.md a skillu frontend-design: klidné, hustota
   jako v Linear, žádné karty v kartách. Na telefonu sekce jako
   záložky (Přehled · Kontakty · Úkoly · Historie).
7. Vitest pro synchronizaci primárního kontaktu a kalendářní
   události; E2E: otevřít obchod → změnit Close Date → přidat
   druhý kontakt s poznámkou → zadat deadline → událost v kalendáři
   → založit úkol → historie má všechny záznamy.
```

---

## Prompt 17.3 — Filtry a dashboard pipeline · **Opus 5.5**

```
1. FILTRY NAD PIPELINE (štítky, stav v adrese, sdílitelné):
   - Close Date (v minulosti / tento týden / tento měsíc / rozsah),
   - datum vzniku (rozsah),
   - poslední aktivita (deals.last_activity_at: nad 7 / 14 / 30 dní
     bez změny, rozsah),
   - úkoly: má otevřený úkol / nemá žádný otevřený úkol / má úkol
     po termínu,
   - pracovník, kontakt, částka (od–do).
   Filtry se kombinují (AND). Sloupce Vyhráno a Ztraceno se filtrují
   také, ale viz výjimky níže.
2. DASHBOARD NAD PIPELINE — tři dlaždice, „ukazují jen špatné věci",
   cíl je mít všude nulu:
   - Close Date v minulosti (jen otevřené obchody, ne vyhrané ani
     ztracené),
   - Úkoly po termínu (počet úkolů, včetně úkolů u vyhraných a
     ztracených obchodů — ty můžou být důležité),
   - Obchody bez otevřeného úkolu (jen otevřené obchody, ne vyhrané
     ani ztracené).
   Nula = zeleně, 1–3 žlutě, víc červeně. Klik na dlaždici
   rozbalí pod ní seznam dotčených obchodů (název, fáze, kontakt,
   co je špatně: „Close Date 12. 10.", „úkol po termínu 2 dny",
   „bez úkolu 9 dní"); každý řádek otevře detail obchodu z 17.2,
   kde to uživatel rovnou napraví (posune Close Date, založí úkol).
   Po nápravě se počet přepočítá bez obnovení stránky. Druhý klik
   dlaždici sbalí. Na telefonu dlaždice v řadě, seznam jako
   spodní panel.
3. TOTÉŽ NA HLAVNÍM PŘEHLEDU (nástěnka): stejné tři dlaždice
   s čísly a barvami nahoře; klik přepne do Pipeline s rozbalenou
   dlaždicí. Pracovník vidí jen své (přiřazené) obchody a úkoly.
4. Výchozí fáze nové pipeline: Nový lead · Schůzka · Koncept
   nabídky · Nabídka odeslána · Vyhráno · Ztraceno (jen pro nové
   prostory; existujícím se nic nemění).
5. Jarvis: dlaždice jsou součást souhrnu situace; ranní shrnutí
   začíná tím, co hoří.
6. Vitest pro výpočet všech tří čísel a výjimky vyhráno/ztraceno;
   E2E: obchod s Close Date včera → dlaždice 1 červeně → klik →
   seznam → otevřít → posunout → zeleně.
```

---

## Prompt 17.4 — Obchody u kontaktu a založení obchodu z Cold Callingu · **Opus 5.5**

```
1. KONTAKT → OBCHODY. V detailu kontaktu sekce Obchody: všechny
   obchody, kde je kontakt primární nebo přidaný přes deal_contacts
   — otevřené i vyhrané i ztracené (historie). Řádek: název, fáze
   (se štítkem Vyhráno/Ztraceno a datem), částka, Close Date,
   pracovník, poslední aktivita; klik otevře detail obchodu.
   Tlačítko „+ Nový obchod" s předvyplněným kontaktem. Souhrn
   nahoře: počet otevřených, součet hodnoty otevřených, vyhráno
   celkem.
2. COLD CALLING → OBCHOD. U kontaktu v Cold Callingu (v detailu
   i v dialogu přesunu do tabulky Domluvená schůzka) tlačítko
   „Založit obchod": otevře dialog nového obchodu s předvyplněným
   názvem (firma / jméno), kontaktem, pracovníkem (volající)
   a výběrem fáze pipeline, do které obchod spadne (výchozí první
   fáze, uživatel si může v nastavení Cold Callingu zvolit jinou
   výchozí fázi pro založení z Cold Callingu). Po založení odkaz
   na obchod přímo v řádku kontaktu v Cold Callingu, ať je vidět,
   že obchod existuje, a tlačítko se už nenabízí.
   Když přesun do Domluvené schůzky zakládá událost v kalendáři,
   nový obchod se k ní naváže (historie obchodu ukáže schůzku).
3. Nová tabulka v Cold Callingu „Klient má zájem" (mezi Odeslán
   e-mail a Domluvená schůzka; otázky: o co má zájem, kdy se ozvat)
   se stejným tlačítkem Založit obchod. Existujícím prostorům
   tabulku přidej, pokud si tabulky nepřizpůsobili; jinak jen
   nabídni v „Upravit tabulky".
4. ZATÍM NE (zapiš do docs/plan.md jako „Později"): automatické
   pravidlo „co spadne do tabulky X, založí obchod ve fázi Y".
   Váša i Ondřej se shodli, že ruční tlačítko pochopí každý
   a automatika přijde, až bude tutoriál.
5. Vitest, E2E: Cold Calling → Domluvená schůzka → Založit obchod →
   obchod v pipeline ve zvolené fázi s kontaktem i schůzkou
   v historii → kontakt ukazuje obchod v sekci Obchody.
```

---

## Prompt 17.5 — Přesouvání úkolů v mapě a v seznamu milníků · **Opus 5.5**

```
V milnících jde dnes úkoly jen zaškrtávat; Ondřej chce přesouvat
jako v MindNode: chytit úkol a pustit ho pod jiný úkol, změnit
úroveň, pořadí.

1. MAPA ÚKOLŮ (task-map.tsx, react-zoom-pan-pinch + dnd-kit):
   tažení uzlu; při tažení se zvýrazní cílový rodič (pustit NA
   uzel = stane se jeho podúkolem, pustit MEZI sourozence =
   změní pořadí, pustit na kořen/milník = úroveň 1). Podstrom se
   přesouvá s uzlem. Nelze pustit uzel do vlastního podstromu.
   Maximální hloubka: zachovej, co task-tree.ts dovoluje; když
   přesun hloubku překročí, uzel se vrátí a krátká hláška.
   Klávesnice: vybraný uzel + ⌘/Ctrl + šipky (←/→ úroveň, ↑/↓
   pořadí). Na telefonu dlouhý stisk → tažení, mapa se přitom
   neposouvá.
2. SEZNAM ÚKOLŮ (tasks-panel / task-row): totéž tažením za úchyt
   vlevo, s odsazením podle úrovně; vodorovný posun při tažení
   mění úroveň (jako v Things / Todoist). Stejná pravidla a stejná
   serverová akce jako mapa.
3. SERVER: jedna akce moveTask(taskId, newParentId | null,
   position) v transakci přepočítá position sourozenců a ověří
   vlastnictví i cyklus. Stav dokončení rodičů se přepočítá podle
   pravidel v task-tree.ts (rodič se všemi hotovými dětmi apod.).
   Přesun hotového úkolu pod nehotový rodič a naopak: zachovej
   stávající logiku znovuotevření.
4. Optimistická aktualizace s vrácením při chybě; animace přesunu
   (Framer Motion, reduced motion respektovat). Zpět (⌘Z) na
   poslední přesun v rámci sezení.
5. Vitest pro moveTask (cyklus, hloubka, position, dokončení);
   E2E: přesun pod jiný úkol v mapě → seznam ukazuje nové zanoření
   → přesun zpět v seznamu → mapa souhlasí.
```

---

## Kontrola fáze 17 · **Opus 5.5**

```
Zkontroluj fázi 17 podle CLAUDE.md:
- RLS crm_tasks a deal_contacts (pracovník vidí jen přiřazené
  a to, kam má právo; cizí obchod nejde připojit ani přes RPC),
- kalendářní událost deadlinu je vždy 1:1 s obchodem, bez sirotků
  po smazání obchodu, bez duplicit při rychlé změně data,
- primární kontakt v deals.contact_id vždy odpovídá deal_contacts,
- čísla dashboardu: ověř výjimky vyhráno/ztraceno u každé
  dlaždice, časová zóna uživatele u „po termínu" a „dnes",
- EN překlad: „Close Date" všude, žádné „expected close",
- moveTask: cyklus, hloubka, souběh dvou přesunů,
- last_activity_at se mění při každé události historie,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 12.4`

=== ZAČÁTEK
- [ ] 17.1 | architect |
- [ ] 17.2 | architect |
- [ ] 17.3 | architect |
- [ ] 17.4 | architect |
- [ ] 17.5 | architect |
- [ ] K17 | reviewer |
- [ ] STOP | Konec fáze 17. Projdi s Vášou: založ obchod z Cold Callingu, otevři nový detail obchodu, přidej druhý kontakt s poznámkou, zadej deadline a najdi ho v kalendáři, založ tři úkoly s různými termíny a trváním, jeden označ Hotovo s poznámkou. V sekci Úkoly zkus filtry Dnes, Po termínu a Trvání do 30 min. Nad pipeline rozklikni každou dlaždici a naprav jeden obchod, ať zezelená; totéž na nástěnce. V kontaktu otevři sekci Obchody. V milnících přesuň úkol pod jiný v mapě i v seznamu. Přepni do EN a zkontroluj „Close Date". Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh` nebo `/clear` a `/pokracuj`. První poběží 17.1.
