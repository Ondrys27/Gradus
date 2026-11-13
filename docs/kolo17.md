# Po schůzce 13. 11.: chyby, administrace pro Vášu, modely AI, ukázkový režim — kolo 17

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Do `docs/plan.md` přidej tohle PŘED sekci `## Odloženo` (když tam není, na konec)

=== ZAČÁTEK

---

# FÁZE 27 — Po schůzce 13. 11.

*Od pondělí 16. 11. pouští Ondřej i Váša do Gradusu své lidi (ostrý provoz v malém). Proto jdou první dvě chyby, na které se při schůzce narazilo. Odloženo a nedělat: vyšší tarif s lepším modelem, vlastní klíč Claude uživatele, automatický Google Meet (čeká na ověření u Googlu), odpovídání na hlášení z administrace.*

## Prompt 27.1 — Pozvánka pracovníka „vypršela" a hlášení, které se neukázalo · **Opus 5.5**

```
Dvě chyby ze schůzky 13. 11. Obě nejdřív reprodukuj a najdi
příčinu; v souhrnu napiš jednou větou, co to bylo.

A) POZVÁNKA PRACOVNÍKA. Majitel pozval pracovníka (šablona
Obchodník) na svůj druhý e-mail, odkaz z e-mailu otevřel nejdřív
v okně, kde byl přihlášený jako majitel, potom v anonymním okně —
registrace hlásila „Pozvánka vypršela nebo už byla použita".
Druhá pozvánka na stejný e-mail taky. Třetí pokus s jiným e-mailem
prošel (přes „Confirm your email").
1. Reprodukuj v Playwrightu tyhle cesty: odkaz otevřený přihlášeným
   majitelem; přihlášeným jiným účtem; dvakrát po sobě; po
   opětovném odeslání pozvánky; pozvánka na e-mail, který už v
   Gradusu účet má; pozvánka na adresu, pod kterou už jedna
   nepřijatá pozvánka existuje; odkaz přepsaný e-mailovým klientem
   (náhled odkazu / bezpečnostní sken, který odkaz „navštíví" dřív
   než člověk — GET nesmí pozvánku nikdy spotřebovat).
2. Pravidla po opravě: pozvánku spotřebuje až dokončená registrace
   nebo přijetí, nikdy pouhé otevření. Otevření přihlášeným jiným
   účtem ukáže „Jsi přihlášený jako X. Pozvánka je pro Y." s
   tlačítky Odhlásit a pokračovat / Zůstat. Existující účet se
   stejným e-mailem → přihlášení a přijetí (22.5), ne registrace.
   Nová pozvánka na stejný e-mail starou zneplatní a majitel to
   vidí („nahrazena novější"). Chybová hláška říká skutečný důvod
   (vypršela dne…, už použita, zrušena majitelem, nahrazena) a
   nabízí „Požádat o novou" (pošle majiteli oznámení).
3. Ověřovací e-mail po registraci z pozvánky je v jazyce pozvaného
   a v šabloně Gradusu (při schůzce přišel anglický „Confirm your
   email"); pozvánka sama e-mail ověřuje, takže druhé potvrzení
   nevyžaduj, pokud se e-mail shoduje s adresou pozvánky.
4. Štítek „navíc 290 Kč" u pozvaného pracovníka ve Správě firmy:
   dokud se neprodává (platby v testovacím režimu), ukaž ho jen
   s vysvětlením „po spuštění plateb" nebo ho skryj podle
   přepínače prodeje.

B) HLÁŠENÍ SE NEUKÁZALO. Ondřej nahlásil problém z aplikace (přes
Gradyho), Váša v administraci → Zpětná vazba → Hlášení nic neviděl
ani po obnovení.
1. Zjisti, kde hlášení skončilo: nezapsalo se (Grady hlášení
   neumí a jen to řekl?), zapsalo se a skrývá ho výchozí filtr
   interních účtů, nebo ho role admin nevidí.
2. Po opravě: hlášení z interních účtů jsou v seznamu vždy vidět
   se štítkem „interní" (filtr interních se na Hlášení a chyby
   nevztahuje); admin i majitel vidí totéž; nové hlášení se objeví
   bez obnovení stránky nebo s tlačítkem Obnovit a počtem nových.
3. GRADY CHYBY NEHLÁSÍ. Rozhodnutí: Grady sám hlášení nezakládá
   (lidé by mu psali nadávky a všechno by padalo do administrace).
   Když uživatel chce něco nahlásit nebo si stěžuje na chybu,
   Grady odpoví krátce a nabídne tlačítko „Nahlásit problém",
   které otevře stávající formulář hlášení (ten se snímkem
   obrazovky) předvyplněný stránkou, ne textem chatu. Odeber
   případnou Gradyho akci, která hlášení zakládá sama; doplň
   pravidlo do docs/grady-pravidla.md a do promptu.
4. Na veřejném webu a v patičce aplikace odkaz Podpora →
   stránka /podpora s formulářem (i pro nepřihlášené, limit podle
   IP), která zapisuje do stejných hlášení.
5. Chyba ze schůzky: v administraci po „Zrušit filtry" zmizely
   ikony/ovládání nahoře a vrátily se až po přidání filtru —
   reprodukuj a oprav.
E2E pro A (všechny cesty z bodu 1) i B (hlášení interního účtu je
vidět adminovi).
```

---

## Prompt 27.2 — Plný administrátor a log chyb · **Opus 5.5**

```
Váša je spolumajitel a má v administraci dělat totéž co Ondřej.
Dnes role admin spoustu věcí jen čte (docs/admin-roles.md).

1. ÚROVNĚ ADMINISTRÁTORA. Role admin dostane úroveň: „plný"
   (všechno jako majitel) a „omezený" (dnešní chování). Sloupec
   level u role/ pozvánky; majitel ji nastaví při pozvání a změní
   v sekci Administrátoři. Plný administrátor smí: tarify (koncept,
   zveřejnění, historie), stropy AI a výjimky, pravidla Gradyho,
   modely AI (27.3), předplatné uživatelů, promo kódy včetně výplat,
   upozornění na chyby, jazyky, změnu e-mailu uživatele, exporty
   s osobními údaji, ukázkový režim (27.4). Jen majiteli zůstává:
   sekce Administrátoři (zvát, měnit úroveň, odebírat) a cokoli,
   co by majitele odebralo nebo převedlo vlastnictví. Projdi
   KAŽDÝ řádek tabulky v docs/admin-roles.md, uprav adminCan /
   requireOwnerFor / admin_require_owner() na „owner nebo plný
   admin" a tabulku přepiš (sloupce: majitel · plný · omezený).
   Databázové funkce ověřují úroveň samy, ne jen rozhraní.
   Stávajícího admina (Váša) migrace nastaví na plný.
2. Audit u každé změny ukazuje, kdo ji udělal (jméno, ne role);
   u zveřejnění tarifů a změny stropů přijde druhému z dvojice
   e-mail „Váša změnil…", vypnutelný.
3. LOG CHYB. Administrace → Provoz → Chyby (dnes je v Upozornění
   na chyby jen nastavení e-mailů): seznam všech zachycených chyb,
   seskupených podle otisku: kód posledního výskytu, zpráva, kde
   (stránka/akce), kolikrát, kolik uživatelů, poprvé a naposledy,
   verze nasazení, stav Nová · Řeší se · Vyřešená · Ignorovat.
   Rozklik: jednotlivé výskyty (čas, uživatel s odkazem na detail,
   prohlížeč, stack prvních 10 řádků), odeslané e-maily k této
   chybě (kdy, komu), navázaná hlášení uživatelů se stejným kódem.
   Hledání podle kódu GR-…, filtr stavu, období a „jen po posledním
   nasazení". Vyřešená chyba, která se objeví znovu, se vrátí do
   Nových se štítkem „vrátila se". Nastavení e-mailů zůstane jako
   záložka téže stránky. Žádný obsah uživatelských dat.
4. KDE CO JE. Administrace je přeplněná a i majitel v ní hledá.
   Přidej: a) ⌘K v administraci hledá i jednotlivá nastavení a
   akce („strop AI", „promo kód", „reset hesla", „zveřejnit tarify")
   a skočí přímo na ně se zvýrazněním; b) stránku Nápověda v menu
   administrace generovanou z jednoho souboru
   (src/features/admin/help-index.ts): pro každou sekci 1–2 věty
   co v ní je a seznam věcí, které se tam nastavují, s odkazy;
   Vitest hlídá, že každá sekce z nav.ts v indexu je.
5. E2E: plný admin změní cenu v konceptu tarifu a zveřejní;
   omezený admin totéž nevidí; RPC voláno přímo omezeným adminem
   = odmítnuto; log chyb ukáže uměle vyvolanou chybu, změna stavu,
   návrat po novém výskytu. Aktualizuj CLAUDE.md a
   docs/admin-roles.md.
```

---

## Prompt 27.3 — Model AI pro každou funkci, nastavitelný v administraci · **Opus 5.5**

```
Dnes je přiřazení modelů napevno v src/features/grady/models.ts
(classify/check/summary/opportunity_scan → Haiku; chat,
milestone_review, reward_setup, email_reply, briefing,
note_map_suggest… → Sonnet; analysis → Opus). Majitelé chtějí
náklady řídit sami z administrace.

1. NASTAVENÍ. app_settings klíč grady_models: pro každou funkci
   z katalogu model (haiku | sonnet | opus | fable | další, až
   přibudou) + globální „úsporný režim". Výchozí = dnešní
   přiřazení. Katalog funkcí je jeden zdroj pravdy v kódu
   (klíč, český název, co dělá, doporučený model a proč,
   minimální model — funkce, která potřebuje strukturovaný výstup
   nebo dlouhý kontext, nesmí jít pod své minimum). models.ts čte
   nastavení s cache 30 s; neznámý nebo nedostupný model → výchozí
   a záznam do logu chyb.
2. ADMINISTRACE → AI a Grady → záložka Modely: tabulka funkcí:
   název · co dělá · model (výběr) · volání za 30 dní · průměrná
   cena volání · útrata za 30 dní · odhad „kdyby běžela na
   Haiku/Sonnet/Opus" (z tokenů v ai_usage a ceníku costs.ts).
   Nahoře součet a tři tlačítka přednastavení: Úsporné (vše, co
   smí, na Haiku) · Vyvážené (doporučené) · Kvalitní. Změna s
   potvrzením a do admin_audit; platí do minuty. Dostupné modely
   se berou z jednoho seznamu v costs.ts (id, název, ceny, datum
   ověření) — přidání nového modelu = jeden řádek; ověř v
   dokumentaci Anthropic aktuální id a ceny Haiku, Sonnet, Opus
   a Fable a zapiš zdroj a datum.
3. CHAT. U funkce chat tři volby: pevný model, nebo „automaticky":
   před odpovědí levné rozhodnutí (pravidla bez modelu podle délky
   zprávy, přítomnosti přílohy, klíčových záměrů typu „rozbor",
   „plán", „spočítej"; jen když pravidla nerozhodnou, jedno
   volání Haiku s max 20 výstupními tokeny), které vybere Haiku
   nebo Sonnet; Opus/Fable automaticky nikdy, jen když je to v
   nastavení výslovně povoleno pro „velké rozbory". Rozhodnutí se
   loguje do ai_usage (sloupec routed_from), aby bylo vidět, kolik
   to ušetřilo. Výchozí pro chat: automaticky.
4. ÚSPORNÝ REŽIM MÍSTO VYPNUTÍ. Dnes při 100 % měsíčního stropu
   Grady přestane. Nově: při dosažení prahu (výchozí 80 %) se
   automaticky zapne úsporný režim — všechny funkce jdou na svůj
   minimální model — a teprve při 100 % se pozastaví. Majitel
   dostane e-mail „Grady přešel do úsporného režimu" (jednou).
   Uživatel nic nepozná kromě kratších odpovědí. Totéž na úrovni
   uživatele: při 80 % jeho stropu úsporný režim jen pro něj.
   Přepínač „úsporný režim teď" jde zapnout i ručně.
5. Strop na uživatele: v administraci je teď 10 USD/měsíc — nech,
   jen ověř, že výpočet stropu podle období (15.4) a nové prahy
   spolu sedí.
6. Vitest pro výběr modelu (nastavení, minimum, úsporný režim,
   auto-routing pravidel), E2E: přepnout chat na Haiku → další
   zpráva má v ai_usage Haiku; přednastavení Úsporné. Doplň
   CLAUDE.md, docs/grady-pravidla.md a docs/funkce.md (ceny podle
   modelu).
```

---

## Prompt 27.4 — Ukázkový režim: aplikace, která se předvede sama · **Opus 5.5**

```
Pro marketingová videa: třetí režim tutoriálu „Ukázka" (pracovně
Beta), ve kterém se aplikace ovládá sama — kurzor jezdí, kliká,
píše — takže stačí nahrát obrazovku. A skript, kterým video
nahraje Claude Code sám.

1. REŽIM UKÁZKA v enginu tutoriálu (src/features/tutorial):
   kroky jako data { key, section, akce: move | click | type |
   drag | scroll | wait | caption }, s cíli přes data-tutorial
   atributy. Viditelný falešný kurzor (plynulý pohyb po křivce,
   zvýraznění kliknutí), psaní po znacích lidským tempem, titulky
   dole (i18n, max 8 slov), žádná Gradyho bublina, žádné ztmavení.
   Běží nad ukázkovými daty (is_demo z tutoriálu) v čistém demo
   prostoru: realistická jména firem a kontaktů podle jazyka
   (CS: české firmy, EN: anglické), částky v měně jazyka, žádná
   skutečná data účtu. Po skončení nebo Esc se demo data smažou.
2. SCÉNÁŘE (src/features/tutorial/demo-scripts.ts), každý
   30–60 s, spustitelný zvlášť nebo všechny za sebou:
   a) „Od nápadu k prvnímu klientovi": milník s mapou úkolů →
      vygenerování kontaktů → Cold Calling přesun do Domluvená
      schůzka → obchod v pipeline → výhra s oslavou;
   b) „Grady": dotaz v chatu → odpověď z poznámek → zápis do
      poznámek → ranní souhrn;
   c) „Plánovač schůzek": typ schůzky → odkaz → veřejná stránka →
      rezervace → kalendář a kontakt;
   d) „Firma": pozvání pracovníka → práva → úkol → zprávy;
   e) „Peníze": faktura s QR → plánovací tabulka financí;
   f) „Celý Gradus za 60 sekund": sestřih toho nejlepšího.
   Volání modelu se v ukázce nahrazují připravenými odpověďmi
   (žádné náklady, vždy stejný výsledek).
3. OVLÁDÁNÍ. Spouští se z /app/ukazka?scenar=a&jazyk=en&velikost=
   1920x1080 (a 1080x1920 pro svislá videa, 1080x1080 čtverec):
   stránka nastaví jazyk, velikost plátna, skryje štítek Beta,
   oznámení, Gradyho a cokoli osobního, odpočítá 3-2-1 a hraje.
   Mezerník pauza, R znovu. Dostupné jen účtům s rolí majitel/
   admin aplikace a jen když je v administraci → Nastavení
   zapnutý přepínač „Ukázkový režim" (app_settings; výchozí
   vypnuto; vypnutím zmizí i volba v tutoriálu). Běžný uživatel
   režim nevidí.
4. NAHRÁVÁNÍ BEZ ČLOVĚKA. Skript bun run demo:record -- --scenar
   a --jazyk cs,en --velikost 1920x1080,1080x1920: přes Playwright
   se přihlásí interním @gradus.local účtem, otevře ukázku a uloží
   video (recordVideo, webm → mp4 přes ffmpeg, pokud je v systému;
   jinak nech webm a napiš jak převést) do
   marketing/videa/<scenar>-<jazyk>-<velikost>.mp4 (složka v
   .gitignore) + titulky jako .srt ze stejných textů. Spusť ho
   jednou pro scénář f v cs a en a v souhrnu napiš, kde videa
   jsou a jak vypadají (délka, velikost souboru).
5. docs/marketing/scenare.md: ke každému scénáři text titulků
   CS/EN, co se děje po vteřinách a doporučený text příspěvku —
   podklad pro Vášu a střih.
6. Vitest pro přehrávač kroků, E2E: scénář a doběhne bez chyby
   v cs i en, po skončení nezůstanou demo data. Doplň CLAUDE.md
   sekci Tutoriál.
```

---

## Prompt 27.5 — Odkaz na videohovor u rezervace · **Opus 5.5**

```
Plánovač posílá trvalý odkaz na videohovor z nastavení. Váša
namítl, že jeden odkaz pro všechny je slabý a že po změně odkazu
staré pozvánky vedou jinam. Než bude automatický Google Meet:

1. E-mail s potvrzením, ICS pozvánka i připomínky neobsahují
   přímo odkaz na hovor, ale odkaz „Připojit se ke schůzce" na
   stránku rezervace (/s/r/<token>), která ukáže aktuální odkaz
   na hovor a přesměruje na něj jedním klikem. Změna odkazu u
   hostitele se tak projeví i u už odeslaných pozvánek.
2. Hostitel může u konkrétní rezervace (detail v Plánovači i v
   kalendáři) zadat vlastní odkaz jen pro tuhle schůzku; host
   dostane e-mail „Odkaz na schůzku byl upraven" jen když do
   schůzky zbývá víc než hodina.
3. U typu schůzky volba „Jedinečná místnost pro každou
   rezervaci": Gradus vygeneruje odkaz na Jitsi (meet.jit.si/
   gradus-<náhodných 12 znaků>) pro každou rezervaci zvlášť —
   bez účtu, zdarma. Výchozí zůstává trvalý odkaz z profilu;
   v nápovědě vysvětli rozdíl.
4. Když typ schůzky je video a není vyplněný žádný odkaz ani
   Jitsi, editor na to upozorní a rezervace se potvrdí s textem
   „Odkaz pošle <hostitel> před schůzkou" + úkol hostiteli.
5. Stránka rezervace 15 minut před začátkem zvýrazní tlačítko
   Připojit se; po skončení ukáže poděkování.
E2E: rezervace → změna odkazu hostitelem → stará pozvánka vede
na nový odkaz; Jitsi místnost je pro dvě rezervace různá.
```

---

## Kontrola fáze 27 · **Opus 5.5**

```
Zkontroluj fázi 27 podle CLAUDE.md a docs/admin-roles.md:
- pozvánky: GET nikdy nespotřebuje pozvánku; všechny cesty z 27.1
  mají test; hlášení interních účtů vidí majitel i admin; Grady
  nemá žádnou akci, která hlášení založí,
- plný admin: každá akce z tabulky rolí ověřena na serveru i v DB
  funkci; omezený admin nic z toho nespustí ani přes RPC; plný
  admin nemůže spravovat administrátory ani odebrat majitele,
- log chyb bez uživatelských dat; seskupení podle otisku stabilní
  mezi nasazeními,
- modely: žádná funkce pod svým minimem; neznámý model nespadne;
  úsporný režim se zapne na prahu a vypne s novým měsícem;
  auto-routing chatu nestojí víc, než ušetří (spočítej z testů),
- ukázkový režim: nedostupný běžným účtům ani přes URL, žádné
  volání modelu, žádná skutečná data na plátně, demo data po
  skončení pryč,
- odkaz na hovor: token stránky rezervace neprozradí nic dalšího,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 23.4 | RUČNĚ`

=== ZAČÁTEK
- [ ] 27.1 | architect | env: RESEND_API_KEY
- [ ] 27.2 | architect |
- [ ] 27.3 | architect | env: ANTHROPIC_API_KEY
- [ ] 27.4 | architect |
- [ ] 27.5 | architect | env: RESEND_API_KEY
- [ ] K27 | reviewer |
- [ ] STOP | Konec fáze 27. Pozvi pracovníka na svůj druhý e-mail a otevři odkaz schválně nejdřív přihlášený, pak v anonymním okně — registrace musí projít. Nahlas problém z aplikace a ověř s Vášou, že ho vidí v administraci; zeptej se Gradyho „chci nahlásit chybu". Váša jako plný admin změní cenu v konceptu tarifů. Projdi Provoz → Chyby. V AI a Grady → Modely zkus přednastavení Úsporné a pošli zprávu Gradymu. V administraci zapni Ukázkový režim, přehraj scénář f v češtině a angličtině a podívej se na videa v marketing/videa. Rezervuj si schůzku s Jitsi místností. V Tarifech nastav dohodnuté ceny (490 Kč měsíčně, 390 Kč měsíčně při roční platbě, 14 dní zdarma) a zveřejni. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, přidej `marketing/videa/` do `.gitignore`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek` nebo `/clear` a `/pokracuj`. První poběží 27.1.
