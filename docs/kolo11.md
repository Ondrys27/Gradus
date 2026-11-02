# Nastavení, Jarvisův souhrn, seznam úkolů — kolo 11

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 18 — Po čtvrtém testování

## Prompt 18.1 — Přesouvání úkolů v seznamu jako v mapě · **Opus 5.5**

```
Přesouvání úkolů v mapě (17.5) je dobré. V seznamu ne: nejde
přesouvat tak volně jako v mapě. Cíl: v seznamu jde udělat každý
přesun, který jde v mapě, a stejně snadno.

1. Nejdřív zjisti, co přesně v seznamu nejde, a zapiš to do
   souhrnu. Pravděpodobně: tažení umí jen pořadí mezi sousedy
   a úroveň jen o jednu; nejde pustit úkol POD konkrétní úkol
   (stát se jeho dítětem) kdekoli v seznamu; nejde přesunout pod
   sbalený rodič; podstrom se netáhne s úkolem; vodorovný posun
   pro změnu úrovně se těžko trefuje.
2. Přepiš tažení v seznamu (tasks-panel, task-row, dnd-kit):
   - táhne se celý podstrom (sbalený do jedné „karty" s počtem
     podúkolů),
   - během tažení seznam ukazuje živou vkládací linku; její
     odsazení = cílová úroveň; svislá poloha = cílový rodič
     a pořadí, úroveň se určuje z vodorovného posunu kurzoru
     s prahem půl odsazení, takže se trefí i o dvě úrovně naráz,
   - pustit přímo NA řádek (střed řádku, zvýrazní se) = stát se
     posledním dítětem toho úkolu — jako v mapě; sbalený rodič se
     při přidržení nad ním po 600 ms rozbalí,
   - zakázaný cíl (vlastní podstrom, přes maximální hloubku) je
     šedý a pustit nejde,
   - stejná serverová akce moveTask jako mapa; po puštění se
     mapa i seznam shodují.
3. Bez myši: na každém řádku nabídka „Přesunout…" (⋯) se
   stromovým výběrem cílového rodiče a pozice; ⌘/Ctrl + šipky
   zůstávají. Na telefonu dlouhý stisk, seznam se při tažení
   u okrajů posouvá sám.
4. Vitest pro výpočet cíle z polohy kurzoru (úroveň, rodič,
   index), E2E: v seznamu přesun úkolu pod úkol o tři řádky níž
   a o dvě úrovně hloub → mapa souhlasí → zpět přes nabídku
   Přesunout.
```

---

## Prompt 18.2 — Jarvisův souhrn při prvním přihlášení dne a nové frekvence · **Opus 5.5**

```
1. SOUHRN PŘI PRVNÍM PŘÍCHODU DNE. Když uživatel přijde do
   aplikace poprvé v daném dni (v jeho časovém pásmu; sloupec
   profiles.last_daily_brief_on), Jarvis hned po načtení nástěnky
   sám vyskočí s aktuálním souhrnem dne. „Aktuální" znamená:
   souhrn se počítá v tu chvíli z živých dat (úkoly po termínu,
   dnešní úkoly a schůzky, dlaždice pipeline z 17.3, faktury po
   splatnosti, včerejší výsledky), ne z ranního cronu; když cron
   už dnes brief vytvořil, použije se jen pokud briefingStale()
   říká, že data sedí, jinak se přegeneruje. Před zobrazením
   ověř fakta proti databázi (jako u bubliny v bdbca08). Jarvis
   se neukáže, když uživatel běží v průvodci, v prohlídce, nebo
   když je ve tichých hodinách; pak počká na další stránku.
   Uživatel ho zavře nebo klikne na položku; druhé přihlášení
   ve stejný den už souhrn neukazuje. Vypnutý Jarvis
   (jarvis_proactive = false) = nic. Nový účet: první souhrn až
   druhý den, ať nepřekáží uvítání z 13.4.
2. FREKVENCE. V Nastavení → Jarvis přepiš volby na:
   často (každé 2 hodiny) · občas (každých 6 hodin) · jednou
   denně (souhrn) · jednou týdně (souhrn) · jednou měsíčně
   (souhrn). Hodnoty v proactive.ts (JARVIS_FREQUENCIES,
   GAP_HOURS, MIN_GAP_HOURS → 2 h), migrace převede staré
   often/sometimes/briefing_only na nové (often→2h,
   sometimes→6h, briefing_only→daily). U „často" a „občas" se
   Jarvis ozývá průběžně s návrhy jako dnes a navíc dostane
   souhrn při prvním příchodu dne. U „jednou denně/týdně/měsíčně"
   Jarvis sám neozývá nic kromě souhrnu: denní = souhrn dne při
   prvním příchodu; týdenní = souhrn týdne při prvním příchodu
   v pondělí (nebo první den v týdnu podle nastavení), s čísly za
   minulý týden a plánem na tento; měsíční = souhrn měsíce při
   prvním příchodu v měsíci. Ranní e-mail/briefing cron respektuje
   totéž. Naléhavé věci (úkol po termínu dnes, faktura po
   splatnosti) jsou vidět v panelu Jarvise vždy, ale nevyskakují.
3. Text souhrnu: týdenní a měsíční má jinou šablonu (co se
   povedlo, co stojí, 3 věci na tento týden/měsíc). Mockovaný
   model v testech; Vitest pro „první příchod dne" v různých
   pásmech a přes půlnoc; E2E: nastav denně → znovu přihlásit →
   souhrn; znovu přihlásit → nic. Doplň CLAUDE.md sekci Jarvis.
```

---

## Prompt 18.3 — Předplatné v nastavení (zatím bez plateb) · **Opus 5.5**

```
V Nastavení → Předplatné má uživatel vidět a spravovat svůj tarif.
Platební brána ještě není; připrav rozhraní a datový model tak, aby
se brána později jen zapojila.

1. DATA. Tabulka subscriptions (user_id prostor, plan_key,
   billing monthly|yearly, status trialing|active|past_due|
   cancelled|expired, current_period_start/end, cancel_at_period_end,
   provider null|stripe|…, provider_ref, created_at, updated_at)
   a payments (id, user_id, subscription_id, amount, currency,
   paid_at, status paid|failed|refunded, invoice_url, provider_ref).
   RLS jen čtení pro vlastníka, zápis jen server. Stávající
   trial/plan v profilu (plan.ts, PlanSnapshot) se napojí na
   subscriptions bez změny chování; migrace založí řádek každému
   prostoru podle současného stavu. Zatím žádné reálné platby —
   payments prázdné, nebo testovací řádky jen pro @gradus.local.
2. STRÁNKA Nastavení → Předplatné:
   - karta aktuálního tarifu: název, cena (z published verze
     tarifů z 15.5), období, stav (zkušební do…, aktivní, končí
     dne…), další platba,
   - Změnit tarif: výběr ze tří tarifů s měsíční/roční volbou,
     porovnání, u downgrade upozornění, co uživatel překročí
     (limity vs. jeho data); potvrzení; změna se zapíše jako
     „naplánovaná ke konci období" nebo „hned" u upgradu —
     bez brány se jen zapíše a zobrazí (status zůstává), v kódu
     jedno místo TODO(payments) pro zapojení brány,
   - Zrušit předplatné: dialog s důvodem (výběr + text), platí
     do konce období, cancel_at_period_end = true, tlačítko
     Obnovit; po konci období read_only podle CLAUDE.md,
   - Historie plateb: tabulka datum, částka, stav, stáhnout
     doklad (zatím zašedlé s tooltipem „Doklady budou dostupné po
     spuštění plateb"); prázdný stav „Zatím žádné platby",
   - fakturační údaje (jméno/firma, IČO, DIČ, adresa, e-mail
     pro doklady) — předvyplnit z invoice_profiles z 16.3.
3. Administrace: v detailu uživatele vidět předplatné a změnit
   ho ručně (majitel), do admin_audit; v Nastavení → Tarify
   počet uživatelů na tarifu.
4. Jarvis o tarifu ví (co uživatel má, kdy končí zkušebka).
   Analytika: subscription_change_requested, subscription_cancelled
   (s důvodem bez textu). Vitest pro přechody stavů; E2E:
   naplánovat downgrade → zrušit → obnovit.
   Doplň CLAUDE.md sekci Předplatné.
```

---

## Prompt 18.4 — Přehledné nastavení · **Fable 5.1**

```
Nastavení je nepřehledné. Přestav ho jako seniorní produktový
designér; použij skill frontend-design. Všechny funkce zůstávají
kromě bodu 1.

1. ODSTRANIT: sekce Integrace s testem Jarvise (jarvis-test.tsx).
   Test Jarvise přesuň do administrace → AI a Jarvis (karta
   „Vyzkoušet připojení", jen majitel). Pokud v Integracích nic
   jiného není, sekce zmizí; pokud je, zůstane bez testu.
2. DIAGNÓZA NEJDŘÍV: projdi každou sekci nastavení (snímky do
   docs/settings-redesign/before/, 1440 px i 390 px) a napiš
   docs/settings-redesign/diagnoza.md: co kde je, co se opakuje,
   co je zbytečně hluboko, co uživatel nenajde.
3. STRUKTURA: levé menu (na telefonu seznam → detail) s nejvýš
   6 skupinami, např.: Účet (profil, e-mail, heslo, dvoufázové
   ověření, jazyk, zařízení/odhlášení) · Předplatné (18.3) ·
   Jarvis (zapnutí, frekvence, tiché hodiny, hlas/styl) ·
   Vzhled a formáty (téma, animace, měna, datum, první den
   týdne, pásmo) · Práce (Cold Calling, cíle, kalendář, faktury,
   hra) · Soukromí a data (export, smazání účtu, souhlasy).
   Každá stránka: název, jedna věta co nastavuje, formulář
   v jednom sloupci max 560 px, související volby u sebe,
   popisek pod každým polem jen tam, kde není zřejmé.
4. CHOVÁNÍ: ukládání na místě (přepínače hned, textová pole po
   opuštění nebo Enter) s nenápadným „Uloženo", žádné velké
   tlačítko Uložit dole, kromě formulářů s následky (heslo,
   smazání účtu, zrušení předplatného), které mají potvrzení.
   Hledání v nastavení (pole nahoře, filtruje položky napříč
   skupinami). Odkazy na nastavení z míst v aplikaci (např.
   z Jarvise „Nastavit frekvenci") vedou přímo na položku
   a zvýrazní ji.
5. Jedna typografická škála, jedna sada odstupů, žádné karty
   v kartách, nebezpečné akce dole v červené zóně. Vše i18n,
   klávesnice a reduced motion.
6. Po dokončení snímky do docs/settings-redesign/after/, tabulka
   před/po. E2E nastavení projde (uprav selektory, ne chování).
```

---

## Kontrola fáze 18 · **Opus 5.5**

```
Zkontroluj fázi 18 podle CLAUDE.md:
- seznam a mapa úkolů dávají po každém přesunu stejný strom
  (property test: náhodné přesuny v obou, porovnat),
- souhrn při prvním příchodu dne: přesně jednou za den v pásmu
  uživatele, nikdy v průvodci/prohlídce/tichých hodinách, fakta
  ověřená před zobrazením, migrace frekvencí bez ztráty,
- subscriptions a payments: RLS jen čtení, zápis jen server,
  stav read_only po konci období, žádná cesta, jak si uživatel
  sám zapne tarif,
- test Jarvise už není v uživatelském nastavení, v administraci
  jen pro majitele,
- po přestavbě nastavení zůstala každá volba dostupná (diagnoza.md
  jako kontrolní seznam), hluboké odkazy fungují,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 18.1 | architect |
- [ ] 18.2 | architect | env: ANTHROPIC_API_KEY
- [ ] 18.3 | architect |
- [ ] 18.4 | designer |
- [ ] K18 | reviewer |
- [ ] STOP | Konec fáze 18. Projdi: v seznamu úkolů přesuň úkol pod jiný o dvě úrovně hloub a ověř mapu. Nastav Jarvise na „jednou denně", odhlas se a přihlas — musí vyskočit souhrn; podruhé už ne. Projdi nové Nastavení na počítači i telefonu, zkus hledání, v Předplatném naplánuj změnu tarifu, zruš a obnov. V administraci AI vyzkoušej test připojení. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek` nebo `/clear` a `/pokracuj`. První poběží 18.1.
