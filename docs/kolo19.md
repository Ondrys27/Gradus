# Programovatelné odměny a přehled administrace z widgetů — kolo 19

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Do `docs/plan.md` přidej tohle PŘED sekci `## Odloženo` (když tam není, na konec)

=== ZAČÁTEK

---

# FÁZE 29 — Poznámky majitele z 24. 11.

*Navazuje na odměny (28.2) a widgety (28.5, 28.6). Migrace jen přidávací, texty do en.json i cs.json, Vitest + E2E, doplnit CLAUDE.md a docs/funkce.md.*

## Prompt 29.1 — Odměny: vlastní spouštěče a nastavení větou · **Opus 5.5**

```
Plán odměn (28.2) má pevné druhy pravidel. U Cold Callingu se dnes
odměna za schůzku váže na konkrétní přesun (z Neoslovených /
Nezvedá dál). Majitel chce: odměna, když se kontakt přesune
KAMKOLI → do Domluvená schůzka, a obecně ať si každý nastaví
spouštěč podle sebe. Nejdřív zjisti, jak přesně je per_meeting
dnes napojený, a napiš to do souhrnu.

1. OBECNÝ SPOUŠTĚČ. Nový druh pravidla „event" s definicí
   { událost, podmínky, odměna }:
   - událost z katalogu (jeden zdroj v kódu, rozšiřitelný):
     Cold Calling: přesun kontaktu (odkud: kterákoli | vybrané
     tabulky | kromě vybraných; kam: vybrané tabulky) — tabulky
     jsou uživatelovy vlastní, pravidlo je drží podle id a přežije
     přejmenování; smazaná tabulka pravidlo označí „potřebuje
     úpravu". Pipeline: přesun obchodu mezi fázemi (odkud/kam
     stejně), výhra, prohra. Úkoly: splnění (v termínu / kdykoli),
     podle štítku nebo typu. Kalendář a plánovač: schůzka
     domluvena, proběhla, rezervace přijata. Kontakty: nový
     kontakt, kontakt s vyplněným telefonem/e-mailem. Hovor:
     zaznamenaný hovor, hovor delší než X. Faktury: vystavena,
     zaplacena. Čas: odpracovaná hodina. Milník: dokončen.
   - podmínky (všechny musí platit): kdo to udělal (pracovník
     sám / kdokoli na jeho záznamu), hodnota obchodu od–do,
     skupina/štítek, „jen poprvé u daného kontaktu/obchodu"
     (výchozí zapnuto — přesun tam a zpět a znovu tam nezaplatí
     dvakrát), časové okno.
   - odměna: pevná částka | procento z hodnoty obchodu/faktury |
     částka za jednotku (hodina, minuta hovoru) | stupně (1.–10.
     schůzka v měsíci 500 Kč, 11. a další 800 Kč) | strop za
     období | bonus při dosažení počtu („10 schůzek v měsíci =
     +5 000 Kč").
   Stávající druhy (per_meeting, deal_percent, task_default…)
   převeď na tenhle obecný tvar migrací; chování existujících
   plánů se nesmí změnit (test před/po na stejných událostech).
   Výchozí šablona Cold caller nově: „jakýkoli přesun do
   Domluvená schůzka, jen poprvé u kontaktu".
2. EDITOR PRAVIDLA jako věta se skládacími částmi: „Když
   [pracovník] [přesune kontakt] [odkudkoli] do [Domluvená
   schůzka], dostane [500 Kč], [jen poprvé u kontaktu], nejvýš
   [20 000 Kč měsíčně]." Každá hranatá část je klikací výběr.
   Pod větou „Vyzkoušet": spočítá, kolik by pravidlo vyneslo
   za posledních 30 dní na skutečných datech pracovníka (suchý
   běh, nic nezapisuje) a vypíše prvních 10 událostí, které by
   zaplatilo. Upozornění na překryv dvou pravidel na stejnou
   událost (obě zaplatí? volba „sčítat / jen nejvyšší").
3. NASTAVENÍ VĚTOU (AI). Pole „Popiš, jak chceš odměňovat"
   v plánu odměn i přes Gradyho: majitel napíše např. „Cold
   callerům dávám 400 za každou domluvenou schůzku, 1 000 navíc
   když schůzka proběhne, a 3 % z obchodu, který z toho vznikne,
   maximálně 30 tisíc měsíčně." Grady (funkce reward_setup,
   strukturovaný výstup proti katalogu událostí a skutečným
   tabulkám/fázím prostoru) navrhne pravidla → zobrazí se jako
   věty z bodu 2 s výsledkem „Vyzkoušet" u každého → majitel
   upraví a potvrdí. Nic se neuloží bez potvrzení. Co z popisu
   nejde vyjádřit, Grady řekne a nabídne nejbližší možnost;
   nejasnosti (která tabulka je „schůzka"?) se zeptá výběrem.
   Jde i upravovat existující plán („zvyš provizi na 5 %").
   Totéž je dostupné jako operace pro MCP (28.8).
4. Výpočet: jedna událost × pravidlo = nejvýš jeden záznam;
   „jen poprvé" hlídá index; stupně a bonusy se přepočítají na
   konci období bez duplicit; storno při vrácení přesunu, pokud
   není vyplaceno. Pracovník vidí svá pravidla jako věty a u
   bonusu postup („7 z 10 schůzek").
5. Vitest pro katalog, podmínky, stupně, „jen poprvé", migraci
   starých pravidel a překlad popisu na pravidla (mock modelu);
   E2E: pravidlo „odkudkoli do Domluvená schůzka" → přesun z
   Ozvat se → odměna vznikne; zpět a znovu → nevznikne druhá.
```

---

## Prompt 29.2 — Administrace: přehled z widgetů a chyby bez e-mailů · **Opus 5.5**

```
Úvodní stránka administrace (/admin) se přestaví na plochu
z widgetů jako Přehled v aplikaci, a chyby přestanou chodit
e-mailem — budou svítit tam.

1. SDÍLENÉ JÁDRO. Vyčleň jádro widgetů z 28.5 (mřížka, režim
   úprav, galerie, rozklik, ukládání rozložení, víc záložek) do
   sdílené vrstvy, kterou použije aplikace i administrace; chování
   Přehledu v aplikaci se nesmí změnit (jeho E2E beze změny).
   Administrace má vlastní registr widgetů a rozložení v
   admin_dashboard_layouts (na administrátora; víc záložek).
   Data widgetů jdou přes stávající serverové dotazy administrace
   (guard, role, audit pohledu jednou za otevření stránky, ne za
   widget). Widget, na který omezený admin nemá právo, neexistuje.
   Widgety respektují horní lištu období a filtrů; každý může mít
   vlastní období v nastavení („vždy dnes").
2. CHYBY BEZ E-MAILŮ. Výchozí nastavení upozornění: e-maily
   vypnuté (app_settings error_alerts.mode = off; existující
   nastavení majitele přepni na off migrací). Volby zůstanou:
   vypnuto · jen kritické (stejná chyba u 5+ uživatelů za hodinu,
   nebo pád přihlášení, plateb, registrace) · denní souhrn ·
   každá chyba. Místo e-mailu: widget Chyby (nové dnes, celkem
   otevřených, zasažení uživatelé, nejčastější tři s kódem,
   „vrátily se"), červený odznak s počtem nových v menu u Provoz
   → Chyby a v titulku karty, a zvonek v administraci. Rozklik
   widgetu = seznam nových chyb s rychlou změnou stavu; klik
   na chybu vede do logu (27.2).
3. SADA WIDGETŮ ADMINISTRACE (každý ve 2–3 velikostech, čísla
   z existujících sekcí, nic nového nepočítej dvakrát):
   Provoz: Chyby · Zdraví systému (cron úlohy, proměnné prostředí,
   fronta e-mailů, Stripe webhook, kurzy) · Poslední nasazení ·
   Hlášení a zpětná vazba (nová) · Odezva aplikace.
   Lidé: Noví uživatelé (dnes, 7 dní, trend) · Aktivní uživatelé
   (den/týden/měsíc) · Trychtýř aktivace · Retence · Uživatelé
   v ohrožení (neaktivní platící) · Zkoušky končící do 7 dní ·
   Země a jazyky · Poslední registrace (seznam).
   Peníze: Tržby (dnes, měsíc, MRR, trend) · Platící podle tarifu ·
   Nové a zrušené předplatné · Neúspěšné platby · Promo kódy
   a provize k vyplacení · Náklady vs. tržby (marže).
   AI: Spotřeba AI (dnes, měsíc, proti stropu) · Cena na aktivního
   uživatele · Nejdražší uživatelé · Podle funkce a modelu ·
   Úsporný režim (stav) · Kde ušetřit (z 28.9).
   Produkt: Nejpoužívanější funkce · Tutoriál (dokončení) · Hra
   (úrovně, série) · Plánovač (rezervace) · MCP (připojení, akce) ·
   Spokojenost (dotazník).
   Správa: Audit (poslední akce administrátorů) · Čeká na mě
   (výplaty provizí, hlášení, návrhy překladů, koncept tarifů) ·
   Rychlé akce (najít uživatele, promo kód, zveřejnit tarify).
   „Kolik aplikace vydělala" = tržby ze Stripe (payments), při
   testovacím režimu jasně označené „testovací data".
4. VÝCHOZÍ ROZLOŽENÍ (záložka Přehled): Chyby (L) · Zdraví
   systému (M) · Noví uživatelé (M) · Aktivní uživatelé (M) ·
   Tržby (L) · Spotřeba AI (M) · Náklady vs. tržby (M) · Hlášení
   (M) · Čeká na mě (M) · Zkoušky končící (S) · Neúspěšné
   platby (S). Připravené další záložky ke vložení jedním klikem:
   Provoz, Peníze, AI, Lidé. Majitel může nastavit výchozí
   rozložení pro nové administrátory. Dnešní obsah úvodní stránky
   zůstává dostupný jako widgety, nic se neztratí; ⌘K a Nápověda
   (27.2) o widgetech ví.
5. Živost: widgety Chyby, Zdraví, Noví uživatelé a Tržby se
   obnovují samy každých 60 s, když je karta viditelná; ostatní
   podle stávajícího intervalu administrace.
6. Vitest pro registr a práva, E2E: uměle vyvolaná chyba se do
   minuty objeví ve widgetu a v odznaku, e-mail neodešel;
   přeskládání a druhá záložka přežijí odhlášení; omezený admin
   nevidí widgety Peníze.
```

---

## Prompt 29.3 — Přehled administrace: řemeslo · **Fable 5.1**

```
Widgety administrace z 29.2 dotáhni na stejnou úroveň jako
widgety aplikace (28.6), stejným jazykem, ale s vyšší hustotou
dat — je to pracovní nástroj. Skill frontend-design a dataviz.

1. Snímky před (1440 a 390 px) do docs/admin-widgets/before/.
2. Každý widget × velikost vlastní kompozice: S = jedno číslo
   se stavem (v pořádku / pozor / problém), M = číslo + trend
   proti minulému období, L = graf nebo seznam s akcí. Barva
   znamená stav, ne dekoraci: červená jen když něco potřebuje
   zásah (chyby, neúspěšné platby, strop AI), jinak neutrální.
   Nula chyb je zelená a klidná.
3. Widget Chyby je nejdůležitější: na první pohled jasné, jestli
   je klid, nebo hoří; nová chyba se objeví s krátkým zvýrazněním,
   ne s poplachem.
4. Stejný pohyb jako v aplikaci (režim úprav, galerie, rozklik),
   reduced motion, 60 fps s 25 widgety. Telefon: administrace
   na 390 px použitelná jednou rukou.
5. Snímky po, E2E projdou (jen selektory).
```

---

## Kontrola fáze 29 · **Opus 5.5**

```
Zkontroluj fázi 29 podle CLAUDE.md:
- odměny: migrace starých pravidel nezměnila výsledek žádného
  existujícího plánu; „jen poprvé" drží i při souběhu; stupně
  a bonusy bez duplicit; návrh od AI nic neuloží bez potvrzení
  a odkazuje jen na tabulky a fáze daného prostoru; suchý běh
  nic nezapisuje; pracovník nevidí pravidla jiných,
- administrace: data widgetů jen přes guard, omezený admin bez
  peněz a osobních údajů, audit se nezahltí (jeden záznam na
  otevření), e-maily o chybách se opravdu neposílají při mode
  off a „jen kritické" má test,
- sdílené jádro widgetů nezměnilo Přehled v aplikaci,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 28.10`

=== ZAČÁTEK
- [ ] 29.1 | architect | env: ANTHROPIC_API_KEY
- [ ] 29.2 | architect |
- [ ] 29.3 | designer |
- [ ] K29 | reviewer |
- [ ] STOP | Konec fáze 29. V plánu odměn napiš větou, jak chceš odměňovat cold callera, zkontroluj navržená pravidla a „Vyzkoušet", potvrď a přesuň kontakt z Ozvat se do Domluvená schůzka — odměna musí vzniknout jen jednou. V administraci si poskládej přehled, přidej záložku Peníze, vyvolej chybu a ověř, že svítí ve widgetu a nepřišel e-mail. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek`. První poběží 29.1.
