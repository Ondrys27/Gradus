# Widgety administrace: diagnóza před 29.3 a co se změnilo

Snímky v `before/` a `after/` (1440 a 390 px): `board-*` = všechny widgety ve výchozí velikosti, `size-S|M|L|XL-*` = každý widget v dané velikosti, `editing-*`, `gallery-*`, `detail-*` (Chyby). Pořizuje `bun scripts/admin-widgets-shots.ts before|after` nad dočasným plným administrátorem s několika vlastními skupinami chyb; `fps` měří snímkovou frekvenci s 25 widgety (výsledky ve `fps/README.md`).

## Před (29.2)

- **Velikost = zmenšenina.** S a M jsou totéž číslo s jinou šířkou (Zkoušky, Neúspěšné platby, Platící podle tarifu, Plánovač, MCP); L je M s prázdným spodkem (Tržby, Nejdražší uživatelé AI, AI podle funkce, Hra, Spokojenost, Audit). M nemá trend: změna proti minulému období se ukáže jen u čísel z registru metrik, sparkline nikdy (předbíhají ji vedlejší čísla).
- **Barva jako dekorace.** Zelený hrdina u „0 Kč“ (marže), „0,60 USD“ (spotřeba AI), „0,00 USD“ (kde ušetřit), zlatý u „67 chyb od nasazení“ i „1 nová hlášení“. Stav tak není poznat od ozdoby.
- **Chyby si odporují.** Hrdina „0 nové dnes“ zeleně, pod ním 74 otevřených a tři červené řádky; klid nebo požár se z karty nepozná. Nová chyba se neobjeví nijak zvlášť.
- **Sparkline dostává surová čísla** (kit čeká 0–1), takže by ležela na stropě. Sloupce z kitu (`Columns`) měly obal bez výšky, procentní výška sloupců se tím ztratila (týkalo se i aplikace).
- **Hustota** jako v aplikaci: jedno číslo a věta, zbytek vzduch. Na pracovní nástroj málo.
- **Telefon (390 px):** M widgety ořezávají štítek „testovací data“ a druhý řádek čísel, L mají prázdnou polovinu.

## Po (29.3)

- **Každá velikost má vlastní kompozici** (`views.tsx`, `defs/errors.tsx`): S = jedno číslo a jeho stav (u stavových widgetů tečky stavů); M = číslo + změna proti minulému období (`Delta`) + trend (sparkline dnů, sloupce posledních 14 dnů, měřidlo nebo pruh stavů); L = číslo, pásek dalších čísel, seznam s pruhy nebo graf a akce „Otevřít sekci“; XL = čísla v řadě, graf celého období vedle seznamu, akce.
- **Barva = stav.** Růžová jen tam, kde je potřeba zásah (nové chyby dnes, neúspěšné platby, strop AI, záporná marže), zlatá kde něco čeká, zelená jen klidná nula problémového počtu (chyby, neúspěšné platby, v ohrožení, čeká na mě). Marže, spotřeba AI, úsporný režim a kde ušetřit jsou neutrální.
- **Chyby:** hrdina je počet otevřených; růžový, když dnes nějaké přišly, zlatý, když zůstávají starší, zelená klidná nula s „Žádná otevřená chyba“. Pod ním sloupce chyb po dnech a nejčastější skupiny s kódem v mono, počtem a tečkou (nová / vrátila se). Skupina, která se objevila mezi dvěma načteními (každou minutu), dostane na 4 s jemný růžový podsvit (`animate-error-flash`), žádný poplach; `prefers-reduced-motion` nic. Detail s rychlou změnou stavu zůstal (stejné selektory pro E2E).
- **Vyšší hustota:** pásek `Ribbon` (název nad číslem, hairline mezi), `StatusDots` (zdraví, čeká na mě), `Gauge` s prahem (spotřeba AI proti stropu, úsporný režim), `RankedInline` (země, úrovně), verze nasazení v mono. Porovnání s minulým obdobím přibylo i u událostí (předplatná, tutoriál, plánovač, MCP).
- **Opravy v kitu:** `Columns` má obal s plnou výškou (sloupce konečně rostou); sparkline se v administraci škáluje na 0–1 (`Trend`), popisky dnů jsou jen první a poslední den.
- **Pohyb** je sdílený s aplikací (režim úprav, galerie, rozklik, reduced motion); s 25 widgety 60 fps vlnění, tažení 59 fps (CPU ×4: 60 / 47).
- **Telefon:** M widgety mají menší hrdinu, pásek v jednom řádku a nižší sparkline, nic se neořezává; spodní lišta administrace a rohová tlačítka 44 px zůstávají.

### Co zůstává otevřené

- Tržby L/XL bez plateb a bez grafu po dnech mají prázdný střed; graf tržeb po dnech přibude s metrikou příjmů po dnech.
- Sloupce chyb po dnech ukazují jen chyby účtů mimo interní (filtr horní lišty), takže při vypnutém „Včetně interních účtů“ mohou být na vývojové databázi prázdné.
