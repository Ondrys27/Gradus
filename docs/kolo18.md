# Odměny, sdílené poznámky, widgety, MCP server, kalendáře — kolo 18

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Do `docs/plan.md` přidej tohle PŘED sekci `## Odloženo` (když tam není, na konec)

=== ZAČÁTEK

---

# FÁZE 28 — Zpětná vazba majitele z 21. 11.

*Velké kolo, má běžet bez dozoru. Pořadí je záměrné: opravy a pozvánky → odměny → poznámky → přehled z widgetů → Grady a MCP → modely → kalendáře (poslední, protože potřebuje klíče od Googlu a bez nich se běh zastaví). Tarify a placení za pracovníky se v tomto kole NEŘEŠÍ — přijdou až úplně nakonec. Každý krok: migrace jen přidávací, RLS přes členství v prostoru (22.4), texty do en.json i cs.json, Vitest + E2E, doplnit CLAUDE.md a docs/funkce.md.*

## Prompt 28.1 — Správa firmy: úklid, pozvání přes jméno nebo ID, průchod celým procesem · **Opus 5.5**

```
1. PRYČ S „NAVÍC 290 Kč". Odeber z rozhraní všechno o placení za
   pracovníky (štítky „navíc 290 Kč", „v ceně", „po spuštění
   plateb", řádek Pracovníci v Předplatném, texty v pozvánce).
   Výpočet v kódu nech, jen ho schovej za jeden přepínač
   WORKER_BILLING_VISIBLE = false (app_settings), aby šel později
   zapnout. Testy uprav.
2. JEN LIDÉ Z FIRMY. Všude, kde se vybírá nebo vypisuje pracovník
   (Odměny a výplaty, nová skupina a členové skupiny, přiřazení
   úkolu a obchodu, zprávy, práva, widgety, filtry), se nabízí jen
   aktivní členové prostoru (memberships.status = active). Najdi
   příčinu, proč se dnes ukazují odebraní a nikdy nepřijatí (dotaz
   nad workers bez stavu?) a oprav ji v jednom sdíleném dotazu
   activeMembers(space), který použijí všechna místa. V Odměnách
   a výplatách přepínač „Zobrazit i bývalé" (kvůli historii
   výplat); bývalý má štítek a nejde mu nic přidat. Skupiny:
   členství bývalých se při odebrání ruší.
3. POZVÁNÍ. Dialog „Pozvat pracovníka" začíná volbou:
   a) „Už používá Gradus" → pole pro uživatelské jméno (@jmeno)
      nebo krátké ID; hledá se jen PŘESNÁ shoda (žádné
      našeptávání cizích lidí, limit pokusů), nalezený se ukáže
      jako karta (foto, jméno, @jmeno) → vybrat roli/šablonu práv,
      nadřízeného, skupiny → Pozvat. Pozvaný to hned vidí v Gradusu
      (zvonek, „Čeká na tebe", Gradyho bublina) a e-mailem.
   b) „Ještě Gradus nemá" → e-mail + jméno → pozvánka e-mailem
      jako dnes.
   Uživatelské jméno (profiles.username) už existuje: ověř, že si
   ho každý může nastavit v Nastavení → Účet (unikátní, 3–20
   znaků, a-z 0-9 _ ., změna nejvýš 1× za 30 dní, staré jméno
   30 dní rezervované), že je vidět vedle krátkého ID s tlačítkem
   Kopírovat, a že stejné jméno používá plánovač (handle) a zprávy.
4. PRŮCHOD CELÝM PROCESEM. Projdi v Playwrightu proti produkčnímu
   buildu celý život pracovníka a u každého kroku hledej chyby,
   nejasné texty a slepé uličky (snímky do docs/audit-pozvanky/):
   pozvání nového e-mailem (zachyť odeslaný e-mail z mocku Resend
   a otevři odkaz) → registrace → potvrzení → první přihlášení →
   co vidí pracovník (menu, přehled, prázdné stavy) → přepínač
   firem → úkol od majitele → splnění → odměna → zpráva →
   pozvání existujícího přes @jmeno → přijetí / odmítnutí →
   změna práv za běhu → přesun pod jiného nadřízeného → odchod
   pracovníka sám → odebrání majitelem → co zůstane (úkoly,
   obchody, zprávy, odměny) → opětovné pozvání téhož člověka →
   pozvánka na e-mail s velkými písmeny a mezerou → dvě firmy
   zvou téhož člověka → pozvaný je majitel jiné firmy. Totéž na
   390 px a v angličtině. Každý nález oprav; co je rozhodnutí,
   zapiš do souhrnu. docs/audit-pozvanky/nalezy.md s tabulkou
   nález · příčina · oprava.
```

---

## Prompt 28.2 — Odměny pracovníků: plán odměn z pravidel · **Opus 5.5**

```
Dnešní odměny (stromový editor v src/features/workers/rewards)
nahraď systémem, kde si majitel u každého pracovníka „naprogramuje",
za co a kolik dostane, a kde jde odměnu přidat i ručně.

1. DATA.
   - reward_plans (space, worker, name, approval auto|manual
     výchozí manual, currency, active od–do),
   - reward_rules (plan_id, kind, amount, percent, unit, filter
     JSON, cap_per_period null, active, position), kind:
     task_fixed (částka u konkrétního úkolu — hodnota je u úkolu),
     task_default (částka za každý splněný úkol bez vlastní ceny),
     project_done (dokončený milník/projekt), per_meeting
     (domluvená schůzka z Cold Callingu nebo plánovače),
     per_call, per_contact (nový kvalifikovaný kontakt),
     deal_percent (% z vyhraného obchodu, z částky bez DPH),
     deal_fixed, hourly (z odpracovaného času), monthly_fixed,
   - sloupce reward_amount + reward_currency u úkolů (crm_tasks,
     úkoly od majitele, úkoly milníků) a u obchodu/milníku
     volitelná pevná odměna při dokončení,
   - reward_entries (worker, space, source_kind, source_id,
     rule_id null, amount, currency, status planned|pending|
     approved|rejected|paid, occurred_at, approved_by, paid_at,
     payout_id, note, created_by). planned = budoucí odměna
     (úkol s cenou, který ještě není hotový); manual = ruční.
   - reward_payouts (worker, období, součet, paid_at, note).
   Stávající pravidla ze stromového editoru převeď migračním
   skriptem na nová (co nejde převést, vypiš v souhrnu a nech
   jako poznámku u plánu); starý editor odstraň z rozhraní.
2. VÝPOČET (čisté funkce + testy): událost (úkol hotov, obchod
   vyhrán, schůzka domluvena, čas zapsán, konec měsíce) → najdi
   pravidla plánu → vytvoř reward_entry (pending nebo approved
   podle approval). Idempotentně: jedna událost = nejvýš jeden
   záznam na pravidlo; vrácení úkolu do nehotových nebo prohra
   po výhře záznam stornuje (pokud není vyplacen; vyplacený →
   záporný opravný záznam). Úkol s cenou vytvoří planned záznam
   už při zadání; po splnění se z něj stane pending/approved.
   Měsíční fix a strop řeší denní cron.
3. ROZHRANÍ — dashboard pracovníka, záložka Odměny:
   - nahoře: vyděláno tento měsíc · čeká na schválení · čeká na
     výplatu · v plánu (budoucí),
   - tlačítko „Přidat odměnu" (částka, důvod, datum, volitelně
     navázat na úkol/obchod; záporná = srážka),
   - „Plán odměn": seznam pravidel jako věty („2 000 Kč za každou
     domluvenou schůzku", „5 % z vyhraných obchodů, nejvýš
     30 000 Kč měsíčně"), přidání pravidla průvodcem po krocích
     (za co → kolik → omezení), přepínač automaticky / se
     schválením, šablony: Cold caller, Obchodník na provizi,
     Programátor za projekt, Asistent na hodinu,
   - tabulka práce: úkoly a obchody pracovníka — hotovo v termínu
     / po termínu / nehotovo, u každého odměna a její stav; filtr
     období; odtud jde odměnu schválit, upravit, zamítnout,
   - výplaty: vybrat schválené → „Označit vyplaceno" (datum,
     poznámka) → zapíše výdaj do Financí (kategorie Odměny,
     řádek v plánovací tabulce) → historie výplat, export CSV.
   Souhrnná záložka „Odměny a výplaty" ve Správě firmy: všichni
   aktivní, sloupce jako nahoře, hromadné schválení a výplata.
4. ODMĚNA U ÚKOLU. V dialogu úkolu (všechny tři druhy úkolů)
   nepovinné pole „Odměna za splnění"; vyplní se z task_default
   pravidla, jde přepsat. Viditelné jen když je úkol přiřazen
   pracovníkovi s plánem.
5. PRACOVNÍK vidí odměny vždy: u úkolu částku, v sekci Odměny
   svůj přehled (vyděláno, čeká, v plánu „čeká tě 12 000 Kč za
   3 úkoly"), svá pravidla jako věty, historii výplat. Nemění nic.
6. Práva: plán a výplaty jen majitel a kdo má „správa firmy:
   odměny"; nadřízený bez práva odměny podřízených nevidí.
   Grady: zná odměny pracovníka v jeho prostoru, majiteli umí
   shrnout „komu co dlužíš". Analytika bez částek.
```

---

## Prompt 28.3 — Poznámky: složky a sdílení · **Opus 5.5**

```
Poznámky jsou dnes soukromé. Přidej složky a sdílení v rámci firmy.

1. DATA. note_folders (space, owner, name, parent null — jedna
   úroveň zanoření stačí, position, color). notes.folder_id.
   note_shares (note_id NEBO folder_id, cíl: member | group |
   space, role viewer | editor, can_reshare bool, created_by).
   Efektivní právo k poznámce = nejvyšší z vlastního sdílení
   poznámky a sdílení její složky; výjimka u poznámky ve sdílené
   složce: jde nastavit „v této složce soukromá" nebo jiné právo
   pro konkrétního člověka (práva u každé poznámky zvlášť).
   RLS: vlastník vše; viewer čte; editor čte a píše, nemaže,
   nepřesouvá mimo složku; sdílet dál smí vlastník a kdo má
   can_reshare. Odebrání člena z firmy ruší jeho přístup, jeho
   vlastní sdílené poznámky zůstanou firmě (vlastníkem se stane
   majitel prostoru, s oznámením).
2. ROZHRANÍ. Levý panel: Moje poznámky · Sdílené se mnou ·
   složky (strom, tažením poznámky do složky, ikona sdílení
   u složky) · Koš. Tlačítko Sdílet v poznámce i u složky:
   dialog jako v Google Docs — přidat lidi a skupiny (jen aktivní
   členové), role u každého, „celá firma", „mohou sdílet dál",
   seznam kdo má přístup a odkud (přímo / ze složky), odebrat.
   V hlavičce poznámky avatary lidí s přístupem a štítek
   Soukromá / Sdílená (n). Nová poznámka ve sdílené složce dědí
   sdílení a řekne to. Hledání hledá i ve sdílených. Sdílení
   pošle oznámení (zvonek), ne e-mail.
3. Myšlenkové mapy, odkazy na záznamy, šablony a propojení
   s úkoly fungují ve sdílených stejně; čip na záznam, ke kterému
   čtenář nemá právo, se mu zobrazí jako „skrytý záznam".
4. GRADY. Čte a píše poznámky v rozsahu práv toho, kdo se ptá
   (sdílené editor → smí upravit, viewer → jen číst). Kontext
   poznámek (notes-context) zahrne sdílené s označením autora.
5. Koš: sdílenou poznámku smí smazat jen vlastník; ostatním
   „Odebrat ze svých". Historie verzí poznámky (kdo a kdy uložil,
   obnovit verzi) — základ pro 28.4.
E2E ve dvou prohlížečích: sdílet složku skupině → člen vidí →
viewer nemůže psát → editor píše → odebrání přístupu platí hned.
```

---

## Prompt 28.4 — Poznámky: živé psaní víc lidí naráz · **Opus 5.5**

```
Sdílenou poznámku má jít psát společně v reálném čase jako
v Google Docs: vidím kurzory ostatních, text se slévá bez konfliktů.

1. TECHNIKA. Tiptap Collaboration + Yjs (yjs, y-prosemirror /
   @tiptap/extension-collaboration a collaboration-caret).
   Přenos přes Supabase Realtime (broadcast kanál na poznámku
   s autorizací podle note_shares — soukromý kanál, RLS na
   realtime.messages) — vlastní malý provider v
   src/features/notes/collab/ (awareness, sync při připojení,
   opětovné připojení, dávkování updatů po ~50 ms). Bez vlastního
   WebSocket serveru (Vercel).
   Trvalé uložení: notes.ydoc (bytea, stav Yjs) + dál udržuj
   content JSON a content_text (odvozené při uložení, kvůli
   hledání, Gradymu a exportu). Ukládá klient, který má dokument
   otevřený, debounce 2 s, se zámkem verze (ydoc_version) —
   nikdy nepřepíše novější stav; při konfliktu sloučí Yjs update.
   Kompakce dokumentu při otevření, když naroste.
2. MIGRACE. Existující poznámky dostanou ydoc při prvním otevření
   z content JSON. NoteSaver zůstává pro offline frontu: změny
   bez spojení se drží lokálně (IndexedDB přes y-indexeddb)
   a po připojení se sloučí.
3. ROZHRANÍ. Barevné kurzory a výběry se jménem, avatary právě
   přítomných v hlavičce, „Píše Váša…", nenápadný stav Synchronizováno
   / Offline — změny se uloží po připojení. Viewer vidí změny živě,
   nepíše. Zpět/Vpřed jen vlastní změny. Historie verzí z 28.3:
   snímek každých 10 minut práce a při zavření, se jmény autorů.
4. MYŠLENKOVÉ MAPY: stejná spolupráce nad stromem (Y.Map/Y.Array
   uzlů), přesun uzlu dvěma lidmi naráz nesmí vytvořit cyklus
   ani ztratit podstrom (test).
5. Grady zapisuje do sdílené poznámky jako další účastník
   (update přes server), ne přepsáním obsahu.
6. Limity: do 10 současných lidí na poznámku, velikost dokumentu
   hlídaná; nad limit režim jen pro čtení s hláškou.
7. Vitest pro sloučení souběžných úprav a offline frontu; E2E
   dva prohlížeče: oba píšou do stejného odstavce → oba vidí
   stejný výsledek; jeden offline → po připojení sloučeno;
   viewer nemůže zapsat ani přímým voláním.
```

---

## Prompt 28.5 — Přehled z widgetů: jádro · **Opus 5.5**

```
Stránka Přehled (/app) se přestaví na plochu z widgetů, které si
každý skládá jako na iPhonu / v macOS.

1. JÁDRO (src/features/dashboard/widgets/): registr widgetů —
   každý widget = { key, název, popis, ikona, kategorie,
   velikosti (S 1×1, M 2×1, L 2×2, XL 4×2 — jen ty, které dávají
   smysl), potřebná práva (akce z katalogu práv), nastavení
   (schema), načítání dat (jeden dotaz na widget, cache, obnovení),
   komponenty pro každou velikost a pro rozkliknutý detail }.
   Mřížka: 4 sloupce na počítači, 2 na tabletu, 2 úzké na telefonu
   (L a XL na celou šířku). Rozložení v dashboard_layouts (user,
   space, name, items JSON [{widget, size, x, y, settings}],
   is_default). Víc přehledů jako záložky (Přehled, Obchod,
   Finance… uživatel si pojmenuje), nejvýš 6.
2. ÚPRAVA. Tlačítko „Upravit" (a dlouhý stisk): widgety se
   rozvlní, tažením se přeskládávají (dnd-kit, ostatní uhýbají),
   roh pro změnu velikosti nebo nabídka velikostí, křížek odebere,
   ozubené kolo otevře nastavení widgetu. „+ Přidat widget"
   otevře galerii: kategorie, hledání, u každého widgetu živý
   náhled ve všech velikostech se skutečnými daty; přidání =
   widget vletí na první volné místo. Zpět (⌘Z) na poslední
   změnu, „Obnovit výchozí". Ukládá se samo.
3. ROZKLIK. Klik na widget ho plynule zvětší z jeho místa do
   detailu přes střed obrazovky (sdílený layout přechod), detail
   má víc dat a akcí a tlačítko „Otevřít sekci"; Esc / klik vedle
   vrátí zpět na místo.
4. SADA WIDGETŮ (dnešní dlaždice a karty převeď, nic neztrať):
   Dnes (úkoly a schůzky) · Čeká na tebe · Úkoly po termínu ·
   Pipeline (hodnota podle fází) · Co hoří (tři dlaždice z 17.3) ·
   Nejbližší schůzky · Týden v kalendáři · Finance měsíce ·
   Vývoj kapitálu · Faktury po splatnosti · Cold Calling dnes ·
   Milníky a postup · Úroveň a série · Grady (souhrn dne
   a rychlý dotaz) · Tým (kdo má co rozdělané) · Aktivita ve
   firmě (viz 28.7) · Odměny (majitel: k vyplacení; pracovník:
   vyděláno a v plánu) · Připnutá poznámka · Rychlé akce (vlastní
   výběr) · Rezervace z plánovače · Spokojenost / dotazník
   (stávající karta). Každý má smysluplný prázdný stav a stav
   načítání ve tvaru widgetu.
5. PRÁVA A VÝCHOZÍ ROZLOŽENÍ. Widget, na jehož data uživatel
   nemá právo, v galerii není a z rozložení se tiše vynechá
   (server data nevydá). Majitel ve Správě firmy → Přehledy:
   výchozí rozložení pro celou firmu, pro skupinu a pro
   jednotlivce (editor stejný jako vlastní, „upravuješ přehled
   skupiny Obchod"); a v právech pracovníka seznam widgetů, které
   smí používat (výchozí: vše, na co má data). Pracovník začíná
   na výchozím (jednotlivec > skupina > firma > systémové podle
   role) a může si ho změnit; „Vrátit na firemní" kdykoli.
   Změna firemního výchozího nepřepíše ty, kdo si upravili,
   jen jim nabídne „Firma má nový přehled".
6. Nový účet: výchozí rozložení podle režimu (hra/bez hry)
   a oboru. Tutoriál a Gradyho odkazy na dlaždice přepoj na
   widgety (data-tutorial). Výkon: widgety mimo obrazovku se
   načítají líně, celý přehled do 1,5 s na pomalém připojení.
Vitest pro mřížku (kolize, zmenšení na užší šířku) a práva;
E2E: přidat, přesunout, zvětšit, rozkliknout, pracovník bez
práva na finance nevidí finanční widgety ani přes API.
```

---

## Prompt 28.6 — Přehled z widgetů: řemeslo a pohyb · **Fable 5.1**

```
Widgety z 28.5 fungují. Teď z nich udělej to nejlepší v aplikaci:
majitel chce propracovanost jako u widgetů na iPhonu a v macOS,
plynulé a uspokojivé přidávání. Použij skill frontend-design
a dataviz; pravidla CLAUDE.md (Rozhraní) platí.

1. Snímky před (1440, 820, 390 px) do docs/widgets-design/before/
   a krátká diagnóza po widgetech.
2. KAŽDÝ WIDGET ZVLÁŠŤ, v každé velikosti jiná kompozice, ne
   zmenšenina: S = jedno číslo nebo jeden stav, čitelné na dálku;
   M = číslo + kontext (trend, další položka); L = seznam nebo
   graf; XL = graf s legendou a akcemi. Jednotná anatomie
   (titulek, hlavní hodnota, sekundární řádek), tabulární číslice,
   jedna akcentová barva na widget podle sekce, grafy podle
   dataviz (sparkline, sloupce, prstenec postupu, mini kalendář).
   Projdi všech ~21 widgetů × jejich velikosti; žádný nesmí být
   „prázdná karta s textem".
3. POHYB. Režim úprav: jemné vlnění s náhodnou fází (ne všechny
   stejně), zvednutí při uchopení se stínem, uhýbání ostatních
   s pružinou, přichycení na mřížku; změna velikosti plynule
   přeskládá obsah; přidání z galerie — widget vyletí z náhledu
   na své místo; odebrání se smrskne. Rozklik do detailu jako
   jeden souvislý pohyb z místa widgetu. Vše 60 fps i s 20 widgety
   (měř), reduced motion = okamžité přechody bez vlnění.
   Krátká haptika na telefonu, kde ji prohlížeč umí.
4. GALERIE: působí jako výběr widgetů v iOS — velké náhledy se
   skutečnými daty, přepínání velikostí tečkami, popis k čemu to
   je, doporučené podle toho, co uživatel používá.
5. Živost bez rušení: čísla se při změně dat přepočítají
   animovaně, widget Dnes se odškrtává přímo na ploše, Grady
   widget má malou postavu ve správné póze.
6. Telefon: úprava dlouhým stiskem, galerie jako spodní panel,
   vše palcem. Snímky po, E2E projdou (jen selektory).
```

---

## Prompt 28.7 — Grady umí všechno co uživatel, zápis ze schůzky, aktivita ve firmě · **Opus 5.5**

```
1. PARITA. Zásada: Grady smí u každého uživatele přesně to, co
   smí ten uživatel, a nic víc. Projdi katalog operací, které
   Grady umí (fáze 26, src/features/*/ops.ts), proti katalogu
   práv a proti všemu, co jde udělat v rozhraní, včetně nových
   věcí z tohoto kola (odměny, složky a sdílení poznámek,
   widgety, pozvánky, plánovač, faktury, finance, zprávy, správa
   firmy). Vytvoř docs/grady-operace.md: tabulka akce v aplikaci ·
   operace Gradyho · právo · vratná? Chybějící operace doplň.
   Každá operace běží pod identitou a právy uživatele v aktivním
   prostoru (žádný admin klient pro uživatelská data), mazání jde
   do koše, zápisy jsou vratné (stávající mechanismus undo).
   Test: pro každou operaci a roli (majitel, pracovník se
   šablonou Asistent) — povoleno/odmítnuto odpovídá právům.
   Tenhle katalog je zároveň zdrojem nástrojů pro MCP (28.8) —
   jedna definice (název, popis, schema vstupu, právo, úroveň
   čtení/zápis/mazání), dvě použití.
2. ZÁPIS ZE SCHŮZKY JEDNÍM TAHEM. V detailu obchodu a kontaktu
   a u schůzky v kalendáři tlačítko „Vložit zápis ze schůzky":
   vloží se přepis nebo poznámky (text, .txt/.docx/.pdf, i dlouhý
   přepis s mluvčími). Grady z něj navrhne: shrnutí do historie
   obchodu, úkoly s termíny a řešiteli, další krok, změnu fáze,
   Close Date a částky, nové kontakty zmíněné v hovoru, poznámku
   do Poznámek (propojenou s obchodem). Uživatel vidí návrh jako
   seznam změn se zaškrtávátky, upraví, potvrdí → provede se
   najednou, celé vratné jedním Zpět. Model podle 27.3 (funkce
   meeting_notes, výchozí Sonnet), dlouhý přepis se zpracuje po
   částech. Nic se nezapíše bez potvrzení. Přepis se ukládá jako
   příloha obchodu jen když to uživatel zaškrtne.
3. AKTIVITA VE FIRMĚ. Tabulka activity_log (space, actor, verb,
   object_kind, object_id, summary bez citlivých částek pro
   nepovolané, created_at) plněná z operací (stejné místo jako
   historie obchodu). Správa firmy → Aktivita: časová osa „kdo
   co udělal" s filtrem podle člověka, skupiny, typu a období,
   denní souhrn na člověka (úkoly, obchody, hovory, schůzky).
   Vidí majitel a kdo má právo; pracovník vidí svou. Widget
   Aktivita ve firmě z 28.5 čte odsud. Uchování 180 dní.
   Akce provedené Gradym nebo přes MCP jsou označené ikonou
   („přes Gradyho", „přes Claude").
```

---

## Prompt 28.8 — MCP server Gradusu · **Opus 5.5**

```
Gradus dostane vlastní MCP server, aby šel připojit do Claude
(a jiných klientů MCP) jako konektor: uživatel pak z Clauda čte
a mění svůj Gradus v rozsahu svých práv.

1. NEJDŘÍV SI OVĚŘ AKTUÁLNÍ SPECIFIKACI (modelcontextprotocol.io:
   transport Streamable HTTP, autorizace OAuth 2.1; dokumentace
   Anthropic k vlastním konektorům / remote MCP) a oficiální
   TypeScript SDK (@modelcontextprotocol/sdk). Co se od popisu
   níže liší, udělej podle specifikace a napiš do souhrnu.
2. SERVER. Route /api/mcp (Streamable HTTP, bezstavově kvůli
   Vercelu; Node runtime). Nástroje se generují z katalogu
   operací z 28.7 — čtení (hledat a číst kontakty, obchody,
   úkoly, kalendář, poznámky, finance, faktury, milníky, tým,
   přehled „co hoří"), zápis (založit a upravit totéž, přidat
   záznam do historie obchodu, zapsat poznámku, naplánovat
   schůzku, splnit úkol…), mazání a odesílání (smazat do koše,
   poslat e-mail, vystavit fakturu). Popisy nástrojů anglicky,
   jasné, s příklady; vstupy přes zod schema; výstupy stručné
   a strukturované s odkazy do aplikace; stránkování. Plus
   nástroje whoami (uživatel, prostor, práva) a
   switch_space (firmy, kde je členem). Každé volání běží pod
   uživatelem a aktivním prostorem tokenu, přes stejné kontroly
   práv a RLS jako aplikace; nikdy admin klient.
3. AUTORIZACE. OAuth 2.1 autorizační server v aplikaci:
   /.well-known/oauth-protected-resource a
   oauth-authorization-server, dynamická registrace klientů,
   authorization code + PKCE, obnovovací tokeny s rotací,
   tokeny uložené jen jako hash, vázané na uživatele, prostor
   a rozsah. Souhlasová obrazovka v Gradusu: „Claude chce
   přístup k tvému Gradusu" + volba úrovně: Jen čtení · Čtení
   a zápis · Plný přístup (i mazání a odesílání) + výběr firmy.
   Přihlášení stávající relací (včetně 2FA, pokud ji účet má).
4. BEZPEČNOST. Smazané přes MCP a Gradyho jde do koše a jde
   obnovit; koš se čistí po 7 dnech (jedna konstanta, nastavitelná
   v administraci; u poznámek zůstává 30 dní). Nástroje s
   nevratným dopadem navenek (odeslat e-mail, vystavit fakturu)
   jsou jen v Plném přístupu a v popisu mají, že klient má chtít
   potvrzení uživatele. Obsah z Gradusu vracej jako data
   (ohraničená), nikdy jako instrukce. Limit rychlosti na token
   (ochrana proti smyčce, ne denní strop). Vše do activity_log
   s označením klienta.
5. NASTAVENÍ → Připojené aplikace (nová skupina „Integrace"):
   adresa serveru ke zkopírování a postup „Jak připojit do
   Claude" po krocích s obrázky (Nastavení → Konektory → Přidat
   vlastní konektor → vložit adresu), seznam připojených klientů
   (název, úroveň, firma, kdy připojeno, naposledy použito,
   počet akcí), historie posledních akcí každého, změna úrovně,
   Odpojit (okamžitě zneplatní tokeny). Majitel firmy vidí ve
   Správě firmy, kteří pracovníci mají připojeného klienta,
   a může MCP pro firmu vypnout (právo „integrace: MCP").
   Dostupné všem tarifům (přepínač v katalogu tarifů připrav,
   výchozí zapnuto).
6. docs/mcp.md: seznam nástrojů, úrovně, příklady vět („Zapiš mi
   tenhle přepis schůzky k obchodu Novák a založ úkoly"). Web:
   krátká sekce „Gradus v Claude" na stránce funkcí.
7. Testy: jednotkové pro každý nástroj × úroveň × role; integrační
   s MCP klientem ze SDK proti lokálnímu serveru (registrace →
   autorizace → tools/list → volání → odpojení); pracovník přes
   MCP nedostane nic nad svá práva; token jedné firmy nečte druhou.
```

---

## Prompt 28.9 — Modely AI: kvalita za nejnižší cenu · **Opus 5.5**

```
Doplněk k 27.3 (model pro každou funkci v administraci). Cíl
majitele: co nejlepší výsledky pro uživatele za co nejméně peněz,
řiditelné z administrace. Nejdřív zkontroluj, co 27.3 dodalo,
a doplň jen chybějící:

1. Každá AI funkce v aplikaci je v katalogu a má vlastní volbu
   modelu — projdi kód a najdi volání modelu mimo katalog
   (včetně nových: meeting_notes, návrhy map, překlady, souhrny
   týdne/měsíce, MCP nic nevolá). Žádné volání bez funkce.
2. VYZKOUŠET A POROVNAT. V administraci → Modely u každé funkce
   „Porovnat modely": spustí funkci na 3–5 uložených vzorových
   vstupech (anonymizované, v repozitáři v tests/fixtures/ai/)
   na vybraných modelech a ukáže vedle sebe výstupy, cenu, dobu
   odezvy a automatické hodnocení (kontroly formátu + krátké
   hodnocení levným modelem podle kritérií funkce). Majitel
   vybere a uloží. Stojí kredity — před spuštěním ukaž odhad.
3. DOPORUČENÍ. Karta „Kde ušetřit": z ai_usage za 30 dní spočítej
   pro každou funkci, kolik by ušetřil levnější model, a kde je
   naopak hodně opakovaných dotazů / oprav (signál nízké kvality
   → doporuč vyšší model). Jedním klikem použít doporučení.
4. ÚSPORA BEZ ZMĚNY MODELU: ověř a doplň cache promptů
   (systémový prompt a stálý kontext s cache_control), zkrácení
   kontextu (situace jen relevantní části podle záměru dotazu),
   horní limit výstupních tokenů podle funkce, dávkové zpracování
   pro úlohy na pozadí (Message Batches, kde nevadí zpoždění —
   noční souhrny, hlídání příležitostí). U každé změny změř
   před/po na vzorcích a napiš do souhrnu úsporu v %.
5. Přehled v administraci: cena na aktivního uživatele za den
   a měsíc, podíl cache, průměrná cena zprávy v chatu, trend.
```

---

## Prompt 28.10 — Kalendář: obousměrně s Googlem a Applem · **Opus 5.5**

```
Dnes jen jednosměrně přes odběr ICS. Přidej obousměrné propojení;
zapnuté jen pro vybrané účty, dokud Google aplikaci neověří.

0. HLÁŠKA „Kalendáře na tomhle serveru ještě nejsou nastavené":
   vzniká, když na serveru chybí INTEGRATIONS_ENCRYPTION_KEY
   (lokálně je, na Vercelu byl po odstranění Fakturoidu smazán).
   Uživateli tuhle technickou hlášku neukazuj: nahraď ji „Propojení
   kalendářů teď není dostupné, zkus to později" a pošli chybu do
   logu chyb s jasným popisem pro majitele; v administraci →
   Zdraví přidej kontrolu „Šifrovací klíč integrací: chybí" a všech
   dalších povinných proměnných prostředí (jen přítomnost).
   V souhrnu uživateli napiš, že má klíč přidat do Vercelu.
1. PŘÍSTUP. Funkce calendar_sync je za příznakem: app_settings
   calendar_sync = { mode: allowlist | everyone, allow_created_before:
   <datum nasazení tohoto kroku>, allow_users: [] }. Výchozí:
   allowlist, povolené účty založené před nasazením + ručně
   přidané v administraci → Nastavení → Integrace. Ostatní vidí
   jen odběr ICS a text „Propojení s Google kalendářem
   připravujeme". Přepnutí na everyone jedním klikem po ověření.
2. GOOGLE. OAuth (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
   přesměrování /api/integrations/google/callback), rozsahy
   jen calendar.events a seznam kalendářů; tokeny šifrované
   INTEGRATIONS_ENCRYPTION_KEY. Uživatel vybere, které Google
   kalendáře číst (obsazenost + zobrazení) a do kterého zapisovat.
   Synchronizace: z Googlu přírůstkově (syncToken) při otevření
   kalendáře, na vyžádání a webhookem (events.watch → /api/
   integrations/google/push, obnovování kanálů denním cronem);
   do Googlu hned při změně v Gradusu. Mapování v
   calendar_external_links (event ↔ external id, etag);
   konflikt = vyhrává novější změna, druhá strana se přepíše
   a v detailu události je poznámka. Události z Googlu se
   v Gradusu dají upravit (zapíše se zpět), opakované události
   se čtou správně, úpravy jedné instance podporuj. Rezervace
   z plánovače se zapisují do Googlu s hostem jako účastníkem;
   u typu schůzky nová volba místa „Google Meet (automaticky)"
   — vytvoří konferenci přes Calendar API (conferenceData) a
   odkaz použije stránka rezervace (27.5).
3. APPLE (iCloud) přes CalDAV: uživatel zadá Apple ID a heslo
   pro aplikace (návod s odkazem na appleid.apple.com), ověření
   proti caldav.icloud.com, uložené šifrovaně; stejný výběr
   kalendářů, synchronizace dotazem (ctag/etag) při otevření
   a denně, zápis hned. Stejné rozhraní poskytovatele jako Google
   (src/features/calendar/sync/providers/), ať jde přidat Outlook.
4. NASTAVENÍ → Kalendář: karty Google · Apple · Odběr přes odkaz;
   stav, poslední synchronizace, Synchronizovat teď, Odpojit
   (smaže tokeny, události z externího kalendáře zmizí, vlastní
   zůstanou). Plánovač bere obsazenost z propojených kalendářů
   živě.
5. docs/google-overeni.md: co přesně poslat Googlu k ověření
   (rozsahy a zdůvodnění, odkazy na podmínky a soukromí na
   gradusgo.com, scénář ukázkového videa, omezené použití dat)
   a postup pro majitele krok za krokem, včetně založení OAuth
   klienta a přidání testovacích uživatelů do té doby.
6. Testy s mockem Google API a CalDAV serveru: přírůstková
   synchronizace, konflikt, opakování, odpojení, účet mimo
   allowlist se k propojení nedostane ani přímým voláním.
```

---

## Kontrola fáze 28 · **Opus 5.5**

```
Zkontroluj fázi 28 podle CLAUDE.md:
- nikde se nenabízí neaktivní člen; „navíc 290 Kč" nikde není,
- odměny: jedna událost = jeden záznam, storno a opravné záznamy
  sedí, souběh schválení a výplaty, pracovník nevidí cizí odměny
  ani pravidla, výplata se zapíše do financí právě jednou,
- poznámky: efektivní práva (složka × poznámka × výjimka) pro
  všechny kombinace, Realtime kanál nejde odebírat bez práva,
  viewer nezapíše ani přes Yjs update, sloučení bez ztráty textu,
  odebraný člen ztrácí přístup okamžitě,
- widgety: data bez práva nevydá server, firemní výchozí nepřepíše
  vlastní rozložení, výkon s 20 widgety,
- Grady a MCP: každá operace × role odpovídá právům; token jedné
  firmy nečte druhou; odpojení zneplatní tokeny hned; tokeny jen
  jako hash; smazané jde do koše; nevratné akce jen v Plném
  přístupu; obsah vracený jako data,
- zápis ze schůzky nic nezapíše bez potvrzení a je celý vratný,
- kalendáře: tokeny šifrované, účet mimo allowlist bez přístupu,
  webhook ověřuje původ, žádná smyčka synchronizace,
- modely: žádné volání mimo katalog funkcí,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 23.4 | RUČNĚ`

=== ZAČÁTEK
- [ ] 28.1 | architect | env: RESEND_API_KEY
- [ ] 28.2 | architect |
- [ ] 28.3 | architect |
- [ ] 28.4 | architect |
- [ ] 28.5 | architect |
- [ ] 28.6 | designer |
- [ ] 28.7 | architect | env: ANTHROPIC_API_KEY
- [ ] 28.8 | architect |
- [ ] 28.9 | architect | env: ANTHROPIC_API_KEY
- [ ] K28 | reviewer |
- [ ] STOP | Konec fáze 28 (bez kalendářů). Přečti docs/audit-pozvanky/nalezy.md. Pozvi Vášu přes @jmeno. Nastav pracovníkovi plán odměn ze šablony, zadej úkol s odměnou, splň ho jako pracovník, schval a vyplať. Nasdílej složku poznámek skupině a pište do jedné poznámky dva naráz. Poskládej si Přehled z widgetů na počítači i telefonu a nastav výchozí přehled pro skupinu. Vlož přepis schůzky do obchodu. V Nastavení → Připojené aplikace připoj Gradus do Claude podle návodu a řekni Claudovi, ať ti vypíše obchody a jeden úkol založí. V administraci → Modely zkus Porovnat modely. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
- [ ] 28.10 | architect | env: GOOGLE_CLIENT_ID
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek`. První poběží, co je ve frontě před 28.1 (zbytek fáze 27). Připomeň mu dvě ruční věci: přidat `INTEGRATIONS_ENCRYPTION_KEY` do Vercelu (stejnou hodnotu jako v `.env.local`, přes Import .env) a před krokem 28.10 založit v Google Cloud OAuth klienta a vložit `GOOGLE_CLIENT_ID` a `GOOGLE_CLIENT_SECRET` do `.env.local` i do Vercelu.
