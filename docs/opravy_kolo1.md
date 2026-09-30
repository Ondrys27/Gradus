# Opravy — kolo 1

Instrukce pro Claude Code. Proveď kroky 1 až 5 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Nic jiného nespouštěj — prompty samotné se provedou až příkazem `/pokracuj`.

---

## Krok 1 — Vytvoř soubor `.claude/commands/zapracuj.md`

=== ZAČÁTEK
---
description: Zapracuje soubor s novým kolem úprav do plánu, postupu a CLAUDE.md
argument-hint: název souboru ve složce docs
---
Přečti soubor `docs/$ARGUMENTS` a proveď přesně a doslova instrukce v něm. Prompty z něj sám neprováděj — jen je zapracuj do `docs/plan.md` a `docs/progress.md` a uprav `CLAUDE.md`, jak soubor říká.

Nakonec ověř `git check-ignore -v .env.local`, commitni změny, pushni a napiš uživateli česky, kolik položek přibylo do postupu a že má napsat `/clear` a pak `/pokracuj`.
=== KONEC

---

## Krok 2 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 8 — Opravy z testování, kolo 1

*Z testování na počítači. Jarvis je odložený na další kolo.*

## Prompt 8.1 — Chyby v konzoli a nefunkční nabídky · **Opus 5.5**

```
Oprav tři chyby. U každé najdi skutečnou příčinu, ne jen příznak, a pak
projdi celou aplikaci, jestli se stejná chyba nevyskytuje jinde.

1. PŘEKLAD JAKO OBJEKT. V detailu milníku padá next-intl:
   INSUFFICIENT_PATH: Message at `milestones.tasks.delete` resolved to
   `object`, but only strings are supported.
   Místo: src/features/milestones/task-row.tsx:190, volání t("delete")
   v komponentě TaskMenu. Klíč milestones.tasks.delete je v překladech
   objekt (nejspíš s podklíči pro potvrzovací dialog) a zároveň se volá
   jako text. Přejmenuj klíče tak, aby se nekřížily, v en.json i cs.json.

   Pak přidej automatickou kontrolu, která tuhle třídu chyb odhalí dřív,
   než ji uvidí uživatel: Vitest test nebo skript spouštěný v bun run test,
   který ověří, že en.json a cs.json mají totožnou sadu klíčů, a že žádné
   volání t() v kódu nevede na objekt. Nastav next-intl ve vývoji tak,
   aby chybějící nebo špatný klíč byl vidět hned, a v produkci aby
   místo pádu zobrazil záložní text.

2. DIV UVNITŘ P. V dialogu generování kontaktů je <Skeleton>, který
   vykresluje <div>, uvnitř <p>. To rozbíjí hydrataci.
   Místo: src/features/contacts/generate-contacts-dialog.tsx:271–282.
   Oprav to a pak prohledej celou aplikaci: Skeleton a jiné blokové prvky
   uvnitř <p>, <span>, <label> nebo <button>, a tlačítka uvnitř tlačítek.
   Dej komponentě Skeleton variantu, která vykresluje <span>, pro použití
   uvnitř textu.

3. NEOTEVÍRAJÍCÍ SE NABÍDKY V ONBOARDINGU. Na uvítací obrazovce se při
   výběru země a měny rolovací seznamy vůbec neotevřou. Najdi proč —
   typicky vyskakovací vrstva nabídky pod překryvem onboardingu (z-index,
   portál mimo kontejner, pointer-events) nebo zachycení fokusu dialogem.
   Oprav to systémově: všechny rolovací nabídky, výběry data a vyskakovací
   menu musí fungovat uvnitř dialogů, spodních panelů i onboardingu.
   Projdi každý dialog v aplikaci a ověř, že se v něm nabídky otevírají.

Po opravě otevři milníky, detail milníku, dialog generování kontaktů
a onboarding a ověř, že v konzoli prohlížeče není žádná chyba ani
varování. Commit.
```

## Prompt 8.2 — Telefonní čísla a časová pásma · **Opus 5.5**

```
Dvě úpravy formátování.

1. TELEFONNÍ ČÍSLA. Kdekoliv v aplikaci uživatel píše nebo vidí telefonní
   číslo, musí být hezky rozdělené, česká čísla po třech: +420 777 123 456.

   Použij knihovnu libphonenumber-js. Vytvoř sdílenou komponentu PhoneInput
   a funkci formatPhone v src/lib/phone.ts:
   - PhoneInput formátuje číslo už během psaní, výchozí předvolba podle
     země z nastavení uživatele, kurzor nesmí při formátování skákat,
     vložení čísla ze schránky v libovolném tvaru se správně přeformátuje
   - ukládá se vždy ve formátu E.164 (+420777123456)
   - formatPhone zobrazí číslo národně, když je ze stejné země jako
     uživatel, jinak mezinárodně
   - neplatné číslo: jemné upozornění pod polem, ale uložení neblokuj

   Nahraď všechna pole a zobrazení telefonu v aplikaci: kontakty, rychlé
   založení kontaktu z obchodu, cold calling, vygenerované kontakty,
   pracovníci, profil. Odkazy na vytočení (tel:) ať používají E.164.

   Napiš migraci, která existující telefony v databázi převede na E.164.
   Čísla, která nejdou rozpoznat, nech beze změny a vypiš jejich počet.
   Uprav kontrolu duplicit při generování a zakládání kontaktů, aby
   porovnávala E.164. Doplň Vitest testy na formatPhone a převod.

2. ČASOVÁ PÁSMA. U výběru časového pásma v nastavení zobraz u každé
   položky, kolik je v tom pásmu právě hodin, a posun od UTC:
   „Evropa/Praha · 17:42 · UTC+2". Čas se živě aktualizuje každou minutu.
   Seznam jde prohledávat psaním a je seskupený podle kontinentu. Aktuálně
   zvolené pásmo ukazuje svůj čas i v zavřeném stavu. Časy formátuj přes
   format.ts podle nastavení uživatele (12/24 h).

Přidej nový pravidlo do CLAUDE.md, sekce Texty a formáty: telefony vždy
přes PhoneInput a formatPhone, ukládat v E.164. Commit.
```

## Prompt 8.3 — Globální vyhledávání jako Spotlight · **Opus 5.5**

```
Vyhledávání v horní liště teď nefunguje. Postav ho znovu jako Spotlight
v macOS: rychlé, chytré, ovladatelné klávesnicí, prohledá celou aplikaci
přihlášeného uživatele.

UMÍSTĚNÍ A OTEVŘENÍ
Pole v horní liště přesuň doprostřed, šířka kolem 480 px, s nápovědou
zkratky „⌘K" (na Windows „Ctrl K"). Klepnutí do pole nebo zkratka ⌘K /
Ctrl+K kdekoliv v aplikaci otevře vyhledávací okno: vycentrované v horní
třetině obrazovky, šířka kolem 640 px, rozostřené pozadí, najede s pružinou.
Esc nebo klepnutí mimo zavře. Na telefonu přes celou obrazovku.

CO PROHLEDÁVÁ
- kontakty: jméno, firma, e-mail, telefon (podle číslic, i části čísla)
- obchody: název, kontakt, částka
- milníky a úkoly: název, popis
- události v kalendáři: název, popis
- transakce a faktury: popis, číslo faktury, odběratel
- pracovníci: jméno, role
- sekce aplikace a stránky nastavení (navigace — „nastavení měny" otevře
  přesně to místo)
- rychlé akce: Nový kontakt, Nový obchod, Nový milník, Nová událost,
  Spustit časovač, Generovat kontakty

JAK HLEDÁ
- bez ohledu na diakritiku a velikost písmen: „novak" najde „Nováka"
- toleruje překlepy a části slov
- výsledky seskupené podle typu s ikonou, max 5 na skupinu, u skupiny
  odkaz „Zobrazit všechny"; nejlepší shody nahoře
- shodný text ve výsledku zvýrazněný
- ke každému výsledku jeden řádek kontextu (u kontaktu firma a tabulka,
  u obchodu fáze a částka, u úkolu milník)

Technicky: jedna serverová funkce, dotazy přes klienta přihlášeného
uživatele, aby platila ochrana řádků — nikdy admin klient. V Postgresu
rozšíření unaccent a pg_trgm, GIN trigramové indexy na prohledávaná pole
v migraci. Hledání spouštěj s prodlevou 150 ms, zruš rozpracovaný
požadavek, když uživatel píše dál. Odezva do 200 ms při tisících záznamů.

OVLÁDÁNÍ KLÁVESNICÍ
Šipky nahoru a dolů posouvají výběr napříč skupinami, Enter otevře,
⌘Enter otevře na pozadí, Tab přeskočí na další skupinu. Výběr je vidět
fialovým podbarvením a sjede do viditelné části.

PRÁZDNÝ STAV
Než uživatel začne psát: naposledy otevřené položky a nedávná hledání
(uložené v nastavení uživatele, max 8) a rychlé akce. Když se nic
nenajde: srozumitelný text a nabídka „Vytvořit kontakt …" s napsaným
textem.

Všechny texty do překladů. Vitest testy na hledání bez diakritiky
a podle části telefonu. Commit.
```

## Prompt 8.4 — Dashboard · **Sonnet 5**

```
Dvě úpravy dashboardu.

1. DETAIL DLAŽDICE JAKO VELKÉ OKNO. Klepnutí na dlaždici teď vysune detail
   zprava. Místo toho otevři velké vycentrované okno: šířka až 960 px,
   výška až 85 % obrazovky, rozostřené a ztmavené pozadí. Okno ať plynule
   vyroste přímo z klepnuté dlaždice (sdílená animace přes layoutId ve
   Framer Motion) a při zavření se do ní zase smrskne. Esc a klepnutí
   mimo zavře. Obsah detailu zůstává stejný, jen dostane víc místa —
   grafy roztáhni na šířku okna. Na telefonu se okno otevře přes celou
   obrazovku.

2. PROCENTA V KRUHU. Dlaždice Splněné úkoly dnes: doprostřed kruhového
   ukazatele dej procento splnění velkým písmem (dopočítává se z nuly),
   pod něj menším písmem „3 / 8". Když dnes nejsou žádné úkoly, ukaž
   v kruhu pomlčku a pod ním „Dnes nic". Formátování přes format.ts.

Commit.
```

## Prompt 8.5 — Milníky a mapa úkolů · **Opus 5.5**

```
Čtyři úpravy milníků. Pravidla z bodů 2 a 3 zapiš i do CLAUDE.md.

1. STAVY ÚKOLŮ V MAPĚ. Každý stav musí být na první pohled poznat,
   moderně a vkusně:
   - Nezačatý: tlumený obrys, neutrální
   - Rozpracovaný: oranžový „živý" rámeček — kónický přechod, který
     pomalu obíhá kolem uzlu, a jemný oranžový svit. Přidej do design
     systému token pro oranžovou (#FF9F43) a používej ho, ne hex v komponentě.
   - Hotový: tyrkysová výplň s fajfkou
   - Zamčený (má nehotové podúkoly): šedý se zámkem
   - Po lhůtě: malá růžová tečka nebo štítek s počtem dnů
   Při prefers-reduced-motion je rámeček statický. Stejné barvy stavů
   použij i v seznamovém pohledu, ať jsou oba pohledy konzistentní.
   Do levého horního rohu mapy dej malou legendu stavů, která jde sbalit.
   V detailu úkolu ať jde stav přepnout.

2. DOKONČENÍ MILNÍKU. Odeber tlačítko Dokončit milník v dosavadní podobě.
   Nahraď ho tlačítkem, které je zamčené — ztlumené, se zámkem a textem
   „Zbývá 3 úkoly" — dokud nejsou hotové všechny úkoly milníku. Ve chvíli,
   kdy se dokončí poslední úkol, se tlačítko s animací odemkne a rozsvítí.
   Milník se ale nedokončí sám — uživatel klepne. Milník bez úkolů nejde
   dokončit, tlačítko řekne „Přidej první úkol". Když uživatel po dokončení
   milníku některý úkol zase odškrtne, milník se vrátí do rozpracovaného
   stavu. XP za dokončení milníku se připíše jen poprvé.

3. ODMĚNA ZA SPLNĚNÍ. K milníku jde volitelně přidat odměnu, kterou si
   uživatel dá, až ho splní — krátký text, třeba „Víkend na horách".
   Migrace: sloupec reward (text, nepovinný) v milestones. Pole ve
   formuláři milníku s ikonou dárku a příkladem v nápovědě. Na kartě
   milníku zlatá ikonka dárku s textem odměny. Při dokončení milníku ji
   oslavná sekvence ukáže jako podtitulek: „Tvoje odměna: Víkend na horách".

4. PŘIBLIŽOVÁNÍ MAPY. Je příliš citlivé a trhané. Uprav nastavení
   react-zoom-pan-pinch:
   - menší krok kolečka a plynulé přiblížení s animací kolem 200 ms
     a náběhem ease-out
   - trackpad na Macu posílá při gestu roztažení prstů desítky událostí
     kolečka s ctrlKey za sekundu — to je hlavní příčina citlivosti.
     Normalizuj deltaY a omez maximální změnu měřítka na jednu událost,
     ať je gesto na trackpadu stejně klidné jako na myši
   - setrvačnost po posunu, ne tvrdé zastavení
   - rozsah přiblížení 0,3 až 2
   - tlačítka přiblížení mění měřítko o 20 % s animací
   - dvojklik na prázdné místo přizpůsobí zobrazení celému stromu
   Otestuj na trackpadu i myši.

Commit.
```

## Prompt 8.6 — Pipeline · **Sonnet 5**

```
Tři úpravy pipeline.

1. ZNOVU OSLOVIT. Filtr „Možné znovu oslovit" teď skryje nebo odkryje
   všechny obchody v celé pipeline. Oprav ho: filtr je přepínač v záhlaví
   sloupce s příznakem prohry a filtruje JEN obchody v tom sloupci —
   ukáže pouze ty, které je možné znovu oslovit. Ostatní sloupce se
   nemění. Aktivní filtr je vidět zvýrazněním přepínače a počtem.

   Doba, po které se obchod v prohře označí k novému oslovení, se nově
   nastavuje v Nastavení v sekci Pipeline: „Nabídnout nové oslovení po"
   s volbami 1, 3, 6, 12 měsíců a vlastní počet měsíců. Výchozí 6.
   Migrace: sloupec reengage_after_months v user_settings. Pravidlo
   i odznak na kartách berou hodnotu odsud. Uprav i CLAUDE.md.

2. PŘESOUVÁNÍ FÁZÍ. V režimu úprav se musí fáze přesouvat jako ikony na
   ploše telefonu: chytnutá fáze se zvedne (mírně zvětší, stín, jemné
   naklonění), drží se kurzoru volně v obou osách, ostatní fáze plynule
   s pružinou uhýbají a ukazují, kam dopadne, a po puštění fáze s animací
   zapadne na místo. Použij dnd-kit se sortable a DragOverlay. Funguje
   i klávesnicí a na dotyk. Pořadí se uloží.

3. PŘIDAT FÁZI. Tlačítko je nevýrazné. Na konec řady fází v režimu úprav
   přidej kartu v plné výšce sloupce s přerušovaným fialovým okrajem,
   velkou ikonou plus a textem „Přidat fázi"; při najetí zesvětlá
   a rozsvítí se fialovým svitem. Klepnutí rovnou otevře formulář nové
   fáze. Mimo režim úprav přidej malé tlačítko se stejnou funkcí vedle
   tlačítka Upravit pipeline.

Commit.
```

## Kontrola fáze 8 · **Opus 5.5**

```
Zkontroluj všechny změny z promptů 8.1 až 8.6. Hledej hlavně regrese:
co se úpravami rozbilo jinde. Konkrétně ověř: že po převodu telefonů na
E.164 funguje hledání, kontrola duplicit a vytáčení; že vyhledávání nikde
nepoužívá admin klienta a nevrací cizí data; že nové migrace mají ochranu
řádků; že všechny nové texty jsou v en.json i cs.json a test na překlady
prochází; že v konzoli prohlížeče nejsou chyby na žádné stránce. Oprav
nálezy, pusť lint, test a build.
```

=== KONEC

---

## Krok 3 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 8.1 | architect |
- [ ] 8.2 | architect |
- [ ] 8.3 | architect |
- [ ] 8.4 | builder |
- [ ] 8.5 | architect |
- [ ] 8.6 | builder |
- [ ] K8 | reviewer |
- [ ] STOP | Konec opravného kola 1. Ověř opravené věci: v konzoli žádné chyby, nabídky v onboardingu se otevírají, telefony se formátují, časová pásma ukazují čas, vyhledávání ⌘K najde kontakt bez diakritiky i podle části čísla, dlaždice se otevírají jako velké okno s procenty v kruhu, mapa úkolů má barevné stavy a klidné přibližování, milník jde dokončit až po všech úkolech a ukáže odměnu, filtr znovu oslovit filtruje jen svůj sloupec a fáze se přesouvají za myší. Pak pokračuj v testování od Kontaktů dál a poznámky pošli do chatu s Claude.
=== KONEC

A úplně na konec `docs/progress.md` přidej:

=== ZAČÁTEK

## Odloženo

Tyto věci `/pokracuj` neprovádí, čekají na další kolo.

- Jarvis nefunguje — při dalším kole přiložit výstup z terminálu s `bun run dev` a z konzole prohlížeče při odeslání zprávy.
=== KONEC

---

## Krok 4 — Uprav `CLAUDE.md`

a) V sekci Konkrétní části nahraď text o pipeline `is_lost > 6 měsíců → odznak „znovu oslovit".` tímto: `is_lost déle než user_settings.reengage_after_months (výchozí 6) → odznak „znovu oslovit"; filtr v záhlaví filtruje jen sloupec prohry.`

b) V sekci Konkrétní části přidej za řádek o úkolech nový řádek:
`- **Milníky:** dokončit jde jen ručně a jen když jsou hotové všechny úkoly (a je aspoň jeden); tlačítko je do té doby zamčené. Odškrtnutí úkolu u hotového milníku ho vrátí do rozpracovaného. XP za milník jen poprvé. Volitelná odměna v milestones.reward se ukáže v oslavě.`

c) V sekci Texty a formáty přidej řádek:
`- **Telefony** vždy přes PhoneInput a formatPhone (src/lib/phone.ts, libphonenumber-js). Ukládat v E.164, zobrazovat národně pro stejnou zemi, jinak mezinárodně.`

d) V sekci Rozhraní v řádku s barvami doplň za zelenou: `oranžová #FF9F43 (rozpracované)`.

e) V sekci Rozhraní přidej řádek:
`- **Vyhledávání** (⌘K) prohledává přes klienta přihlášeného uživatele, nikdy admin; bez diakritiky přes unaccent a pg_trgm.`

---

## Krok 5 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni všechny změny, pushni a napiš uživateli česky: kolik položek přibylo, že má napsat `/clear` a pak `/pokracuj`, a že příští kola úprav stačí nahrát do `docs/` a napsat `/zapracuj název_souboru.md`.
