# Analytika — kolo 4

Instrukce pro Claude Code. Proveď kroky 1 až 5 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj`.

---

## Krok 1 — Vytvoř soubor `docs/metrics.md`

=== ZAČÁTEK
# Katalog metrik Gradusu

Závazný seznam toho, co se měří a jak. Každá metrika odsud musí mít definici v `src/lib/analytics/metrics.ts` a místo v administraci.

## Obecná pravidla

- **Interní účty se nepočítají.** Majitel, demo účet a testovací účty mají `is_internal = true` a jsou ze všech metrik vyloučené, pokud se v administraci výslovně nezapnou.
- **Aktivní uživatel** = aspoň jedna smysluplná akce za období (založení, úprava, přesun, odeslání, dokončení). Samotné přihlášení nebo zobrazení stránky nestačí.
- **Žádný obsah.** Měří se počty, časy, stavy a typy — nikdy jména, telefony, e-maily, názvy firem a obchodů, texty úkolů, zprávy Jarvisovi ani poznámky.
- **Segmenty** pro všechny metriky: plán (beta / zkušební / solo / pro / tým), režim (hra / běžný), obor, jazyk, země, role (majitel / pracovník), zařízení, týden registrace.
- **Peníze v různých měnách** se nesčítají dohromady. Hodnoty obchodů a transakcí se zobrazují po měnách.

## 1. Růst a uživatelé

- Registrace — nové účty za období, po dnech
- Celkem uživatelů — kumulativně
- Čekací listina — přihlášení, potvrzení, míra potvrzení, převod na účet
- DAU, WAU, MAU — aktivní za den, 7 a 30 dní
- Stickiness — DAU / MAU
- Noví vs. vracející se aktivní
- Rozdělení podle plánu, režimu, oboru, jazyka, země, zařízení, prohlížeče
- Pracovníci — počet, aktivní, průměr na majitele

## 2. Aktivace

- Trychtýř: registrace → onboarding dokončen → první milník → první splněný úkol → první kontakt → první obchod → první domluvená schůzka → první vyhraný obchod. Procento a medián času mezi kroky.
- Doba do hodnoty — medián času od registrace k první domluvené schůzce
- Onboarding — dokončení a krok, na kterém lidé odpadají
- Jarvisův průvodce — dokončen / přeskočen / na kterém kroku
- Aktivovaný uživatel — do 7 dnů od registrace aktivní aspoň 3 různé dny a ve 2 různých sekcích; podíl

## 3. Retence a zapojení

- Kohortová tabulka — týdny registrace × % aktivních v týdnu 1 až 12
- Retence D1, D7, D30
- Odpadlí — dřív aktivní, 14 dní bez akce
- Relace na uživatele za den a týden, délka relace (medián, p90), čas v aplikaci za den
- Aktivní dny v týdnu — rozdělení 1 až 7
- Kdy aplikaci používají — heatmapa den v týdnu × hodina
- Návraty vyvolané Jarvisovou bublinou nebo e-mailem

## 4. Funkce

U každé sekce: adopce (% aktivních, kteří ji použili), počet akcí, akce na uživatele, trend.

**Milníky** — vytvořené (z kapitoly / vlastní), dokončené, míra a medián doby dokončení, úkoly a podúkoly vytvořené a splněné, hloubka stromu, podíl pohledů Seznam / Mapa / Cesta, vyplněná odměna (%), vyžádané AI hodnocení

**Pipeline** — obchody vytvořené, přesuny, výhry, prohry, míra výhry, průměrná a celková hodnota po měnách, medián času ve fázi, uživatelé s upravenými fázemi, použité „znovu oslovit"

**Kontakty** — přidané ručně / vygenerované, přesuny mezi tabulkami, vytvořené vlastní tabulky a pole, vyplněnost e-mailu, telefonu a webu (%), zachycené duplicity, zaznamenané aktivity

**Generování kontaktů** — dávky, vyžádáno / uloženo / duplicity, chybovost podle kódu chyby, uživatelé na denním a měsíčním stropu (%), nejčastější hledané obory jako souhrn normalizovaných klíčových slov (top 20, bez vazby na uživatele)

**Cold Calling** — odvolané hodiny celkem a na uživatele, relace časovače, automatické pauzy (%), oslovení (přesuny z Neoslovených), konverze oslovení → schůzka, → neúspěch podle důvodu, schůzky na hodinu volání

**Kalendář** — události podle typu, připojený Google (%), chyby synchronizace

**Finance** — transakce, vystavené faktury, připojený Fakturoid (%), automatické platby

**Pracovníci** — pozvánky odeslané / přijaté / vypršelé, aktivní pracovníci, zadané a splněné úkoly, schválené výdělky

**Vyhledávání** — hledání, otevřené výsledky, míra hledání bez výsledku, ⌘K vs. kliknutí, použité rychlé akce

**E-mail** — odeslané, vyžádané a použité AI návrhy

**Nastavení** — rozdělení jazyka, měny, země, motivu; vypnuté animace, zvuky a Jarvisova iniciativa

## 5. AI a Jarvis

- Volání podle funkce (chat, hodnocení milníku, noční analýza, hlídání, návrh e-mailu, rozbor schůzek, nastavení odměn) a podle modelu
- Tokeny vstup / z mezipaměti / výstup, míra zásahu mezipaměti
- Náklady v USD a Kč — celkem, na aktivního uživatele, na funkci, 10 nejnákladnějších uživatelů (jen identifikátor a plán)
- Konverzace a zprávy na uživatele, délka konverzace
- Latence p50 a p95, chybovost podle kódu
- Soubory — počet, typy, velikost, odmítnuté a proč
- Proaktivní bubliny — zobrazeno, Udělat, Ukázat, Později, Zavřít, bez reakce; míra přijetí podle typu (postřeh / návrh / otázka)
- Automatické akce Jarvise a kolik z nich uživatel vrátil
- Hodnocení odpovědí palcem nahoru / dolů
- Uživatelé na AI stropu (%)

## 6. Hra

- Podíl hra / běžný režim, přepnutí oběma směry a kdy po registraci
- Rozdělení úrovní, XP za den, zdroje XP
- Kapitoly — dokončení podle pořadí (kde se lidé zasekávají), podle oboru
- Odemčení sekcí — doba od registrace
- Odznaky — rozdělení, nejvzácnější
- Série — rozdělení délek, zamrazení
- Zobrazené oslavy

## 7. Náklady a ekonomika

- Náklady na AI, Google Places (požadavky × cena z konfigurace), e-maily (počet × cena)
- Náklad na aktivního uživatele za měsíc, podle plánu
- Odhad marže proti ceníku
- Zkušební období — běžící, končící tento týden, vypršelá, klepnutí na „Mám zájem", převod

## 8. Technické zdraví

- Chybovost serverových rout a funkcí, nejčastější chyby
- Latence stránek a rout p50 a p95
- Chyby v prohlížeči podle stránky
- Naplánované úlohy — poslední běh, úspěch, doba
- Integrace — chybovost Google Places, Fakturoid, Resend, Google Kalendář, Anthropic

## 9. Zpětná vazba

- Nápady od uživatelů — seznam a stav
- Otázka po 7 dnech používání: „Jak pravděpodobně bys Gradus doporučil?" 0–10 a volitelný komentář → NPS, rozdělení, komentáře
- Hodnocení Jarvisových odpovědí

## 10. Detail uživatele

Plán a stav, registrace, poslední aktivita, obor, režim, úroveň, aktivní dny, časová osa událostí (typy, ne obsah), využití sekcí, spotřeba a náklad AI, generování, pracovníci, zpětná vazba. Bez obsahu kontaktů, obchodů, úkolů a zpráv.

## 11. Průzkumník

Libovolná událost z katalogu × výpočet (počet, unikátní uživatelé, součet nebo průměr číselné vlastnosti) × období × seskupení (den / týden / měsíc) × segment. Pohledy jdou uložit.
=== KONEC

---

## Krok 2 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 11 — Analytika a administrace

## Prompt 11.1 — Měření událostí · **Opus 5.5**

```
Postav vrstvu, která měří, jak se Gradus používá. Přečti si nejdřív
docs/metrics.md — všechno, co je tam, musí jít z naměřených dat spočítat.

KATALOG UDÁLOSTÍ
src/lib/analytics/events.ts: typovaný seznam všech událostí aplikace
s zod schématem vlastností pro každou. Vlastnosti smí obsahovat jen
identifikátory, výčty, čísla a pravdivostní hodnoty. ŽÁDNÝ volný text,
jména, e-maily, telefony, názvy firem, obchodů ani úkolů, žádné obsahy
zpráv. Schéma to musí vynutit, ne jen doporučit.

ULOŽENÍ
Tabulka analytics_events (user_id, owner_id pro pracovníky, event,
props jsonb, session_id, device, locale, plan_key, game_mode, created_at),
indexy na (event, created_at) a (user_id, created_at). Bez klientských
pravidel pro zápis. Existující zápisy do usage_events přesměruj sem,
usage_events ponech jen ke čtení historie. ai_usage zůstává, jak je.

ZÁPIS
- Server: funkce track(event, props) přes admin klienta, validuje proti
  katalogu, nikdy nevyhodí výjimku do volajícího kódu.
- Prohlížeč: route /api/t přijímá dávky událostí jen z katalogu, validuje,
  uživatele bere ze session (ne z těla požadavku), omezení 120 událostí
  za minutu na uživatele. Klient posílá dávkově a při skrytí stránky přes
  sendBeacon.

RELACE A ČAS V APLIKACI
Tabulka app_sessions (user_id, started_at, last_seen_at, device).
Prohlížeč posílá signál jednou za 60 s, jen když je karta viditelná
a uživatel v poslední minutě něco dělal. Nová relace po 30 minutách
bez signálu.

ZAPOJENÍ
Projdi celou aplikaci a zapoj události pro všechno, co docs/metrics.md
potřebuje: zobrazení sekcí, onboarding po krocích, průvodce, milníky
a úkoly včetně pohledů, pipeline, kontakty a tabulky, generování, cold
calling a časovač, kalendář, finance, pracovníky, vyhledávání, e-mail,
nastavení, Jarvise (zprávy, soubory, bubliny a reakce na ně, automatické
akce a jejich vrácení), hru (XP, úrovně, odznaky, kapitoly, přepnutí
režimu), zkušební období. První výskyty (první kontakt, první obchod…)
se počítají z událostí, nezapisuj je zvlášť.

CHYBY A VÝKON
Obal pro serverové routy a funkce, který zapíše dobu a výsledek (kód
chyby, ne zprávu s daty). Zachytávání chyb v prohlížeči přes error
boundary a window.onerror — zprávu zkrať na 200 znaků a odstraň z ní
čísla delší než 4 číslice a cokoliv, co vypadá jako e-mail. Naplánované
úlohy zapisují běh, výsledek a dobu.

INTERNÍ ÚČTY
Sloupec profiles.is_internal. Automaticky true pro majitele, demo účet
a adresy @gradus.local.

UCHOVÁVÁNÍ A SOUKROMÍ
Naplánovaná úloha maže události a relace starší 13 měsíců. Do stránky
/soukromi doplň odstavec o měření používání (co, proč, jak dlouho, že
bez obsahu). Pod registrační formulář drobnou větu s odkazem.

Testy: schéma odmítne událost s volným textem nebo neznámou vlastností,
/api/t nepřijme cizí user_id, omezení frekvence funguje. Commit po částech.
```

## Prompt 11.2 — Výpočty metrik · **Opus 5.5**

```
Postav výpočty všech metrik z docs/metrics.md.

REGISTR METRIK
src/lib/analytics/metrics.ts: každá metrika má klíč, kategorii, název
a popis česky i anglicky, jednotku, způsob výpočtu a které segmenty
podporuje. Administrace bude stavět výhradně z tohoto registru.

VÝPOČTY
SQL funkce pro metriky, které se počítají z událostí a tabulek. Interní
účty vyloučené parametrem include_internal (výchozí false). Zvlášť
funkce pro trychtýř (kroky, procenta, medián času mezi kroky), kohorty
(týden registrace × týden aktivity), retenci D1/D7/D30 a heatmapu
používání.

SOUHRNY PRO RYCHLOST
Tabulka metrics_daily (date, metric_key, segment jsonb, value) plněná
naplánovanou úlohou jednou za noc (chráněná CRON_SECRET). Dnešek se
počítá živě. Skript bun run metrics:backfill dopočítá historii z dat,
která existují. Přehled za 12 měsíců se musí načíst do 1 s.

NÁKLADY
src/config/costs.ts: kurz USD/CZK, cena Google Places za 1 000 požadavků
(výchozí 32 USD — ověř aktuální ceník Places API Text Search a uveď
zdroj v komentáři), cena e-mailu. Náklad AI ber z ai_usage. Marži počítej
proti src/config/pricing.ts.

MĚNY
Hodnoty obchodů a transakcí nikdy nesčítej přes různé měny — vracej
po měnách.

Testy s připravenými daty: DAU a MAU, aktivní uživatel bez samotného
přihlášení, retence D7, trychtýř, náklad na aktivního uživatele,
vyloučení interních účtů, měny se nesčítají. Commit.
```

## Prompt 11.3 — Přístup do administrace · **Opus 5.5**

```
Administrace poběží na /admin a uvidí ji jen majitel. Bezpečnost je
tady důležitější než pohodlí.

PŘIHLÁŠENÍ
- Vlastní přihlašovací stránka /admin/prihlaseni ve vzhledu aplikace.
- E-mail a heslo majitelského účtu plus druhý faktor: časový kód
  z autentizační aplikace (Supabase Auth MFA, TOTP). Bez druhého faktoru
  se do administrace nejde.
- Při prvním vstupu průvodce zapnutím druhého faktoru: QR kód, ověření
  kódem, doporučení přidat druhé zařízení jako zálohu.
- Omezení pokusů: po 5 chybných pokusech 15 minut pauza.
- Po každém přihlášení do administrace e-mail majiteli přes Resend
  s časem a zařízením.

OCHRANA
- Middleware i každá serverová funkce administrace ověří roli owner
  A úroveň přihlášení aal2. Kdo nesplní, dostane 404 — ne 403 a ne
  přesměrování. Administrace navenek neexistuje.
- /admin nikde neodkazuj, noindex, vyřazeno ze sitemap a robots.
- Neaktivita 30 minut odhlásí z administrace, nejpozději po 8 hodinách
  nové přihlášení.
- Data administrace se čtou admin klientem výhradně na serveru po ověření.
  Do prohlížeče jdou jen hotová čísla a grafy, nikdy surové tabulky.
- Tabulka admin_audit: kdo, kdy, který pohled nebo export, otisk IP.
  Zobrazená v administraci.

Testy: běžný uživatel dostane 404, majitel bez druhého faktoru 404,
majitel s aal2 projde, export se zapíše do auditu. Commit.
```

## Prompt 11.4 — Administrace: přehled, růst, aktivace, retence · **Opus 5.5**

```
Postav rozhraní administrace — první část. Stejný design systém jako
aplikace, ale hustší a zaměřený na data. Hodnoty ber výhradně z registru
metrik.

ROZVRŽENÍ
Vlastní layout: sidebar s kategoriemi Přehled, Růst, Aktivace, Retence,
Funkce, AI a Jarvis, Hra, Náklady, Zdraví, Zpětná vazba, Uživatelé,
Průzkumník, Audit. Nahoře společné ovládání pro všechny stránky:
- období: Dnes, 7 dní, 30 dní, 90 dní, 12 měsíců, vlastní rozsah
- porovnání s předchozím obdobím (rozdíl v % u každého čísla)
- segmenty (plán, režim, obor, jazyk, země, role, zařízení)
- přepínač „včetně interních účtů", výchozí vypnutý, při zapnutí
  výrazné upozornění
- automatické obnovení každých 5 minut
Stav ovládání v adrese stránky, ať jde pohled uložit do záložek.

PŘEHLED
Dlaždice: registrace, DAU, WAU, MAU, stickiness, míra aktivace,
retence D7, náklad AI, náklad na aktivního uživatele, NPS. Každá
s miniaturním grafem a rozdílem proti minulému období. Pod nimi hlavní
graf aktivních uživatelů a registrací.

RŮST, AKTIVACE, RETENCE
Podle docs/metrics.md. Trychtýř jako vodorovné pruhy se zúžením
a procentem odpadnutí mezi kroky a mediánem času. Kohorty jako
teplotní mapa (tyrkysová sytost podle %). Retenční křivky. Heatmapa
používání den × hodina.

GRAFY
Jedna sdílená komponenta: přiblížení tažením přes oblast, kolečko
s normalizovaným krokem (stejně klidné jako mapa úkolů), dvojklik
vrátí celé období, popisky ve vzhledu aplikace, přepínání řad v legendě,
export PNG a CSV. Export se zapíše do auditu.

Kostry při načítání, prázdné stavy s vysvětlením, že data přibydou.
Commit po částech.
```

## Prompt 11.5 — Administrace: ostatní sekce · **Sonnet 5**

```
Dokonči administraci podle docs/metrics.md, se stejným ovládáním
a komponentami jako v předchozím promptu.

FUNKCE — záložky podle sekcí aplikace, u každé adopce, akce, akce
na uživatele, trend a metriky ze seznamu.
AI A JARVIS — volání podle funkce a modelu, tokeny, mezipaměť, náklady,
latence, chyby, soubory, bubliny s mírou přijetí, automatické akce,
hodnocení odpovědí, 10 nejnákladnějších uživatelů s odkazem na detail.
HRA, NÁKLADY, ZDRAVÍ — podle katalogu. V Nákladech tabulka náklad na
aktivního uživatele podle plánu vedle ceny a marže.
ZPĚTNÁ VAZBA — nápady se stavy (nový, viděno, plánováno, hotovo),
NPS s rozdělením a komentáři, hodnocení Jarvise.
UŽIVATELÉ — tabulka s hledáním podle identifikátoru a filtry, řazení
podle aktivity a nákladů. Detail podle bodu 10 v katalogu. Přepínač
is_internal u uživatele. Žádný obsah dat uživatele.
PRŮZKUMNÍK — výběr události, výpočtu, seskupení a segmentu, graf
a tabulka, uložené pohledy.
AUDIT — tabulka z admin_audit.

V APLIKACI DOPLŇ
- Otázku na doporučení po 7 dnech používání: jednou, nenápadná karta
  na dashboardu se škálou 0–10 a volitelným komentářem, jde zavřít.
- Palec nahoru a dolů u Jarvisových odpovědí, pokud ještě není.

Export CSV ze všech tabulek, zapsaný do auditu. Administrace použitelná
i na telefonu. Všechny texty v obou jazycích. Commit po částech.
```

## Kontrola fáze 11 · **Opus 5.5**

```
Zkontroluj kolo 4. Priority:
1. /admin: zkus se dostat dovnitř jako běžný uživatel, jako pracovník,
   jako majitel bez druhého faktoru, přímým voláním serverových funkcí
   a rout administrace. Všude 404.
2. Žádná událost v analytics_events neobsahuje osobní údaje ani obsah
   — projdi katalog, všechna volání track a vzorek uložených dat.
3. /api/t nejde zneužít k zápisu za jiného uživatele ani k zahlcení.
4. Interní účty jsou ve výchozím stavu vyloučené všude.
5. Měny se nikde nesčítají.
6. Přehled za 12 měsíců se načte do 1 s.
Oprav nálezy, pusť lint, test a build.
```

=== KONEC

---

## Krok 3 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 11.1 | architect |
- [ ] 11.2 | architect |
- [ ] 11.3 | architect | env: RESEND_API_KEY
- [ ] 11.4 | architect |
- [ ] 11.5 | builder |
- [ ] K11 | reviewer |
- [ ] STOP | Konec kola 4. Připrav si v telefonu autentizační aplikaci (Google Authenticator, 1Password nebo podobnou). Otevři /admin/prihlaseni, přihlas se majitelským účtem a zapni druhý faktor. Proklikej všechny sekce administrace. Pak v jiném prohlížeči použij aplikaci jako běžný uživatel pár minut a ověř, že se v administraci objevila aktivita — a že tvůj vlastní účet ve výchozím stavu vidět není. Zkus /admin v anonymním okně: musí být 404.
=== KONEC

---

## Krok 4 — Uprav `CLAUDE.md`

a) Do sekce Struktura přidej:
`- src/app/(admin)/ — administrace na /admin, jen majitel s druhým faktorem`
`- src/lib/analytics/ — katalog událostí (events.ts), registr metrik (metrics.ts), track()`
`- docs/metrics.md — závazný katalog metrik`

b) Do Pravidel přidej podsekci `### Analytika a administrace`:
`- Události jen z katalogu events.ts. Vlastnosti jen identifikátory, výčty, čísla, pravdivostní hodnoty — nikdy volný text, jména, kontakty, názvy ani obsah zpráv.`
`- Zápis jen přes track() na serveru nebo /api/t, které bere uživatele ze session. Do analytics_events nikdy nezapisuje klient přímo.`
`- Interní účty (profiles.is_internal) jsou z metrik ve výchozím stavu vyloučené.`
`- Měny se v metrikách nesčítají.`
`- /admin: role owner + aal2 (TOTP), jinak 404. Data administrace jen na serveru přes admin klienta po ověření, každý pohled a export do admin_audit.`
`- Nová funkce v aplikaci = nové události v katalogu a případně nová metrika v docs/metrics.md.`
`- Události a relace se mažou po 13 měsících.`

---

## Krok 5 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo, že má napsat `/clear` a pak `/pokracuj`, a že by tohle kolo mělo být hotové a nasazené dřív, než pustí první beta testery — měření nejde zpětně dopočítat.
