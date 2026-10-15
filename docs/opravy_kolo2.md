# Opravy — kolo 2

Instrukce pro Claude Code. Proveď kroky 1 až 4 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj`.

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 9 — Kolo 2: pracovníci, gamifikace, Jarvis

## Prompt 9.0 — Jarvis chat nefunguje · **Opus 5.5**

```
Jarvisův chat nefunguje a nemám k tomu výstup chyby. Zjisti příčinu sám
a oprav ji.

Postup: spusť vývojový server, zavolej /api/jarvis stejně, jako to dělá
rozhraní (přes curl nebo testovací skript s platnou session), a přečti si,
co se stane na serveru i co dostane klient. Projdi postupně: přítomnost
a načtení ANTHROPIC_API_KEY (ověř jen `grep -c`, hodnotu nevypisuj), názvy
modelů v kódu proti aktuálním identifikátorům Anthropic API, streamování
odpovědi (hlavičky, ukončení streamu, čtení na klientu), sestavení kontextu
z databáze (může padat na prázdných datech nového uživatele), limity podle
plánu (nový uživatel bez řádku v subscriptions nesmí dostat limit 0),
zápis do ai_usage přes admin klienta, a chyby v konzoli prohlížeče.

Oprav, co najdeš. Pak přidej do Nastavení v sekci Integrace tlačítko
„Otestovat Jarvise", které pošle krátký dotaz a zobrazí, jestli odpověď
přišla, za jak dlouho a kolik stála — ať se tohle dá příště ověřit jedním
klepnutím. Chyby z /api/jarvis musí být na klientu vidět srozumitelně,
ne jako prázdná bublina.

Napiš mi, co přesně bylo příčinou. Commit.
```

## Prompt 9.1 — Pracovníci: práva a sdílený prostor · **Opus 5.5**

```
Práva pracovníků nefungují: pracovník s rolí Caller a povoleným přístupem
ke Kontaktům a Cold Callingu kontakty nevidí. Příčina je v návrhu — ochrana
řádků i dotazy v aplikaci pouští jen řádky, kde user_id = přihlášený
uživatel, a kontakty patří majiteli. Přestav to na sdílený pracovní prostor.

MODEL
- Pracovní prostor = účet majitele. Majitel pracuje ve svém, pracovník
  v prostoru majitele, který ho pozval. Pracovník má zatím právě jeden.
- Databázová funkce current_workspace_id(): pro majitele jeho id, pro
  aktivního pracovníka owner_id z workers. SECURITY DEFINER.
- Funkce has_section_access(_owner uuid, _section text, _level text)
  SECURITY DEFINER: true pro majitele samotného, pro pracovníka podle
  worker_permissions (can_view / can_edit) a jen když je aktivní.
- Sekce pro práva: milestones, contacts, pipeline, cold_calling, calendar,
  finance. Sekce workers a settings pracovník nikdy nevidí.
- Do tabulek, kde záleží, kdo akci udělal, přidej actor_id (kdo) vedle
  user_id (čí prostor): contact_activities, contact_table_moves,
  prospecting_segments, calendar_events, deals (created_by), tasks
  (completed_by). Výchozí actor = auth.uid().

OCHRANA ŘÁDKŮ
Přepiš pravidla na všech sdílených tabulkách: čtení povoleno, když
user_id = auth.uid() NEBO has_section_access(user_id, '<sekce>', 'view');
zápis a úprava obdobně s 'edit'; mazání jen s 'edit'. Vložení: pracovník
zakládá řádky s user_id = owner_id, pravidlo to musí dovolit přes
has_section_access. Časovač: prospecting_segments pracovníka mají
user_id = owner_id a actor_id = pracovník; statistiky majitel vidí
celkem i po lidech, pracovník jen svoje. Soukromé zůstává: profily,
nastavení, XP, Jarvisovy konverzace, nápady.

APLIKACE
- Hook useWorkspace() vrací id prostoru, roli (owner / worker) a práva.
  Všechny dotazy a mutace filtrují podle prostoru, ne podle auth.uid().
  Projdi každý dotaz v src/features a oprav.
- Navigace pracovníka: jen sekce s právem čtení, plus vlastní Dashboard,
  Úkoly a Odměny. Bez práva úprav jsou akce přidat, upravit, smazat
  a přesunout schované; ochrana řádků to vynucuje i tak.
- Majitel vidí u aktivit, přesunů a odvolaného času, kdo to udělal
  (avatar pracovníka).
- Pracovník, který domluví schůzku nebo přesune kontakt, spouští pravidla
  odměn pro sebe — ověř, že reward_rules reagují na actor_id.

ROZHRANÍ PRÁV
V detailu pracovníka matice: řádky sekce, sloupce Vidí / Upravuje, přepínače.
Přednastavené role, které matici předvyplní a dají se pak upravit: Caller
(kontakty vidí i upravuje, cold calling vidí i upravuje), Obchodník (navíc
pipeline a kalendář), Asistent (milníky, kalendář, kontakty jen vidí),
Vlastní. Finance ve výchozím stavu u všech vypnuté. Změna práv se projeví
pracovníkovi okamžitě bez odhlášení.

TESTY
Vitest na has_section_access a useWorkspace. Plus skript, který se dvěma
testovacími účty (majitel, pracovník) ověří přes RLS: pracovník s právem
vidí kontakty majitele, bez práva nevidí, bez práva úprav nezapíše,
nikdy nevidí finance ani nastavení majitele.

Napiš do CLAUDE.md sekci Pracovní prostor s těmito pravidly. Commit.
```

## Prompt 9.2 — Dashboard: graf příjmu · **Sonnet 5**

```
V okně detailu dlaždice Příjem za tento měsíc přidej graf, který jde
přibližovat.

Nahoře přepínač Měsíc / Rok. Měsíc: sloupce po dnech aktuálního měsíce,
příjmy tyrkysově, pod nimi tenčí výdaje růžově, kumulativní linka příjmů
zlatě. Rok: po měsících, 12 sloupců.

Přibližování: pod grafem posuvný výběr (Brush z Recharts), kterým uživatel
vybere úsek; kolečkem myši nad grafem se přibližuje kolem kurzoru, tažením
se posouvá, na telefonu dvěma prsty. Tlačítka plus, minus a Reset. Po
přiblížení se přepočítají souhrnná čísla nad grafem na vybraný úsek.
Najetí na sloupec ukáže den, příjmy, výdaje a bilanci, popisek ve
vzhledu aplikace. Pod grafem seznam transakcí vybraného úseku.

Stejný graf s přibližováním použij i ve Financích místo stávajícího.
Formátování přes format.ts, texty do překladů. Commit.
```

## Prompt 9.3 — Gamifikace: jádro · **Opus 5.5**

```
Postav kompletní herní systém Gradusu. Tohle je jádro — data, pravidla
a logika. Rozhraní přijde v dalším promptu. Pravidla zapiš do CLAUDE.md
do nové sekce Hra.

DVA REŽIMY
profiles.mode: game | tool. Volí se v onboardingu, mění v Nastavení → Hra.
- game: XP, úrovně, odemykání, cesta podle oboru, odznaky, oslavy
- tool: všechno odemčené, žádné XP ani odemykání, oslavy jen tiché,
  Jarvis zůstává. XP a postup v databázi zůstávají, při návratu do game
  se obnoví. Přepnutí do game u uživatele s existujícími daty: sekce,
  které už používá, zůstanou odemčené.

CESTY PODLE OBORU
Tabulky paths (key, name json {en,cs}, description json, icon, industries
text[]), path_milestones (path_key, chapter int, position, title json,
description json, xp int, unlock_key text nullable, reward_hint json),
path_tasks (path_milestone_id, position, title json, description json).
Při volbě cesty se šablony zkopírují uživateli do milestones a tasks
s odkazem template_id; uživatel je pak libovolně upravuje a maže. Cestu
jde v nastavení změnit — nové milníky se přidají, hotové zůstanou.
Vlastní milníky bez šablony nic neodemykají, jen dávají XP.

V tomhle promptu naplň tři cesty, každou v obou jazycích: Obecné podnikání,
Řemeslník, Konzultant a freelancer. Každá 4 kapitoly, celkem 10 až 12
milníků, každý milník 3 až 6 konkrétních úkolů. Kapitoly: Základy
(živnost, účet, nabídka, ceník), První klienti (kontakty, oslovení, první
schůzka), Rozjezd (první zakázky, faktury, pravidelný příjem), Růst
(opakovaní klienti, pracovník, systém). Reálné, konkrétní, bez frází.

ODEMYKÁNÍ
Tabulka unlock_definitions (key, kind: section | feature | theme |
jarvis_skill, name json, description json, icon). Zdroje odemčení:
milník ze šablony (unlock_key) a úroveň. V game režimu nový uživatel
začíná s Dashboard, Milníky, Jarvis a Nastavení. Pořadí odemykání
sekcí přes milníky cesty: Kontakty → Cold Calling → Pipeline → Kalendář
→ Finance; Pracovníci na úrovni 10. Zamčená sekce v menu ukazuje, který
milník ji odemkne. Stávající tabulku unlocks a logiku z fáze 6 na tohle
přepoj — pravidla „po 5 kontaktech" apod. zruš, nahradí je milníky.

XP
Jediná cesta k XP je serverová funkce award_xp(reason, ref_id); z klienta
do xp_events nejde zapsat. Zdroje a hodnoty:
- úkol 10, podúkol 5
- milník: xp ze šablony (100–400), vlastní milník 100 — jen poprvé
- vyhraný obchod 150 + bonus 1 XP za každých 1 000 Kč, strop 150
- domluvená schůzka 40
- přesun kontaktu 5, denní strop 50
- vygenerovaný kontakt 1, denní strop 30
- 30 minut volání v jednom dni 30, jednou denně
- událost v kalendáři 5, transakce 5, denní strop 25 každé
- denní přihlášení 10 × násobek série (max 3×)
Opakovatelné zdroje mají denní stropy, aby se XP nedalo farmit.

ÚROVNĚ
30 úrovní. XP potřebné na úroveň n: round(120 · n^1.6). Názvy po
pěticích v obou jazycích: Učeň, Živnostník, Obchodník, Podnikatel,
Stratég, Legenda. Tabulka level_rewards (level, unlock_key): barevná
témata na 3, 7, 12, 18, 25; Pracovníci na 10; Jarvisovy dovednosti
(ranní shrnutí 5, týdenní analýza 15, osobní doporučení oborů 20);
tituly na každé pětce. Postup úrovně se počítá z celkového XP, neukládá se.
Při postupu funkce vrátí novou úroveň a odemčené věci — rozhraní z toho
udělá oslavu.

ODZNAKY
Tabulka achievements (key, name json, description json, icon, condition
json) a user_achievements. Šestnáct odznaků, například: První krok (první
úkol), Síťař (50 kontaktů), Telefonista (10 hodin volání), Uzavřeno (první
výhra), Série 7 a Série 30, Mapař (strom se třemi úrovněmi), Plánovač
(10 událostí), Účetní (první měsíc s kompletními financemi), Šéf (první
pracovník), Výmluvný (10 schůzek), Maratonec (100 úkolů), Kapitola
(dokončená kapitola cesty), Cesta (dokončená cesta). Vyhodnocuj
serverově po každé relevantní akci.

SÉRIE
Den se počítá, když uživatel udělá aspoň jednu akci dávající XP. Jedna
záchrana série za týden — vynechaný den sérii nepřeruší, záchrana se
spotřebuje.

Migrace, ochrana řádků (šablony a definice čtou všichni přihlášení,
xp_events a user_achievements jen čtení vlastních), Vitest na výpočet
úrovně, stropy XP a vyhodnocení odznaků. Commit.
```

## Prompt 9.4 — Gamifikace: rozhraní, úroveň, témata · **Opus 5.5**

```
Rozhraní k hernímu systému z předchozího promptu.

ONBOARDING
Nový krok hned po uvítání: „Jak chceš Gradus používat?" — dvě velké karty
Hrát hru (cesta, úrovně, odměny) a Jen používat (všechno hned k dispozici).
Při volbě hry následuje výběr cesty podle oboru s náhledem kapitol
a prvních milníků. Po dokončení onboardingu v game režimu vzniknou milníky
z cesty a Jarvis na to upozorní. V Nastavení → Hra jde režim přepnout
s vysvětlením, co se stane, a cestu změnit.

OKNO ÚROVNĚ
Klepnutí na pilulku úrovně v horní liště otevře velké vycentrované okno:
- nahoře kruh s číslem úrovně a jejím názvem, pod ním ukazatel XP do
  další úrovně s přesným číslem „1 240 / 2 100 XP"
- Jak získat XP: seznam zdrojů s dnešním postupem a stropem („Přesuny
  kontaktů 25 / 50") a tři konkrétní návrhy podle stavu aplikace
  („Dokonči 2 úkoly z milníku Ceník — 20 XP")
- Na příští úrovni získáš: karty odměn z level_rewards
- Cesta: kapitoly s postupem, aktuální milník zvýrazněný
- Odznaky: mřížka, získané barevně, ostatní šedé s podmínkou
- Historie: posledních 10 XP událostí s časem
Na telefonu přes celou obrazovku, posouvatelné.

POSTUP ÚROVNĚ
Při dosažení nové úrovně oslavná sekvence ve variantě pro úroveň: číslo
a název úrovně, odemčené odměny jako karty, ne pohár ale štít s číslem.
Pilulka v horní liště pulzuje, dokud uživatel okno neotevře.

CESTA V MILNÍCÍCH
V sekci Milníky nahoře přepínač Seznam / Cesta. Cesta je svislá mapa:
kapitoly jako úseky, milníky jako uzly na křivce, hotové tyrkysově,
aktuální fialově se svitem, budoucí tlumeně, u každého štítek „Odemkne:
Pipeline" nebo „+250 XP". Klepnutí otevře detail milníku.

ZAMČENÉ SEKCE
V menu ztlumená položka se zámkem; klepnutí ukáže kartu s názvem sekce,
co umí, a tlačítkem na milník, který ji odemyká. Po odemčení položka
svítí, dokud ji uživatel nenavštíví.

BAREVNÁ TÉMATA
Design systém musí umět přepínat téma přes atribut data-theme na html,
tokeny definované pro každé téma. Šest témat: Gradus (výchozí fialová
a tyrkysová), Půlnoc (modrá a stříbrná), Les (zelená a zlatá), Západ
(oranžová a růžová), Ocel (šedá a tyrkysová), Světlé (světlé pozadí,
tmavý text). Nastavení → Vzhled: náhledy témat, v game režimu zamčená
s úrovní, v tool režimu všechna. Volba v user_settings.

TOOL REŽIM
V tool režimu pilulka úrovně a série v horní liště nejsou, okno úrovně
není, oslavy jen pro milník a výhru a bez XP. Všechny texty do překladů.
Commit.
```

## Prompt 9.5 — Herní cesty: další obory · **Sonnet 5**

```
Doplň obsah cest pro dalších pět oborů, stejnou strukturou jako tři
existující (4 kapitoly, 10 až 12 milníků, 3 až 6 úkolů na milník, oba
jazyky, xp, unlock_key u milníků, které odemykají sekce ve stejném pořadí
jako ostatní cesty):

- E-shop a prodej online
- Gastronomie a kavárna
- Osobní služby (kadeřnictví, kosmetika, masáže)
- Realitní makléř
- Fitness a osobní trenér

Úkoly konkrétní a reálné pro ten obor, bez obecných frází. Například
u gastronomie hygienické požadavky, u realit zprostředkovatelská smlouva,
u e-shopu obchodní podmínky a doprava. Přidej jako migraci s daty. Ověř,
že výběr cesty v onboardingu nabízí všech osm. Commit.
```

## Prompt 9.6 — Jarvis: postava · **Opus 5.5**

```
Překresli Jarvise na krásnou animovanou postavičku malého robota. Cíl je
„wow" — ať vypadá jako z profesionálně zpracované aplikace, ne jako ikona.
Zároveň musí zůstat jednoduchý a čitelný, i když je malý.

TVAR
Inline SVG složený z vrstev, žádný rastr: malé vznášející se tělo ve
tvaru oblého kapsle v tmavé barvě karty s tyrkysovým obrysem a jemným
gradientem, nad ním zaoblená hlava s velkým „displejem" obličeje —
tmavé sklo, na něm dvě velké tyrkysové oči s odleskem, které umí měnit
tvar podle emoce, a jemný úsměv jako světelná linka. Krátká anténa
s kuličkou, která svítí. Dvě malé ručičky bez nohou — vznáší se. Pod
ním měkký stín, který se mění s výškou vznášení.

ANIMACE (Framer Motion, jen transform a opacity kvůli výkonu)
- klid: vznášení nahoru a dolů 3 s, mrkání každých 4–6 s nepravidelně,
  anténa pomalu pulzuje, oči lehce sledují kurzor v omezeném rozsahu,
  občas naklonění hlavy
- přemýšlení: oči se zúží, po displeji přejíždí světlo, anténa bliká
  rychleji, tělo se mírně nakloní
- radost: oči do tvaru obloučků, úsměv širší, poskočení s squash
  a stretch, krátká záře
- mávání: ručička mává, hlava se nakloní
- ukazování: ručička ukáže daným směrem (vlastnost direction)
- překvapení: oči se zvětší, anténa vyskočí
- spaní: oči zavřené, pomalé dýchání, malé „z" — pro noční shrnutí
- vstup na obrazovku: přiletí zpoza okraje s nákloněm a dosedne se
  squash; odchod stejně opačně
Všechny přechody mezi stavy plynulé. prefers-reduced-motion: jen statické
pozice bez smyček.

KOMPONENTA
<Jarvis size state direction /> s velikostmi: 64 (tlačítko), 140 (bublina),
240 (onboarding a oslavy). Tlačítko vpravo dole použije postavu ve velikosti
64 bez těla, jen hlava s displejem, ve stejném tyrkysovém svitu jako dosud.
Vytvoř stránku /design-system/jarvis se všemi stavy a velikostmi vedle
sebe a ovládáním na přepínání, ať se to dá ladit.

Nesmí to sekat: na stránce s mapou úkolů a grafy musí zůstat 60 fps.
Commit.
```

## Prompt 9.7 — Jarvis: průvodce a proaktivní asistent · **Opus 5.5**

```
Jarvis má uživatele provést aplikací a občas se sám ozvat. Chat přes
tlačítko vpravo dole zůstává beze změny.

PRŮVODCE PO REGISTRACI
Po dokončení onboardingu Jarvis provede uživatele aplikací: postava
velikosti 140 se objeví u prvku, o kterém mluví, zbytek obrazovky lehce
ztmavne a prvek zůstane vysvícený (spotlight s měkkými okraji), vedle
postavy bublina s textem, tlačítka Další a Přeskočit, tečky postupu.
Sedm kroků: Dashboard, Milníky a cesta, Jarvisovo tlačítko, horní lišta
s úrovní a sérií (jen v game režimu), vyhledávání, nastavení, a závěr
s první doporučenou akcí. Mezi kroky postava přeletí k novému prvku.
Průvodce jde kdykoliv ukončit a znovu spustit z Nastavení → Nápověda.
Pracovníci dostanou zkrácenou verzi pro svůj prostor.

PROAKTIVNÍ OZVÁNÍ
Jarvis se sám objeví na obrazovce — postava přiletí do levého dolního
rohu obsahu (pravý dolní patří tlačítku), s bublinou. Tři druhy obsahu,
všechny z tabulky jarvis_suggestions rozšířené o kind (briefing |
suggestion | question), payload json, shown_at, answered_at:

1. RANNÍ SHRNUTÍ: naplánovaná úloha v 6:00 v pásmu uživatele sestaví
   přes model (Sonnet, měřeno v ai_usage) krátké shrnutí: co se stalo
   včera, co čeká dnes, jedna věc, které si všiml („Obchod s Aura Tech
   stojí 12 dní v Domluvě"). Zobrazí se při prvním otevření toho dne.
   Odemyká se na úrovni 5 v game režimu, v tool režimu je vždy.
2. NÁVRHY: z dávkových kontrol z fáze 4 — Jarvis navrhne konkrétní
   akci s tlačítky. Když navrhuje úkoly, bublina ukáže jejich seznam
   k náhledu a tlačítko Přidat; nic nevzniká bez potvrzení. Další
   tlačítka: Ukázat (přejde na místo), Později (odloží o den), Zavřít.
3. OTÁZKY: občas se zeptá na něco, co mu pomůže radit — „Jaký je tvůj
   hlavní cíl na tento měsíc?", „Kolik hodin týdně chceš věnovat volání?"
   — s možnostmi nebo volnou odpovědí. Odpovědi se ukládají a přidávají
   do Jarvisova kontextu. Nejvýš dvě otázky týdně.

PRAVIDLA, AŤ NEOTRAVUJE — zapiš do CLAUDE.md
- nejvýš jedno proaktivní zobrazení za relaci a ne dřív než 4 hodiny
  po předchozím
- nikdy, když běží časovač volání nebo je otevřený dialog
- nikdy do 30 sekund po načtení stránky, ať to nepřekvapí
- Později znamená další den; zavřít znamená už nikdy tenhle návrh
- v Nastavení → Jarvis: přepínač proaktivního ozývání, frekvence
  (často / občas / jen ranní shrnutí), tichý režim v časech
- když není co říct, neukazuje se — žádné plané „jak se máš"

Bublina: karta ve vzhledu aplikace s ocáskem k postavě, text se píše
po znacích, tlačítka v jedné řadě, zavření křížkem. Vstup a odchod
postavy s animací z předchozího promptu. Zobrazení a reakce logovat do
usage_events. Všechno přes /api/jarvis a měřeno. Texty do překladů.
Commit.
```

## Kontrola fáze 9 · **Opus 5.5**

```
Zkontroluj změny z promptů 9.0 až 9.7. Zaměř se na: ochranu řádků po
zavedení pracovního prostoru — zkus si představit pracovníka bez práv
a hledej cestu k cizím datům; že XP nejde zapsat z klienta a stropy
fungují; že tool režim opravdu nic nezamyká a nezobrazuje XP; že
proaktivní Jarvis dodržuje limity frekvence; že nová postava nesnižuje
výkon na stránkách s mapou a grafy; že všechny nové texty jsou v obou
jazycích a test na překlady prochází; že migrace s obsahem cest jsou
idempotentní. Oprav nálezy, pusť lint, test a build.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 9.0 | architect |
- [ ] 9.1 | architect |
- [ ] 9.2 | builder |
- [ ] 9.3 | architect |
- [ ] 9.4 | architect |
- [ ] 9.5 | builder |
- [ ] 9.6 | architect |
- [ ] 9.7 | architect |
- [ ] K9 | reviewer |
- [ ] STOP | Konec kola 2. Ověř: Jarvisův chat odpovídá a tlačítko Otestovat Jarvise v nastavení prochází. Pracovník Caller ve druhém prohlížeči vidí a upravuje kontakty, ale nevidí finance; po odebrání práva zmizí hned. Graf příjmu jde přiblížit. Založ nový účet v herním režimu, vyber cestu Řemeslník, projdi průvodce a ověř, že vznikly milníky s popisky „Odemkne". Klepni na úroveň vpravo nahoře. Přepni téma v nastavení. Zkontroluj postavu Jarvise na /design-system/jarvis ve všech stavech. Nech aplikaci otevřenou a sleduj, jestli se Jarvis sám ozve — a jestli neotravuje. Poznámky pošli do chatu s Claude.
=== KONEC

V sekci `## Odloženo` odstraň řádek o Jarvisovi — řeší ho prompt 9.0.

---

## Krok 3 — Uprav `CLAUDE.md`

a) Do sekce Struktura za řádek o `src/features` přidej:
`- Cesty, úrovně, odznaky a odemykání jsou v src/features/game, Jarvisova postava a proaktivní chování v src/features/jarvis`

b) Do sekce Pravidla přidej novou podsekci (prompty 9.1, 9.3 a 9.7 ji doplní podrobnostmi, tady je základ):

```
### Pracovní prostor
- Prostor = účet majitele. Dotazy filtrují podle current_workspace_id(), nikdy podle auth.uid(). Ochrana řádků přes has_section_access(owner, sekce, úroveň).
- Tam, kde záleží, kdo akci udělal, je actor_id vedle user_id.
- Pracovník nikdy nevidí finance bez výslovného práva, nastavení a pracovníky nikdy.

### Hra
- Dva režimy: game a tool. Tool nic nezamyká a nezobrazuje XP.
- XP jen přes award_xp na serveru. Milník a odznak jen poprvé, opakovatelné zdroje mají denní stropy.
- Odemykání sekcí v game režimu jen přes milníky cesty a úrovně. Úroveň se počítá z celkového XP, neukládá se.
- Jarvis se sám ozývá nejvýš jednou za relaci a ne dřív než po 4 hodinách, nikdy při běžícím časovači nebo otevřeném dialogu. Nic nevytváří bez potvrzení.
```

---

## Krok 4 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni všechny změny, pushni a napiš uživateli česky, kolik položek přibylo a že má napsat `/clear` a pak `/pokracuj`.
