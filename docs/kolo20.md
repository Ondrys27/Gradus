# Sdílené kalendáře, plánování z Cold Callingu, vzhledy podle denní doby, online stav, průvodci sekcemi — kolo 20

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Do `docs/plan.md` přidej tohle PŘED sekci `## Odloženo` (když tam není, na konec)

=== ZAČÁTEK

---

# FÁZE 30 — Poznámky majitele z 26. 11.

*Společné zadání pro celou fázi: aplikace je už velká, každá nová věc musí být samozřejmá na první pohled — rozumné výchozí hodnoty, pokročilé volby schované za „Další možnosti", stejná místa a slova jako jinde v aplikaci, žádné nové pojmy bez vysvětlení. Tarify a placení se neřeší (vše pro všechny, jen přepínač v katalogu pro budoucnost). Migrace jen přidávací, RLS přes členství v prostoru, texty do en.json i cs.json, Vitest + E2E, doplnit CLAUDE.md, docs/funkce.md, katalog operací Gradyho a MCP (28.7, 28.8) o nové akce.*

## Prompt 30.1 — Chyby v administraci, e-maily, profilová fotka, logo · **Opus 5.5**

```
1. PROFILOVÁ FOTKA. Po nahrání profilového obrázku se místo něj
   ukazuje otazník, i po obnovení stránky. Reprodukuj (nahrání
   JPG, PNG, HEIC z iPhonu, velký soubor, ořez), najdi příčinu
   (cesta v bucketu, podepsaná/veřejná URL, RLS úložiště, cache,
   next/image remotePatterns pro doménu úložiště, chybějící
   content-type) a oprav. Fotka se má objevit hned všude (menu,
   zprávy, Správa firmy, plánovač, sdílené poznámky); když se
   obrázek nenačte, ukaž iniciály na barevném podkladu, nikdy
   otazník. E2E s kontrolou, že <img> opravdu načetl (naturalWidth).
2. ANIMACE LOGA při sbalení a rozbalení levé lišty: nápis „Gradus"
   se plynule zasune do symbolu, při rozbalení se z něj vysune
   (200–250 ms, stejná křivka jako lišta, reduced motion bez
   animace, žádný posun rozvržení). V administraci stejně.
3. PROJDI VŠECHNY CHYBY V LOGU (Provoz → Chyby, je jich přes 70).
   Načti je z databáze (jen čtení, produkční data; žádné mazání),
   u každé skupiny podle otisku urči: skutečná chyba / šum /
   už opraveno dřívějším commitem / nejde určit. Skutečné chyby
   reprodukuj a oprav příčinu s testem. Šum (přerušené načítání
   při odchodu ze stránky, AbortError, chyby rozšíření prohlížeče,
   ztráta sítě, staré klientské verze po nasazení — ChunkLoadError
   → tiché obnovení stránky, boti na neexistujících adresách)
   přestaň zapisovat úpravou zachytávání — s výčtem pravidel
   v jednom souboru a testem, ať se tím neschová skutečná chyba.
   V logu označ opravené jako Vyřešená s poznámkou a commitem,
   šum jako Ignorovat. docs/chyby-2026-11.md: tabulka otisk ·
   počet · co to bylo · co jsi udělal. V souhrnu top 5 příčin.
4. DENNÍ SOUHRN ADMINISTRÁTORŮM místo jednotlivých e-mailů.
   Každý administrátor dostane jeden e-mail denně v 6:00 svého
   časového pásma (cron jednou denně připraví a naplánuje přes
   Resend scheduled_at; Vercel Hobby). Obsah jako krátký
   newsletter „Gradus včera": noví uživatelé a změna proti
   předchozímu dni a týdnu, aktivní uživatelé, tržby a nové /
   zrušené předplatné (při testovacím režimu Stripe označit),
   náklady AI a cena na aktivního uživatele se změnou, nové
   chyby (počet, nejčastější tři s kódem) a vyřešené, nová
   hlášení a zpětná vazba, co čeká na rozhodnutí, zdraví systému
   (jen když něco selhalo), jedna věta „co stojí za pozornost"
   složená pravidly z čísel (největší změna dne; bez volání
   modelu). Tlačítko Otevřít administraci. Omezený admin dostane
   verzi bez peněz. Posílá se každý den (i klidný den = krátký
   e-mail „vše v pořádku" s čísly); v administraci → Nastavení
   → Upozornění jde u každého administrátora vypnout, změnit čas
   a zvolit „jen když je co hlásit". Okamžité e-maily o chybách
   zůstávají vypnuté; volbu „jen kritické" nech vypnutou
   a dostupnou.
5. E-MAILY: PŘEHLED A ÚSPORA. Tabulka email_log (druh, příjemce
   jako hash, čas, stav) plněná v jediném místě odesílání.
   Widget administrace „E-maily": odesláno dnes a tento měsíc
   proti limitu tarifu Resendu (limity jako konstanty s datem
   ověření), rozpad podle druhu, odhad kdy limit dojde.
   docs/emaily.md: seznam VŠECH e-mailů, které aplikace posílá
   (druh, kdy, komu, odhad počtu na uživatele za měsíc) a
   doporučení, kde ušetřit (sloučit do souhrnu, nahradit
   oznámením v aplikaci, poslat jen neaktivním…). Nic z toho
   zatím neměň — jen sepiš a doporuč, rozhodne majitel.
```

---

## Prompt 30.2 — Práva před pozváním a tutoriál podle práv · **Opus 5.5**

```
1. PRÁVA PŘED POZVÁNÍM. V dialogu „Pozvat pracovníka" (obě cesty:
   @jmeno/ID i e-mail) je po výběru šablony krok „Co bude moci":
   plný editor práv (stejná komponenta jako v dashboardu
   pracovníka: sekce, jemné akce, widgety, MCP), nadřízený,
   skupiny, plán odměn ze šablony (nepovinné), výchozí přehled.
   Nastavení se uloží s pozvánkou a platí od první vteřiny po
   přijetí — pozvaný nikdy nevidí víc, než má. Pozvánka (e-mail
   i karta v aplikaci) shrnuje lidsky, k čemu bude mít přístup.
   Čekající pozvánku jde upravit před přijetím.
2. TUTORIÁL PODLE PRÁV. Celkový tutoriál po prvním vstupu do
   firmy (rychlý i úplný) se sestaví z kroků jen těch sekcí
   a akcí, na které má člověk právo; kroky „udělej" používají
   jen povolené akce; ukázková data jen v povolených sekcích.
   Pracovník pozvaný jako cold caller dostane tutoriál o Cold
   Callingu, úkolech, odměnách a zprávách, ne o financích.
   Úvod tutoriálu řekne, pro koho pracuje a co je jeho role.
   Když majitel práva později rozšíří, Grady nabídne krátké
   „Máš nově přístup k Financím — ukázat?" (jednou).
   Test: pro šablony Obchodník, Asistent, Účetní, Cold caller
   a majitele se sestaví jiný tutoriál a žádný krok nemíří na
   nepovolený prvek.
```

---

## Prompt 30.3 — Sdílení kalendáře ve firmě · **Opus 5.5**

```
Každý si nastaví, kdo z firmy vidí jeho kalendář a jak.

1. DATA. calendar_shares (owner member, cíl: member | group |
   space, level: busy | read | write, calendars: které zdroje —
   „Gradus" a jednotlivé propojené externí kalendáře Google/
   Apple z 28.10, každý zvlášť). calendar_share_requests
   (from, to, level, message, status pending|approved|declined).
   calendar_events.private bool: soukromou událost vidí ostatní
   vždy jen jako „Obsazeno" bez názvu, místa a účastníků, i při
   úrovni read/write. Výchozí pravidlo: majitel prostoru vidí
   u svých lidí úroveň busy automaticky (jde vypnout v nastavení
   firmy); vše ostatní jen po nasdílení. RLS a serverové dotazy:
   busy vrací jen časy; read vše kromě soukromých; write smí
   zakládat a upravovat události v kalendáři vlastníka (označené
   „vytvořil X"), nesmí mazat cizí soukromé ani měnit sdílení.
   Externí kalendáře: zápis do nich jen když je vlastník má
   propojené pro zápis; jinak se nabídne jen kalendář Gradusu.
2. NASTAVENÍ → Kalendář → Sdílení: seznam „Kdo vidí můj
   kalendář" (lidé a skupiny, úroveň, které kalendáře),
   přidat, změnit, odebrat; „Čí kalendáře vidím já".
   Žádost: u člověka ve Správě firmy, ve zprávách a v kalendáři
   tlačítko „Požádat o sdílení kalendáře" (úroveň, nepovinná
   zpráva) → adresátovi přijde oznámení (zvonek, „Čeká na tebe",
   Gradyho bublina) s Povolit / Upravit úroveň a povolit /
   Odmítnout; žadatel dostane výsledek. Opakovaná žádost po
   odmítnutí nejdřív za 7 dní.
3. KALENDÁŘ. Postranní panel „Kalendáře": moje zdroje a lidé,
   jejichž kalendář vidím, každý se zaškrtávátkem a vlastní
   barvou (trvalá na člověka). Cizí události mají barvu
   vlastníka a jeho iniciály; „Obsazeno" jako šrafovaný blok.
   Při úrovni write jde událost založit tažením do cizího
   kalendáře (výběr „Do kalendáře: Váša").
   Pohled „Najít společný čas": vyber lidi (i skupinu) a délku
   → zvýrazní se okna, kdy mají všichni volno v pracovní době
   (počítá se z busy, na které mám právo; kdo mi kalendář
   nesdílí, je označen „nevíme") → klik založí schůzku
   s účastníky a pošle jim pozvánku do kalendáře Gradusu.
4. Přepínač „Soukromá" v dialogu události (i klávesou), výchozí
   pro události z osobních externích kalendářů lze nastavit na
   soukromé („vše z kalendáře Osobní je soukromé").
5. Grady a MCP: čtou cizí kalendáře jen v rozsahu sdílení;
   „kdy má Váša zítra čas?" funguje, pokud mám aspoň busy.
E2E ve dvou prohlížečích: žádost → povolení busy → vidím jen
bloky → zvýšení na write → založím událost → soukromá událost
zůstává skrytá i přes API.
```

---

## Prompt 30.4 — Plánovač: vlastní kalendáře a plánování schůzky z Cold Callingu · **Opus 5.5**

```
1. KALENDÁŘE PLÁNOVAČE ODDĚLENĚ. Plánovač → Dostupnost → „Odkud
   se bere obsazenost": zaškrtávací seznam zdrojů — kalendář
   Gradusu, každý propojený Google kalendář, každý Apple
   kalendář, odběry ICS — nezávisle na tom, co má uživatel
   zobrazené v sekci Kalendář. A „Kam se zapisují nové
   rezervace": jeden cílový kalendář (Gradus vždy + volitelně
   jeden externí). Propojení Googlu/Applu jde spustit přímo
   odsud (stejné připojení jako 28.10, jen jiný vstup) a
   plánovač funguje i pro toho, kdo kalendář Gradusu vůbec
   nepoužívá. Výchozí pro nové: Gradus zaškrtnutý. Výpočet
   volných termínů (slots.ts) bere jen zaškrtnuté zdroje; do
   obsazeného termínu se přes veřejný odkaz nedá rezervovat
   (kontrola znovu při potvrzení, živé načtení externích zdrojů
   s krátkou cache). Nastavení jde přepsat u jednotlivého typu
   schůzky („Další možnosti").
2. SPOLEČNÝ VÝBĚR TERMÍNU. Komponenta SlotPicker (den → časy),
   kterou použije veřejná stránka i aplikace: týdenní mřížka
   s volnými termíny zeleně, obsazenými šedě s popiskem „Plno"
   (bez podrobností), mimo pracovní dobu tlumeně; klik na volný
   = vybráno; klik na obsazený nebo ruční zadání času mimo
   nabídku → upozornění „V tu dobu už je plno" + tlačítko
   „Přesto naplánovat" (jen v aplikaci, nikdy na veřejné stránce).
3. COLD CALLING. Přesun kontaktu do Domluvená schůzka otevře
   dialog se SlotPickerem místo prostého data a času:
   - „Komu schůzku plánuji": výchozí podle nastavení Cold
     Callingu (majitel určí: vždy mně / vždy konkrétnímu člověku
     / volající vybírá z lidí, kteří mají plánovač) — ukazují se
     volné termíny toho člověka podle JEHO nastavení plánovače;
     volající z jeho kalendáře vidí jen Volno / Plno,
   - typ schůzky: majitel v nastavení Cold Callingu určí výchozí
     typ a zda ho volající smí změnit; délka a pravidla (pauzy,
     předstih) se berou z typu, předstih pro telefonické
     domlouvání jde vypnout,
   - přepínač „Poslat klientovi potvrzení e-mailem" (výchozí
     zapnuto, když má kontakt e-mail; jinak pole pro doplnění
     e-mailu nebo vypnuto) — pošle stejné potvrzení s pozvánkou
     a odkazem na přesun/zrušení jako veřejná rezervace,
   - otázky tabulky Domluvená schůzka zůstávají pod tím.
   Výsledek je booking (source: cold_calling, vytvořil volající)
   se vším, co rezervace dělá: událost v kalendáři hostitele
   i zápis do jeho externího kalendáře, kontakt, historie,
   připomínky, volitelně obchod; hostitel dostane oznámení
   „Jana ti domluvila schůzku s…". Termín je po dobu otevřeného
   dialogu podržen. Odměna za schůzku (29.1) se váže na tento
   přesun jako dosud.
   Stejný dialog z detailu kontaktu a obchodu („Naplánovat
   schůzku") a pro Gradyho/MCP jako operace.
4. Práva: akce „cold calling: plánovat schůzky jiným" v katalogu;
   bez ní volající plánuje jen sobě. Kdo plánovač nemá nastavený,
   toho se dialog zeptá na pracovní dobu jedním krokem.
E2E: majitel nastaví „schůzky jdou mně", volající přesune kontakt,
vidí volno/plno majitele, vybere termín, klient dostane e-mail,
majitel má událost; obsazený termín ukáže „plno" a „Přesto".
```

---

## Prompt 30.5 — Online stav ve firmě · **Opus 5.5**

```
1. Stavy: online (má otevřenou aplikaci a byl aktivní v posledních
   10 minutách) · nepřítomen (otevřená, 10+ minut bez aktivity)
   · offline s časem „naposledy před 5 hodinami". Supabase
   Realtime Presence na kanálu prostoru (jen členové) + trvalé
   profiles.last_seen_at (zápis nejvýš 1× za minutu a při
   odchodu). Víc karet a zařízení = jeden stav (nejlepší z nich).
2. Zobrazení: tečka u fotky (zelená / žlutá / nic) všude, kde je
   avatar člena firmy — jedna sdílená komponenta Avatar, projdi
   všechna místa a sjednoť; text „online" / „naposledy před…"
   v profilu člověka (dashboard pracovníka), v hlavičce
   konverzace ve Zprávách a v seznamu lidí ve Správě firmy.
   Relativní čas lidsky (před chvílí, před 5 hodinami, včera,
   v pondělí), po 7 dnech jen datum.
3. Soukromí: Nastavení → Soukromí → „Ukazovat, kdy jsem online"
   (výchozí zapnuto). Kdo vypne, není vidět nikomu včetně
   majitele a sám nevidí stav ostatních. Stav se nikdy neukazuje
   mimo firmu (veřejná stránka plánovače, jiné prostory).
   Žádné ukládání historie přítomnosti, žádné reporty „kolik
   byl online"; do analytiky nic.
4. Widget Tým a Aktivita ve firmě ukazují tečky. Grady stav
   nezmiňuje, pokud se uživatel nezeptá.
E2E dva prohlížeče: online → nečinnost → nepřítomen → zavření →
„naposledy"; vypnutí skryje oběma směry.
```

---

## Prompt 30.6 — Vzhledy podle denní doby a vlastní vzhled · **Opus 5.5**

```
1. ROZVRH VZHLEDŮ. Nastavení → Vzhled → „Měnit vzhled během dne":
   bloky s názvem (Ráno, Odpoledne, Večer jako výchozí nabídka),
   časem začátku, vzhledem a nepovinným popiskem; libovolný počet
   (2–8). Režim dnů: každý den stejně · pracovní dny a víkend
   zvlášť · každý den v týdnu zvlášť (kopírovat den do jiných).
   Časová osa dne jako pruh, kde se hranice bloků posouvají
   tažením. Data v user_settings (theme_schedule JSON), čas podle
   pásma uživatele. V herním režimu jdou vybrat jen odemčené
   vzhledy. První vykreslení stránky už má správný vzhled bloku
   (cookie ze serveru, bez probliknutí); přepnutí rozvrhu
   vypnout/zapnout jedním přepínačem; ruční změna vzhledu během
   dne platí do začátku dalšího bloku.
2. PŘECHOD. Když blok začne a uživatel má aplikaci otevřenou,
   proběhne přechod přes celou obrazovku na 2–3 s: název bloku
   velkým písmem, popisek pod ním, vzhled se pod tím promění.
   Jen při přechodu, jehož je uživatel svědkem — ne při otevření
   aplikace. Odklad: nikdy během psaní (fokus v poli a psaní
   v posledních 5 s), otevřeného dialogu, běžícího časovače
   hovoru, tutoriálu, živé spolupráce na poznámce v okamžiku
   psaní ani ukázkového režimu; počká nejdéle 5 minut, pak se
   vzhled změní tiše bez animace. Zvuk: krátký příjemný tón
   (jiný pro každou denní dobu, vygenerovaný Web Audio nebo
   malý soubor), řídí se nastavením zvuků (výchozí zapnuto).
   Reduced motion: jen krátké prolnutí s názvem. Klik nebo Esc
   přechod přeskočí. Náhled přechodu tlačítkem v nastavení.
3. VLASTNÍ VZHLED — EDITOR. Nastavení → Vzhled → „Vytvořit
   vlastní": editor na celou obrazovku, vlevo ovládání, vpravo
   živý náhled skutečné aplikace (přehled, pipeline, poznámka,
   dialog — přepínatelné). Nastavuje se: základ (světlý/tmavý),
   barva pozadí a povrchů, text, hlavní a druhá akcentová barva,
   barvy stavů (úspěch, pozor, chyba) volitelně, zaoblení rohů,
   hustota, pozadí (jednobarevné, přechod, jemná záře — jedna),
   písmo nadpisů z nabídky 6 fontů, síla stínů. Každá barva
   výběrem i HEX; „Vygenerovat z jedné barvy" navrhne celou
   paletu. Kontrast se hlídá živě (WCAG AA pro text): nevyhovující
   kombinace se označí a nabídne oprava jedním klikem; uložit
   nejde vzhled s nečitelným textem. Vzhled = sada hodnot CSS
   proměnných (tokeny z @theme), žádné vlastní CSS od uživatele.
   Uložené vlastní vzhledy (custom_themes: user, name, tokens
   JSON, nejvýš 12) jsou v seznamu vedle vestavěných, jdou
   upravit, duplikovat, smazat, použít v rozvrhu a sdílet kódem
   nebo odkazem s kolegou z firmy (import). Přepínač v katalogu
   tarifů „vlastní vzhledy" připrav, výchozí povoleno všem.
4. Grafy, mapy úkolů, widgety, e-maily a PDF berou barvy z tokenů
   — projdi místa s barvou napevno a oprav, ať vlastní vzhled
   nic nerozbije. Veřejná stránka plánovače zůstává ve vzhledu
   Gradusu (ne vlastním).
Vitest pro výběr bloku (dny, půlnoc, pásma, letní čas), kontrast
a validaci tokenů; E2E: rozvrh se dvěma bloky → posun času →
přechod proběhne → při psaní se odloží; vlastní vzhled vytvořit,
použít, sdílet.
```

---

## Prompt 30.7 — Přechod vzhledů a editor: řemeslo · **Fable 5.1**

```
Přechod mezi bloky dne (30.6) má být okamžik, na který se člověk
těší — jako změna ročního období ve Forza Horizon — a editor
vzhledu má být radost používat. Skill frontend-design.

1. PŘECHOD: navrhni choreografii na 2–3 s: nástup (barva nového
   vzhledu se rozlije z jednoho místa nebo přejede obrazovkou),
   název bloku velkou typografií Gradusu s jemným pohybem,
   popisek, pod tím se rozhraní promění, odchod. Každá denní
   doba má vlastní charakter (ráno světlo zdola, večer ztmavení
   shora…), odvozený z barev cílového vzhledu, takže funguje
   i pro vlastní vzhledy. Zvuk a obraz sedí na sebe. Plynulé
   na telefonu (měř), reduced motion varianta stejně hezká.
   Žádné rozmazané bubliny, jedna záře nejvýš.
2. EDITOR: ovládání seskupené od nejdůležitějšího (jedna barva →
   hotový vzhled) po detaily ve sbalených sekcích; změna se
   v náhledu projeví okamžitě a plynule; výběr barvy příjemný
   i na telefonu; šest hotových výchozích bodů („začni z…").
   Miniatury vzhledů v seznamu jako malé náhledy rozhraní,
   ne barevné čtverce.
3. Časová osa rozvrhu: bloky jako barevné úseky v barvách svých
   vzhledů, tažení hranic s přichytáváním po 15 minutách.
Snímky před/po do docs/vzhledy/, E2E projdou (jen selektory).
```

---

## Prompt 30.8 — Průvodce v každé sekci a vlastní tutoriál s Gradym · **Opus 5.5**

```
V každé sekci jde kdykoli spustit průvodce: rychlý, úplný, nebo
vlastní — člověk napíše, čemu nerozumí, a Grady to ukáže přímo
na obrazovce.

1. TLAČÍTKO. V hlavičce každé sekce (aplikace i administrace) na
   stejném místě ikona otazníku „Průvodce" (klávesa ?). Otevře
   malou nabídku: pole „Na co se chceš zeptat?" NAHOŘE jako
   hlavní volba (s třemi příklady otázek pro danou sekci), pod
   ním „Rychlá ukázka · 1–2 min" a „Všechno o této sekci ·
   5–8 min". Na telefonu spodní panel.
2. RYCHLÝ A ÚPLNÝ PRŮVODCE SEKCE. Rozšiř engine tutoriálu o
   průvodce po sekcích: pro KAŽDOU sekci (nástěnka a widgety,
   milníky a mapa, poznámky a sdílení, kontakty, Cold Calling,
   pipeline a obchod, úkoly, kalendář a sdílení, plánovač,
   finance a plánovací tabulka, faktury, správa firmy, odměny,
   zprávy, Grady, nastavení a vzhled, připojené aplikace; v
   administraci hlavní skupiny) dvě sady kroků jako data: rychlá
   (5–8 kroků, jen se dívá) a úplná (všechny funkce sekce včetně
   skrytých za „Další možnosti", s kroky „zkus si to" na
   ukázkových datech). Texty pevné v překladech, bez volání
   modelu. Kroky filtrované podle práv uživatele (30.2).
   Katalog prvků: každý ovládací prvek, na který průvodce
   ukazuje, má data-tutorial klíč a záznam v
   src/features/tutorial/ui-map.ts (klíč, sekce, cesta jak se
   k němu dostat — např. „otevři detail obchodu → záložka Úkoly",
   lidský název, k čemu je, potřebné právo). Test hlídá, že
   každý klíč v ui-map v aplikaci existuje a naopak.
3. VLASTNÍ TUTORIÁL. Uživatel napíše otázku („jak dám
   pracovníkovi odměnu za schůzku?"). Grady (funkce
   guide_answer; model podle 27.3, výchozí Haiku se zvýšením na
   Sonnet při nejasnosti) dostane otázku, aktuální sekci, práva
   uživatele a ui-map (jen relevantní část, vyhledanou podle
   otázky) a vrátí strukturovaně: krátkou odpověď (2–3 věty)
   a posloupnost kroků z klíčů ui-map (přejdi do sekce, otevři,
   zvýrazni, „klikni sem", „vyplň", počkej až uživatel udělá).
   Engine kroky přehraje stejným overlayem jako tutoriál: Grady
   přijde k prvku, řekne větu, zvýrazní, počká na akci uživatele
   (kontrola stavem), pokračuje; když je cíl v jiné sekci,
   zavede tam. Tlačítka: Další · Udělej to za mě (provede krok
   operací, kde je to bezpečné a vratné) · Zeptat se dál ·
   Ukončit. Model smí vracet jen klíče z ui-map — neplatný krok
   se zahodí a Grady řekne, co ví slovy. Když otázka není
   o ovládání („jak mám nacenit službu?"), Grady předá do
   běžného chatu. Když funkci uživatel nemá v právech, řekne
   to a nabídne požádat majitele. Když funkce neexistuje,
   řekne to a nabídne „Navrhnout funkci" (stávající nápady).
   Počítá se do stropu AI; odpovědi na časté otázky se ukládají
   (cache podle normalizované otázky + sekce + role + verze
   ui-map), takže opakovaná otázka je zdarma a okamžitá.
4. VEDENÍ K VLASTNÍMU TUTORIÁLU. Pole pro otázku je všude první.
   Po rychlé ukázce Grady: „Na cokoli dalšího se mě zeptej"
   s polem. Grady sám nabídne pomoc, když uživatel v sekci tápe
   (deterministické signály: 3× otevřený a zavřený tentýž dialog
   bez uložení, 2 minuty v sekci bez akce při první návštěvě,
   opakovaný návrat na stejné místo, chybová validace 3× po
   sobě) — bublina „Nevíš si rady? Napiš mi, co potřebuješ
   udělat" s polem; nejvýš jednou za sekci a den, respektuje
   nastavení Gradyho a tiché hodiny, jde vypnout („už nenabízet").
   První návštěva nové sekce: nenápadná nabídka rychlé ukázky.
5. Hledání ⌘K: otázka začínající „jak" nabídne „Zeptat se
   Gradyho a ukázat". Stejné otázky umí Grady v chatu (tlačítko
   „Ukázat na obrazovce" u odpovědi o ovládání).
6. Administrace: nejčastější otázky uživatelů podle sekce (text
   otázky anonymně, bez uživatele) jako podklad, co v aplikaci
   není jasné; widget „Na co se lidé ptají".
7. Testy: ui-map úplnost; přehrávač kroků; pro 30 vzorových
   otázek (tests/fixtures/guide/) s mockem modelu správná
   posloupnost; E2E: otázka → Grady provede třemi kroky přes dvě
   sekce → uživatel akci dokončí; uživatel bez práva dostane
   vysvětlení místo kroků.
```

---

## Prompt 30.9 — Srozumitelnost celé aplikace · **Fable 5.1**

```
Gradus narostl: přes 15 sekcí, stovky nastavení. Projdi ho jako
člověk, který ho vidí poprvé, a zjednoduš, aniž bys cokoli
odebral. Skill frontend-design. Výstupem jsou změny v kódu,
ne jen dokument.

1. PRŮCHOD. Jako nový majitel a jako nový pracovník (šablona
   Obchodník) projdi každou sekci na 1440 i 390 px, snímky do
   docs/srozumitelnost/before/. U každé obrazovky zapiš do
   docs/srozumitelnost/nalezy.md: co je hlavní akce, je-li
   vidět do 3 sekund, kolik ovládacích prvků soupeří o pozornost,
   která slova nejsou jasná, kde chybí prázdný stav s dalším
   krokem.
2. MENU. Levé menu má příliš mnoho položek: seskup do nejvýš
   5–6 skupin s oddělovači (např. Dnes: Přehled, Úkoly, Kalendář
   · Obchod: Kontakty, Cold Calling, Pipeline, Plánovač ·
   Podnikání: Milníky, Poznámky, Finance · Firma: Správa firmy,
   Zprávy), pořadí podle četnosti použití; uživatel si může
   položky připnout, skrýt a přeskládat (Nastavení → Vzhled →
   Menu), sekce bez práv se neukazují. Sbalené menu a spodní
   lišta na telefonu podle stejné logiky. Adresy se nemění.
3. JEDNA HLAVNÍ AKCE na obrazovce (výrazné tlačítko vždy na
   stejném místě), ostatní akce v nabídce ⋯ nebo za „Další
   možnosti". Dialogy: nejvýš 5 polí napoprvé, zbytek sbalený;
   povinné jen to nutné; rozumné výchozí hodnoty všude.
4. SLOVNÍK. Sjednoť názvy stejných věcí napříč aplikací
   (úkol/task, obchod/příležitost/deal, pracovník/člen/uživatel,
   schůzka/událost/rezervace…) — tabulka v docs/slovnik.md
   (CS i EN), oprav překlady a doplň pravidlo do CLAUDE.md.
   Žádný technický výraz v rozhraní (token, sync, ID kromě
   „tvé ID").
5. PRÁZDNÉ STAVY A PRVNÍ KROK: každá sekce bez dat říká jednou
   větou k čemu je, nabídne jednu akci a odkaz na rychlou ukázku
   (30.8). Nápovědné bubliny u ikon bez popisku. Konzistentní
   potvrzení po akci a Zpět tam, kde je akce vratná.
6. NASTAVENÍ: po všech kolech zkontroluj strukturu (skupiny,
   hledání, hluboké odkazy), přesuň zatoulané volby, u každé
   stránky jedna věta co nastavuje.
7. Snímky po, tabulka před/po v nalezy.md s počtem prvků na
   obrazovce. E2E projdou (selektory uprav, chování ne);
   tutoriály a ui-map (30.8) aktualizuj podle přesunů.
```

---

## Kontrola fáze 30 · **Opus 5.5**

```
Zkontroluj fázi 30 podle CLAUDE.md:
- sdílení kalendáře: busy nikdy neprozradí název ani místo,
  soukromá událost skrytá při každé úrovni i přes API, Gradyho
  a MCP; write nesmí měnit sdílení; žádosti nejdou zneužít ke
  spamu; odebraný člen ztrácí přístup hned,
- plánovač: obsazenost jen ze zaškrtnutých zdrojů, veřejná
  rezervace do plného termínu nejde ani při souběhu, „Přesto
  naplánovat" jen pro přihlášené s právem; volající vidí z
  cizího kalendáře jen volno/plno; booking z Cold Callingu
  dělá totéž co veřejný,
- online stav: vypnutí skryje oběma směry, nic mimo firmu,
  žádná historie,
- vzhledy: žádné vlastní CSS, tokeny validované na serveru,
  kontrast vynucený, přechod se nikdy nespustí při psaní,
  první vykreslení bez probliknutí,
- průvodci: model vrací jen klíče z ui-map, „Udělej to za mě"
  jen vratné operace v rámci práv, cache neprosakuje mezi
  rolemi a prostory, otázky v administraci anonymní,
- práva před pozváním platí od první vteřiny; tutoriál podle
  práv nemíří na nepovolené,
- denní souhrn: jeden e-mail na administrátora a den, omezený
  admin bez peněz; žádné okamžité e-maily o chybách,
- filtr šumu chyb neschová skutečnou chybu (projdi pravidla),
- po 30.9 zůstala každá funkce dostupná a adresy fungují,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 23.4 | RUČNĚ`

=== ZAČÁTEK
- [ ] 30.1 | architect | env: RESEND_API_KEY
- [ ] 30.2 | architect |
- [ ] 30.3 | architect |
- [ ] 30.4 | architect | env: RESEND_API_KEY
- [ ] 30.5 | architect |
- [ ] 30.6 | architect |
- [ ] 30.7 | designer |
- [ ] 30.8 | architect | env: ANTHROPIC_API_KEY
- [ ] 30.9 | designer |
- [ ] K30 | reviewer |
- [ ] STOP | Konec fáze 30. Nahraj profilovou fotku. Přečti docs/chyby-2026-11.md a docs/emaily.md a rozhodni, které e-maily sloučit. Ráno v 6:00 zkontroluj denní souhrn. Pozvi pracovníka s právy nastavenými předem a projdi jeho tutoriál. Požádej Vášu o sdílení kalendáře, zkus „Najít společný čas" a soukromou událost. V plánovači zaškrtni zdroje obsazenosti, pak jako cold caller přesuň kontakt do Domluvené schůzky a vyber termín. Nastav rozvrh vzhledů se třemi bloky a posuň si začátek bloku na za dvě minuty, ať vidíš přechod; vytvoř vlastní vzhled. V každé sekci zkus otazník a zeptej se Gradyho na tři věci vlastními slovy. Projdi nové menu a docs/srozumitelnost/nalezy.md. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek`. První poběží 30.1.
