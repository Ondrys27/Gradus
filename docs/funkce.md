# Co Gradus umí a co nás to stojí

Tenhle přehled je pro návrh tarifů. Popisuje, co aplikace a Grady umí, kdo co používá a kolik nás stojí provoz. Píše se z kódu a drží se aktuální: kdo přidá funkci, připíše ji sem. `bun run docs:funkce` porovná dokument s kódem a vypíše, co v něm chybí (v textu jsou na to skryté značky `<!-- kód: … -->`, při čtení nejsou vidět).

Stav k 9. 11. 2026.

**Jak číst štítky nákladu**

| Štítek | Co znamená |
|---|---|
| **žádný** | Jen naše databáze a server. Za jedno použití neplatíme nic navíc. |
| **AI** | Volá model Claude (Grady). Platíme za tokeny, každé volání je zapsané v `ai_usage` s cenou. |
| **Google Maps** | Volá Google Places API. 0,035 USD za jeden požadavek (do 20 firem). |
| **e-mail** | Odejde e-mail přes Resend. Asi 0,0009 USD za kus, k tomu paušál Resendu. |
| **úložiště** | Uloží soubor (PDF, obrázek, dokument). V praxi skoro zadarmo, viz tabulka nákladů. |
| **Stripe** | Platba předplatného kartou přes Stripe. Stripe si z každé úspěšné platby strhne poplatek podle svého ceníku; samotné volání API nic nestojí. |

**Pro koho:**
- **majitel** je ten, kdo má účet a firmu.
- **pracovník** je člověk, kterého majitel pozval do své firmy. Vidí jen to, k čemu dostal právo.

---

## 1. Části aplikace

### Nástěnka
<!-- kód: nav:dashboard route:/app -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Pozdrav a dnešek | Pozdraví podle denní doby a jednou větou řekne, co dnes čeká. | majitel | žádný |
| Čeká na tebe | Karty s rozhodnutím přímo na nich: schůzky ke schválení (Potvrdit / Odmítnout), pozvánky do cizí firmy (Přijmout / Odmítnout) a proběhlé rezervované schůzky s dotazníkem. Bez ničeho se neukáže. | majitel, pracovník | žádný |
| Co hoří | Tři dlaždice ukazují, co je v obchodech špatně: obchody po termínu uzavření, úkoly po termínu a obchody bez dalšího kroku. Klik vede do pipeline. | majitel, pracovník s pipeline | žádný |
| Co dnes udělat | Dnešní úkoly, schůzky, lidé k ozvání a obchody, které stojí. Po pracovní době místo výzvy volat řekne, že lidé teď nezvedají. | majitel | žádný |
| Přehled z widgetů | Nástěnka je plocha z widgetů jako na iPhonu: 25 widgetů (Dnes, Čeká na tebe, Úkoly po termínu, Pipeline podle fází, Co hoří, Nejbližší schůzky, Týden v kalendáři, Finance měsíce, Vývoj kapitálu, Faktury po splatnosti, Cold Calling dnes, Milníky, Úroveň a série, Grady s rychlým dotazem, Tým, Aktivita ve firmě, Odměny, Připnutá poznámka, Rychlé akce, Rezervace, Spokojenost a dřívější čísla: splněné úkoly, úspěšnost obchodů, nové kontakty, odpracovaný čas) ve velikostech 1×1 až 4×2. Upravit (i dlouhý stisk): přetahování, změna velikosti, odebrání, nastavení widgetu, galerie s živými náhledy, Zpět ⌘Z, Obnovit výchozí; ukládá se samo. Klik widget zvětší do detailu s tlačítkem Otevřít sekci. Až 6 přehledů jako záložky. Nový účet začíná na výchozím podle režimu (hra / bez hry) a oboru. Widget, na jehož data účet nemá právo, se nenabízí ani neukáže. | majitel, pracovník | žádný |
| Výchozí přehledy firmy | Správa firmy → Přehledy: majitel skládá přehled pro celou firmu, skupinu nebo jednoho člověka (platí člověk > skupina > firma > výchozí). Kdo si přehled upravil, dostane nový jen nabídnutý („Firma má nový přehled“); „Vrátit na firemní“ kdykoli. V právech pracovníka seznam widgetů, které smí používat (výchozí všechny, ke kterým má data). | majitel | žádný |
| Rozbor obchodních schůzek | V detailu úspěšnosti obchodů napíše Grady rozbor dotazníků ze schůzek: co funguje, co ne a co zkusit jinak. Odemkne se po 5 dotaznících. | majitel, pracovník | AI (Opus) |
| Dotazník spokojenosti | Po 14 dnech se zeptá na spokojenost 1–5 a co zlepšit, pak znovu po 30 dnech. | majitel, pracovník | žádný |
| Nástěnka pracovníka | Pracovník má stejnou plochu z widgetů: odpracovaný čas s časovačem, odměny (vyděláno a v plánu), úkoly, schůzky a co mu dovolí práva. | pracovník | žádný |

### Milníky a mapa
<!-- kód: nav:milestones route:/app/milniky route:/app/milniky/[id] -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Milníky a úkoly | Velké cíle rozdělené na úkoly a podúkoly do libovolné hloubky. Milník jde dokončit, až je všechno hotové. | majitel, pracovník s právem milníky | žádný |
| Cesta podle oboru | Po výběru oboru se založí připravené milníky s úkoly. V herním režimu postupně odemykají další části aplikace. | majitel | žádný |
| Odměna za milník | Majitel si k milníku napíše vlastní odměnu, při dokončení ji uvidí v oslavě. | majitel | žádný |
| Gradyho pohled | Hned po založení milníku k němu Grady napíše krátké hodnocení, a to u každého milníku jen jednou. | majitel, pracovník | AI (Sonnet) |
| Myšlenková mapa úkolů | Úkoly milníku jako mapa: přetahování, zoom, sbalování větví, celá obrazovka. | majitel, pracovník | žádný |
| Import mapy | Načte plán z Markdownu, OPML, FreeMindu, XMindu nebo textu s odsazením a udělá z něj úkoly. Soubor zpracuje server a nic z něj neukládá. | majitel, pracovník | žádný |
| Export mapy | Uloží úkoly jako Markdown, OPML, FreeMind nebo obrázek PNG. | majitel, pracovník | žádný |

### Poznámky
<!-- kód: nav:notes route:/app/poznamky -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Poznámky | Podklady k podnikání (ideální zákazník, ceník, konkurence, skript) na jednom místě, jako Apple Notes. Ukládá se samo. Každý má své poznámky v každé firmě, kde pracuje. | majitel, pracovník | žádný |
| Složky | Levý panel: Moje poznámky · Sdílené se mnou · složky (jedna úroveň podsložek, barva, přetažení poznámky do složky) · Koš. | majitel, pracovník | žádný |
| Sdílení ve firmě | Poznámku nebo složku jde sdílet člověku, skupině nebo celé firmě jako „může číst“ / „může upravovat“, volitelně „mohou sdílet dál“; přehled, kdo má přístup a odkud (přímo / ze složky). Poznámka ve sdílené složce dědí sdílení, jde ji nechat „v této složce soukromou“. Sdílení přijde do zvonku. Kdo odejde z firmy, přístup ztratí hned; jeho sdílené poznámky zůstanou firmě. | majitel, pracovník | žádný |
| Psaní víc lidí naráz | Sdílenou poznámku (text i mapu) píše víc lidí najednou jako v Google Docs: barevné kurzory a výběry se jménem, tváře právě přítomných, „Píše Váša…“, změny se slévají bez konfliktů. Čtenář vidí změny živě. Bez spojení se píše dál a po připojení se změny sloučí. Do 10 lidí naráz, další čte, dokud se místo neuvolní. Zpět vrací jen vlastní změny. | majitel, pracovník | žádný |
| Historie verzí | Kdo a kdy poznámku psal (verze za 10 minut práce se jmény všech autorů, nová i při zavření poznámky, posledních 50), starší verze jde obnovit. | majitel, pracovník | žádný |
| Šablony | Připravené osnovy (ideální zákazník, nabídka, ceník, konkurence, prodejní skript), každá i jako mapa. | majitel, pracovník | žádný |
| Myšlenková mapa místo textu | Poznámka jde psát jako mapa s barvami, poznámkami u uzlů a odkazy. Jde ji převést na text a zpátky. | majitel, pracovník | žádný |
| Odkazy na záznamy | Přes `@` jde do textu vložit kontakt, obchod, událost nebo pracovníka. U záznamu je pak vidět „Zmíněno v poznámkách“. Čtenář sdílené poznámky bez práva k záznamu vidí „Skrytý záznam“. | majitel, pracovník | žádný |
| Hledání a koš | Fulltext bez diakritiky, i ve sdílených poznámkách. Smazané poznámky leží 30 dní v koši; sdílenou maže jen vlastník, ostatní ji „Odeberou ze svých“. | majitel, pracovník | žádný |
| Navrhnout větve | U uzlu mapy Grady navrhne 3–8 nových větví, uživatel je ponechá nebo smaže. | majitel, pracovník | AI (Sonnet) |
| Grady čte poznámky | V chatu Grady vychází z poznámek uživatele i z těch, které s ním kolegové sdílejí (s autorem), ať se neptá na to, co už je zapsané. Upravuje jen tam, kde smí uživatel. | majitel, pracovník | AI (v ceně chatu) |

### Kontakty
<!-- kód: nav:contacts route:/app/kontakty route:/app/kontakty/[id] route:/app/kontakty/tabulky -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Vlastní tabulky kontaktů | Uživatel si nadefinuje tabulky (např. Neoslovení, Zájem, Klienti) a otázky, které se ptají při přesunu kontaktu. | majitel, pracovník s právem kontakty | žádný |
| Seznam a detail kontaktu | Hledání, údaje o firmě a osobě, aktivity (hovor, e-mail, schůzka, SMS, poznámka), navázané obchody. | majitel, pracovník | žádný |
| Upozornění na duplicitu | Při zakládání upozorní na stejný telefon nebo e-mail. | majitel, pracovník | žádný |
| Klienti | Systémová tabulka, plní se sama z vyhraných obchodů. | majitel, pracovník | žádný |
| Generování kontaktů | Podle oboru a místa najde firmy v Google Maps a uloží je, bez duplicit. Jedno stisknutí dá nejvýš 60 firem ze 3 požadavků. Google nevrací e-maily. | majitel, pracovník s právem generovat | Google Maps |
| Poslat e-mail kontaktu | E-mail přímo z kontaktu nebo obchodu, až se 3 přílohami. Zapíše se do aktivit. | majitel, pracovník | e-mail |
| Navrhnout odpověď | Uživatel vloží e-mail, který dostal, a Grady k němu napíše odpověď, kterou si upraví a pošle sám. | majitel, pracovník | AI (Sonnet) |

### Cold Calling
<!-- kód: nav:coldCalling route:/app/cold-calling -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Seznam k volání | Kontakty k obvolání, u každého zavolat, poznámka, přesun do tabulky (= výsledek hovoru) a založení obchodu. | majitel, pracovník s právem cold calling | žádný |
| Časovač volání | Spustit a pozastavit. Po 15 minutách bez výsledku se zastaví sám a o půlnoci začíná od nuly. Počítá se zvlášť po lidech. | majitel, pracovník | žádný |
| Statistiky | Čas na telefonu a schůzky po týdnech, měsících a letech. Majitel vidí i čísla pracovníků. | majitel, pracovník (ostatní jen s právem) | žádný |
| Nejlepší čas na volání | Graf, kdy lidé v dané zemi nejčastěji zvednou a domluví schůzku. Počítá se ze souhrnů všech uživatelů. | majitel, pracovník | žádný |
| Nejlepší obory | Po několika schůzkách ukáže, z kterých vygenerovaných oborů nejčastěji vznikne schůzka. | majitel, pracovník | žádný |

### Pipeline a obchody
<!-- kód: nav:pipeline route:/app/pipeline -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Tabule obchodů | Obchody ve fázích (Nový lead → Schůzka → Koncept nabídky → Nabídka odeslána → Vyhráno / Ztraceno). Fáze si uživatel upraví. | majitel, pracovník s právem pipeline (vše nebo jen své) | žádný |
| Detail obchodu | Částka, termín uzavření, datum realizace (samo se objeví v kalendáři), kontakty s rolemi, úkoly, historie a poznámky. | majitel, pracovník | žádný |
| Víc lidí na obchodu | Na obchodu může pracovat víc lidí najednou, všichni rovnocenně (zaškrtnou se v detailu nebo při založení). Každý z nich obchod vidí i s právem „jen své obchody“, má ho v dlaždicích, filtru, Správě firmy a na svém dashboardu; na kartě jsou jejich iniciály. Grady je nastaví na pokyn. | majitel, pracovník | žádný |
| Co hoří a filtry | Dlaždice se špatnými věcmi a filtry (termín, aktivita, úkoly, pracovník, kontakt, částka) uložené v adrese. | majitel, pracovník | žádný |
| Výhra a prohra | Výhra spustí oslavu a kontakt přejde do Klientů. U prohry se zapíše důvod a po čase se objeví štítek „znovu oslovit“. | majitel, pracovník | žádný |
| Dotazník po schůzce | Když obchod opustí fázi Schůzka, krátký dotazník zachytí, jak schůzka proběhla. Z dotazníků pak vzniká rozbor schůzek. | majitel, pracovník | žádný |
| Vystavit fakturu z obchodu | Založí koncept faktury s odběratelem a částkou z obchodu. | majitel, pracovník s fakturami | žádný |
| Zápis ze schůzky jedním tahem | „Vložit zápis ze schůzky“ v detailu obchodu, kontaktu a u schůzky v kalendáři: vložený přepis nebo poznámky (i dlouhý s mluvčími, nebo .txt / .docx / .pdf do 10 MB). Grady navrhne shrnutí do historie, úkoly s termíny a řešiteli, další krok, fázi, Close Date, částku, nové kontakty a poznámku propojenou s obchodem; uživatel vidí seznam se zaškrtávátky, upraví a potvrdí, vše se provede najednou a jde vrátit jedním Zpět. Přepis se uloží k obchodu jako příloha, jen když to uživatel zaškrtne. Navrhne jen to, co uživatel smí. | majitel, pracovník (podle práv) | AI (viz kap. 2) |

### Úkoly
<!-- kód: nav:tasks route:/app/ukoly-crm route:/app/ukoly -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Obchodní úkoly | Úkoly k obchodům a kontaktům s termínem, délkou a odpovědným člověkem. Skupiny Po termínu, Dnes, Zítra, Tento týden, Později a Hotové. | majitel, pracovník (vždy své, s právem i ostatní) | žádný |
| Hotovo s poznámkou | Odškrtnutí jedním krokem s nepovinnou poznámkou, která se ukáže v historii obchodu i kontaktu. | majitel, pracovník | žádný |
| Úkoly od majitele | Pracovník tu vidí i úkoly, které mu zadal majitel. Stará adresa /app/ukoly sem přesměruje. | pracovník | žádný |

### Kalendář
<!-- kód: nav:calendar route:/app/kalendar -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Den, týden, měsíc | Schůzky, úkoly a termíny, celodenní události, navázané na kontakt a obchod. Na telefonu seznam týdne. | majitel, pracovník s právem kalendář | žádný |
| Vrstvy | Volitelně ukáže úkoly milníků, očekávané uzavření obchodů a obchodní úkoly. Přetažením se úkol přeplánuje. | majitel, pracovník | žádný |
| Odebírané kalendáře | Obsazené časy z odebíraných kalendářů (Google, Apple, Outlook přes tajnou adresu iCal, Nastavení → Kalendář) šedě a jen pro čtení, přepínač „Odebírané kalendáře“. Nikdy se z nich nestanou události Gradusu. | majitel, pracovník (své) | žádný |
| Google a Apple obousměrně (28.10) | Propojení s Google Kalendářem (OAuth, jen rozsahy calendar.events a seznam kalendářů) a Kalendářem Apple (iCloud přes CalDAV, heslo pro aplikace) v Nastavení → Kalendář: vybrané kalendáře se čtou (obsazenost plánovače a události v kalendáři se štítkem původu), do jednoho se hned zapisují události, změny a rezervace z Gradusu. Události z Googlu a Applu jdou upravit (zapíše se zpět), opakované se čtou po výskytech a jeden výskyt jde změnit; konflikt = vyhrává novější změna, detail události to řekne. Google přírůstkově (syncToken) při otevření kalendáře, na vyžádání a notifikacemi, Apple dotazem (ctag/etag); denně oboje. Odpojit smaže tokeny a přečtené události, vlastní zůstanou. Zatím jen pro účty založené před nasazením a přidané v Administraci → Nastavení → Integrace, dokud Google aplikaci neověří (docs/google-overeni.md). | majitel, pracovník (svůj kalendář) | žádný (Google Calendar API a iCloud zdarma) |
| Sdílení kalendáře ve firmě (30.3) | Každý v Nastavení → Kalendář → Sdílení určí, kdo z firmy (člověk, skupina, celá firma) vidí jeho kalendář a jak: Obsazenost (jen časy), Čtení (vše kromě soukromých), Úpravy (zakládá a upravuje události v jeho kalendáři s poznámkou „vytvořil X“; jeho soukromé ani sdílení nezmění), a které kalendáře (Gradus a každý propojený Google / Apple zvlášť). Majitel firmy vidí obsazenost svých lidí automaticky (jde vypnout). Žádost „Požádat o sdílení kalendáře“ ve Správě firmy, ve Zprávách a v kalendáři; adresát ji vidí ve zvonku, v Čeká na tebe a v Gradyho bublině a povolí, povolí s jinou úrovní nebo odmítne; po odmítnutí jde znovu požádat za 7 dní. V kalendáři panel Kalendáře (vlastní zdroje a lidé, zaškrtávátko a barva), cizí události v barvě a s iniciálami vlastníka, „Obsazeno“ šrafovaně, při Úpravách „Do kalendáře: Váša“. Soukromá událost (přepínač i Alt+P, výchozí pro celý propojený kalendář) je pro ostatní vždy jen Obsazeno, i přes API. „Najít společný čas“: vybraní lidé (i skupina) a délka, zvýrazní okna v pracovní době, kdy mají všichni volno (kdo nesdílí, je „nevíme“), klik založí schůzku a pošle pozvánky do kalendáře Gradusu. Grady a MCP čtou cizí kalendáře jen v rozsahu sdílení (`people_availability`: „kdy má Váša zítra čas?“ stačí obsazenost). | majitel, pracovník s právem kalendář | žádný |

### Plánovač schůzek
<!-- kód: nav:scheduler route:/app/planovac -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Typy schůzek | Karty typů (název, délka, místo: videohovor / telefon / osobně / jinak, barva, počet rezervací za 30 dní, Kopírovat odkaz, přepínač aktivní). Při prvním otevření tři typy (Úvodní hovor 15 min, Konzultace 30 min, Schůzka 60 min) a pracovní doba po–pá 9–17. | majitel, pracovník s právem „plánovač: vlastní“ | žádný |
| Editor typu | Záložky Základ · Dostupnost (vlastní pracovní doba, volno před a po, nejdřív za, nejvýš dopředu do 60 dní, nejvýš za den, časy po 15 / 30 / 60 min) · Otázky (jméno a e-mail vždy, telefon, firma, vlastní; řazení, povinné) · Připomínky (výchozí 24 h a 1 h, nejvýš 5) · Potvrzení (schvalovat ručně, text po rezervaci, založit obchod ve fázi) · Náhled (skutečné volné termíny). | majitel, pracovník (své) | žádný |
| Dostupnost | Časové pásmo, pracovní doba po dnech s více úseky, výjimky kalendářem (volný den, dovolená, jiná doba). Volné termíny počítá jedna funkce (`slots.ts`) z pracovní doby mínus vlastní události a obchodní úkoly s časem, události propojených Google a Apple kalendářů (načtené znovu, když jsou starší než 10 minut; „volno“ neblokuje), obsazené časy odebíraných kalendářů a aktivní rezervace. Rezervace se hned zapíše do propojeného kalendáře s hostem jako účastníkem; typ s místem „Google Meet (automaticky)“ dostane od Googlu vlastní schůzku Meet, kterou ukáže stránka rezervace. | majitel, pracovník (své) | žádný |
| Rezervační stránka | Odkaz `/s/<adresa>/<typ>` s vlastní adresou (handle) a trvalým odkazem na videohovor; průvodce „adresa, videohovor, pracovní doba“. | majitel, pracovník (své) | žádný |
| Veřejná rezervace | Bez přihlášení: `/s/<adresa>` (hostitel a jeho aktivní typy, jediná stránka k indexování) a `/s/<adresa>/<typ>` (týden s volnými časy zeleně a obsazenými šedě „Plno“ bez podrobností (30.4), časy v pásmu hosta s přepínačem, otázky typu, shrnutí, Rezervovat). Jazyk cs / en podle prohlížeče, jinak hostitele, s přepínačem; cookies jen jazyk a pásmo. Kliknutý čas se 5 minut drží (odpočet), dva hosté nikdy nedostanou stejný ani překrývající se čas; nejvýš 10 rezervací za hodinu z jedné adresy, honeypot proti botům. Stránka je pozvánka (24.5): vlevo hostitel a schůzka, vpravo kalendář a časy, na telefonu kroky den → čas → údaje; pozadí se jemně hýbe jen přes CSS (s omezeným pohybem stojí). Potvrzení s krátkými konfetami, velkým datem a časem, Přidat do kalendáře (Google, Apple/ICS se stejným UID jako pozvánka v e-mailu, Outlook; jako místo videohovoru stránka rezervace) a odkazem na videohovor; „čeká na potvrzení“ řečené lidsky. Logo a „Vytvořeno v Gradusu“ zmizí s doplňkem Bez značky, místo nich stojí v hlavičce jméno firmy hostitele. | host (klient uživatele) | e-mail |
| Co rezervace udělá | Kontakt (podle e-mailu v prostoru, jinak nový se zdrojem „plánovač“), schůzka v kalendáři hostitele s odpověďmi (kalendář ji jen otevře, přesouvá a ruší se přes rezervaci), po potvrzení kontakt do Domluvená schůzka (z Klientů nikdy; do sdíleného grafu času volání se nepočítá) a obchod ve fázi typu. | majitel, pracovník (své) | žádný |
| E-maily a připomínky | Hostovi potvrzení nebo „čeká na potvrzení“ s pozvánkou .ics, tlačítkem „Připojit se ke schůzce“ na stránku rezervace (jen potvrzená, nikdy přímý odkaz na hovor) a tlačítky Přesunout / Zrušit (odkaz `/s/r/<token>` platí do konce schůzky), v jazyce a pásmu hosta; hostiteli nová rezervace / ke schválení s odkazem do aplikace. Připomínky typu hostovi i hostiteli jako naplánované e-maily Resend (nejvýš 30 dní dopředu, dál doplní denní cron); přesun a zrušení je zruší a naplánuje znovu. | host, majitel, pracovník (své) | e-mail |
| Schválení | Typ se schvalováním: Potvrdit / Odmítnout (důvod, volitelně jiný čas) na nástěnce v „Čeká na tebe“, v Plánovač → Rezervace a z e-mailu; potvrzení pošle hostovi odkaz na hovor a doběhne kontakt, Cold Calling, obchod a připomínky. | majitel, pracovník (své) | e-mail |
| Přesun a zrušení | Host na `/s/r/<token>` vybere nový volný termín nebo zruší s důvodem; hostitel totéž v Rezervacích a v detailu schůzky v kalendáři. Obě strany dostanou e-mail, kalendář a připomínky se srovnají, zrušená zůstane v historii kontaktu. | host, majitel, pracovník (své) | e-mail |
| Po schůzce | Proběhlá rezervace s obchodem nabídne v „Čeká na tebe“ dotazník o schůzce (stejný jako při posunu obchodu ze Schůzky), Nepřišel nebo Přeskočit; „Nepřišel“ jde označit i v Rezervacích. | majitel, pracovník (své) | žádný |
| Rezervace | Nadcházející a minulé se stavem a filtrem, detail s odpověďmi a akcemi (Potvrdit, Odmítnout, Přesunout, Zrušit, Nepřišel); majitel přepne na „Všichni“ (jen čtení). | majitel, pracovník (své) | žádný |
| Odkaz na schůzku | E-mail, pozvánka .ics i připomínky vedou na stránku rezervace `/s/r/<token>`, která ukáže aktuální odkaz na hovor a jedním klikem na něj přejde (15 minut před začátkem se tlačítko Připojit se rozsvítí, po skončení poděkuje), takže změna odkazu platí i pro odeslané pozvánky. Typ schůzky: trvalý odkaz ze stránky, nebo „Jedinečná místnost pro každou rezervaci“ (Jitsi Meet `meet.jit.si/gradus-…`, zdarma, bez účtu). Hostitel zadá u konkrétní rezervace (detail v Plánovači i v kalendáři) vlastní odkaz; host dostane e-mail „Odkaz na schůzku byl upraven“, jen když do schůzky zbývá víc než hodina. Videohovor bez odkazu: editor upozorní, rezervace se potvrdí s „Odkaz pošle … před schůzkou“ a hostitel dostane obchodní úkol (hotový, jakmile odkaz zadá). | host, majitel, pracovník (své) | e-mail |
| Všichni | Majitel vidí rezervační stránky a typy pracovníků a jejich rezervace, typ může jen vypnout. | jen majitel | žádný |
| Kalendáře plánovače (30.4) | Plánovač → Dostupnost → „Odkud se bere obsazenost“: zaškrtnutý kalendář Gradusu (události a úkoly s časem), každý propojený Google a Apple kalendář (i ten, který se v sekci Kalendář nezobrazuje) a každý odebíraný ICS, nezávisle na tom, co ukazuje Kalendář; nové profily jen Gradus. „Kam se zapisují nové rezervace“: Gradus vždy a volitelně jeden propojený kalendář. Google a Apple jde propojit přímo odsud. U typu schůzky jde v „Další možnosti“ nastavit vlastní kalendáře. Propojené kalendáře se pro plánovač čtou živě (stránka nejvýš 5 minut stará, podržení a potvrzení termínu nejvýš minutu), při výpadku poslední čtení dne nebo synchronizované události. Do obsazeného času se přes odkaz nedá rezervovat, ověří se znovu při potvrzení. | majitel, pracovník (své) | žádný (Google Calendar API a iCloud zdarma) |
| Výběr termínu (30.4) | Jedna komponenta pro veřejnou stránku i aplikaci: týden po dnech (na počítači mřížka, na telefonu den → časy), volné časy zeleně, obsazené šedě „Plno“, mimo pracovní dobu tlumeně. Klik na obsazený nebo ručně zadaný čas mimo nabídku = „V tu dobu už je plno“; „Přesto naplánovat“ jen v aplikaci. | host, majitel, pracovník | žádný |
| Schůzka z Cold Callingu (30.4) | Přesun kontaktu do Domluvená schůzka (i „Naplánovat schůzku“ v detailu kontaktu a obchodu, Grady `schedule_meeting`) otevře dialog: komu schůzku plánuji podle nastavení Cold Callingu majitele (volající vybírá, jiným jen s právem „plánovat schůzky jiným“ / vždy majiteli / vždy jednomu člověku), typ (výchozí a zda ho volající smí změnit, předstih po telefonu jde vypnout), volno / plno hostitele podle jeho plánovače, termín podržený po dobu dialogu, „Poslat klientovi potvrzení e-mailem“ (jinak pole pro e-mail) a otázky tabulky. Vznikne potvrzená rezervace se vším, co dělá veřejná (událost hostitele i v jeho propojeném kalendáři, kontakt, historie, připomínky, obchod typu, nabídka obchodu); hostitel dostane oznámení ve zvonku „Jana ti naplánovala schůzku s …“, e-mail a Gradyho bublinu. Odměna a XP jdou za přesun jako dřív. Kdo plánovač nemá, nastaví pracovní dobu jedním krokem. | majitel, pracovník s Cold Callingem nebo úpravou kontaktů | e-mail |
| Grady a odkaz na schůzku | Grady zná nadcházející rezervace a čekající schválení; u kontaktu v Cold Callingu ve stavu Ozvat se a v e-mailu nabídne „pošli odkaz na schůzku“ s nejvhodnějším typem (úvodní hovor nejkratší, schůzka nejblíž 30 min). | majitel, pracovník (své) | žádný (v návrhu odpovědi e-mailem součást volání AI) |

### Finance a faktury
<!-- kód: nav:finance route:/app/finance route:/app/finance/faktury/nova route:/app/finance/faktury/[id] -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Příjmy a výdaje | Transakce s kategoriemi, hledání podle období. Část se zapíše sama ze zálohy, vyhraného obchodu nebo zaplacené faktury. | majitel, pracovník s právem finance | žádný |
| Plán měsíce (Měsíc) | Výchozí pohled Financí: tabulka příjmů a výdajů po týdnech jako v Google Sheets (počáteční kapitál, PŘÍJMY, VÝDAJE, bilance a konečný kapitál týdne), Shrnutí měsíce s nejnižším stavem a varováním pod nulou nebo pod rezervou. Úprava buňky na místě (12 500, 12,5k, 3*4000), Plán · Skutečnost · Rozdíl (skutečnost z transakcí), založení dalšího měsíce z předchozího, automatické platby a faktury se dosadí samy, obchody s Close Date jako návrh. Export XLSX/CSV a import CSV ve stejném rozvržení. | majitel, pracovník s právem finance (zapisuje s „zapisovat“) | žádný |
| Přehled | Souhrnné dlaždice, graf příjmů a graf vývoje kapitálu po týdnech (plán i skutečnost, 3 měsíce zpět a 3 dopředu). | majitel, pracovník se souhrny | žádný |
| Pravidelné platby | Týdně, měsíčně, čtvrtletně nebo ročně se samy zaúčtují (noční úloha). | majitel, pracovník | žádný |
| Faktury | Koncept, vystavení s číselnou řadou, storno dobropisem a „zaplaceno“. Čtyři vzhledy a QR platba pro CZ. | majitel, pracovník s fakturami | žádný |
| PDF faktury | Vznikne při prvním stažení nebo odeslání a uloží se. | majitel, pracovník | úložiště |
| Poslat fakturu e-mailem | Odešle PDF odběrateli, kopii uživateli. | majitel, pracovník s fakturami | e-mail |
| Údaje dodavatele a ARES | Firma, IČO, DIČ, účet. Pro CZ dotáhne údaje z ARES (zdarma). | jen majitel | žádný |

### Správa firmy
<!-- kód: nav:workers route:/app/firma route:/app/firma/[workerId] route:/app/firma/odmeny nav:myRewards route:/app/odmeny route:/app/pozvanky -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Pozvat pracovníka | Dialog začíná volbou. „Už používá Gradus“: @jméno nebo krátké ID, najde se jen přesná shoda (nejvýš 10 neúspěchů a 40 hledání za hodinu), nalezený se ukáže jako karta s fotkou, jménem a @jménem; pozvánka čeká v jeho aplikaci (zvonek, Čeká na tebe, Grady) a přijde e-mailem. „Ještě Gradus nemá“: jméno a e-mail, odkaz na registraci (e-mail existujícího účtu pozvánku připíše jemu). Pak šablona role (Obchodník, Cold caller, Asistent, Účetní, Vše, Vlastní) a krok „Co bude moci“: plný editor práv (sekce, jemné akce, připojení aplikací), widgety na nástěnce, nadřízený, skupiny, výchozí přehled a nepovinný plán odměn ze šablony, s náhledem, jak to pozvánka shrne. Vše se uloží dřív, než pozvánka vznikne, takže platí od první vteřiny po přijetí. Čekající pozvánku jde v dashboardu pracovníka upravit („Upravit pozvánku“). | jen majitel | e-mail |
| Pozvánky | Pozvaný vidí „Novák s.r.o. · Václav Novák tě zve jako Obchodník“, lidsky shrnuté, k čemu bude mít přístup (sekce, rozsah a co tam smí; co neuvidí), a odměny; totéž shrnutí je v e-mailu pozvánky. Přijme (firma je v přepínači) nebo odmítne. Majitel vidí stav a dostane oznámení. | kdokoli s pozvánkou | žádný |
| Odkaz pozvánky | Otevření odkazu pozvánku nikdy nespotřebuje (ani náhled nebo sken e-mailového klienta), jen dokončená registrace nebo přijetí. Přihlášený jiným účtem vidí „Jsi přihlášený jako X. Pozvánka je pro Y.“ (Odhlásit a pokračovat / Zůstat), existující účet se přihlásí a přijme. Neplatný odkaz řekne proč (vypršela dne…, použita, zrušena majitelem, nahrazena novější) a nabídne Požádat o novou (oznámení majiteli). Nová pozvánka na stejný e-mail starou nahradí. Registrace na pozvaný e-mail nežádá druhé potvrzení, ostatní potvrzení přijde v šabloně Gradusu a jazyce člověka. | kdokoli s pozvánkou | e-mail |
| Odejít z firmy | Pracovník sám v Nastavení → Účet; majitel dostane oznámení a e-mail, práce zůstává ve firmě. | pracovník | e-mail |
| Kdo za koho platí | Kdo má vlastní platný tarif, je ve firmě zdarma; za ostatní platí majitel: pracovníci v ceně tarifu, pak cena za každého dalšího. Štítek u pracovníka a řádek v Předplatném; ve Stripe druhá položka předplatného, počet se srovná denně a platí od dalšího období. **Dnes skryté** přepínačem WORKER_BILLING_VISIBLE (`app_settings.worker_billing`, výchozí vypnuto): rozhraní o placení za pracovníky nic neříká a Stripe pracovníky neúčtuje. | jen majitel | Stripe |
| Jen lidé z firmy | Všude, kde se vybírá nebo vypisuje pracovník (Odměny a výplaty, skupiny, úkoly, obchody, filtry, zprávy, statistiky, Plánovač → Všichni, zmínky), jsou jen aktivní členové prostoru (`active_members`). V Odměnách a výplatách jsou jen aktivní lidé, historie výplat ukazuje i bývalé; bývalý nic nového nedostane. Odchod nebo odebrání ruší členství ve skupinách. | majitel, pracovník | žádný |
| Lidé, strom a mapa | Hierarchie firmy jako seznam nebo organizační mapa, přesun tažením. | majitel; pracovník svou větev (s právem celou firmu) | žádný |
| Skupiny | Pracovníci ve skupinách, každá skupina má i svou konverzaci ve Zprávách. | jen majitel | žádný |
| Jemná práva | U každé sekce zvlášť zobrazit, zakládat, upravovat, mazat… Šablony Obchodník, Asistent, Účetní, Vše. | jen majitel | žádný |
| Dashboard pracovníka | Přehled, práva, obchody a úkoly s grafy plnění, dokumenty, tým, odměny. | majitel, pracovník (sám sebe) | žádný |
| Dokumenty pracovníka | Smlouvy a doklady k pracovníkovi (do 20 MB). | majitel | úložiště |
| Plán odměn | U každého pracovníka pravidla jako věty se skládacími částmi („Když [pracovník] [přesune kontakt] [odkudkoli] do [Domluvená schůzka], dostane [500 Kč], [jen poprvé u kontaktu], nejvýš [20 000 Kč měsíčně].“), každá část je klikací výběr. Spouštěč z katalogu: přesun kontaktu mezi vlastními tabulkami (odkud kterákoli / vybrané / kromě vybraných, kam vybrané), domluvená schůzka (Cold Calling, plánovač, kalendář), proběhlá schůzka, přijatá rezervace, zapsaný hovor, nový kontakt (s telefonem / e-mailem), posun obchodu mezi fázemi, výhra, prohra, splněný úkol (v termínu, druh, cena u úkolu), dokončený projekt, vystavená a zaplacená faktura, odpracovaná hodina, každý měsíc. Podmínky: kdo to udělal (sám / kdokoli na jeho záznamu), hodnota od–do, štítek kontaktu, jen poprvé u kontaktu či obchodu (výchozí), od–do. Odměna: pevná, procento z hodnoty, za hodinu, stupně podle počtu v měsíci, cena u úkolu; strop za měsíc a bonus za počet („10 schůzek v měsíci = +5 000 Kč“, pracovník vidí „7 z 10 schůzek“). Vrácení přesunu nevyplacenou odměnu zruší. Vyzkoušet: kolik by pravidlo vyneslo za 30 dní na skutečných datech (nic nezapíše) a prvních 10 událostí. Upozornění na dvě pravidla na stejnou událost s volbou sčítat / jen nejvyšší. Pravidlo se smazanou tabulkou nebo fází „potřebuje úpravu“. Šablony Cold caller (jakýkoli přesun do Domluvená schůzka, jen poprvé u kontaktu), Obchodník na provizi, Programátor za projekt, Asistent na hodinu; schvalování ručně nebo automaticky, platnost a měna. Odměny vznikají samy z práce (úkol s cenou je hned „v plánu“), vrácení úkolu nebo prohra je vezme zpět, vyplacené opraví záporným záznamem. | majitel, pracovník s právem „správa firmy: odměny“ (ne sám sobě) | žádný |
| Odměny popsané větou | „Popiš, jak chceš odměňovat“ v plánu odměn: Grady z popisu (i „zvyš provizi na 5 %“) navrhne pravidla proti katalogu a skutečným tabulkám a fázím, každé jako větu s Vyzkoušet; nejasnou tabulku nabídne výběrem, co nejde, řekne s nejbližší možností. Nic se neuloží bez potvrzení. Totéž v chatu a přes MCP (`get_reward_plan`, `try_reward_rule`, `save_reward_rules`). | majitel, pracovník s právem „správa firmy: odměny“ | AI |
| Odměny a výplaty | Dashboard pracovníka → Odměny: vyděláno tento měsíc, čeká na schválení, čeká na výplatu, v plánu; Přidat odměnu (i srážka), tabulka práce s výsledkem a odměnou (schválit, upravit, zamítnout), výplata vybraných schválených (výdaj do Financí v kategorii Odměny a řádek v plánu měsíce), historie výplat a export CSV. Správa firmy → Odměny a výplaty: všichni najednou, hromadné schválení a výplata. | majitel, pracovník s právem „správa firmy: odměny“ | žádný |
| Odměna za splnění | Nepovinná částka u obchodního úkolu, úkolu od majitele i úkolu milníku (předvyplní se z plánu), u obchodu při výhře a u milníku za dokončení projektu. Pracovník ji vidí u úkolu. | majitel, pracovník s právem „správa firmy: odměny“ | žádný |
| Moje odměny | Pracovník vidí, co vydělal, co čeká na schválení a na výplatu, „čeká tě 12 000 Kč za 3 úkoly“, svá pravidla jako věty a historii výplat. Nic nemění. | pracovník | žádný |
| Odstranit z firmy | Ukončí přístup hned, data zůstanou, otevřenou práci předá někomu jinému. | jen majitel | žádný |
| Online stav | Tečka u fotky každého člena firmy (zelená online = aplikace otevřená a použitá v posledních 10 minutách, žlutá nepřítomen = otevřená 10+ minut bez aktivity, offline nic) všude, kde je jeho fotka, i ve widgetech Tým a Aktivita ve firmě; text „online“ / „naposledy před 5 hodinami“ (před chvílí, včera, v pondělí, po týdnu datum) v dashboardu pracovníka, hlavičce osobní konverzace a seznamu lidí. Víc karet a zařízení = jeden stav. Realtime Presence na soukromém kanálu firmy, z historie se drží jen jeden okamžik „naposledy“ (zápis nejvýš 1× za minutu a při odchodu). Nastavení → Soukromí → „Ukazovat, kdy jsem online“: vypnuté = nikdo (ani majitel) nevidí můj stav a já nevidím ničí. Mimo firmu nikdy, do analytiky nic. | majitel, pracovník | žádný |
| Aktivita ve firmě | Správa firmy → Aktivita: časová osa „kdo co udělal“ (obchody, kontakty, hovory, úkoly, milníky, schůzky, faktury, transakce) s filtrem podle člověka, skupiny, druhu a období a denní souhrn na člověka (úkoly, obchody, hovory, schůzky). Kroky přes Gradyho a přes Claude mají štítek. Zapisuje ji databáze, drží 180 dní; částky a názvy sekcí, na které člověk nemá právo, nevidí. Widget Aktivita ve firmě čte totéž. | majitel všechny; pracovník svou větev (s „zobrazit vše“ celou firmu) | žádný |

### Zprávy
<!-- kód: nav:messages route:/app/zpravy -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Chat ve firmě | Skupinové a osobní konverzace jako WhatsApp Web: zmínky, odpovědi, přečteno, připnutí, ztlumení. Grady zprávy nikdy nečte. | majitel, pracovník (vždy) | žádný |
| Přílohy | Až 5 souborů po 10 MB ke zprávě. Rok neotevřené jdou do koše. | majitel, pracovník | úložiště |
| Upozornění e-mailem | Kdo 10 minut není v aplikaci, dostane e-mail o osobní zprávě nebo zmínce, nejvýš jeden za hodinu. Jde vypnout. | majitel, pracovník | e-mail |
| Export konverzace | Stažení konverzace jako CSV. | jen majitel | žádný |

### Grady

AI pomocník v pravém dolním rohu: chat, souhrny dne, návrhy a hodnocení. Na pokyn v chatu pracuje v aplikaci za uživatele (zakládá a mění milníky, úkoly, poznámky a jejich složky a sdílení, kontakty, obchody, události, finance, odměny, widgety přehledu a další, vždy jen v rámci práv v aktivní firmě; celý seznam operací s právy je v `docs/grady-operace.md`): běžné změny hned s kartou „Hotovo · Otevřít · Vrátit“ (24 h), mazání, odeslání, finanční kroky faktur, lidi, dokončení milníku a hromadné změny až po Potvrdit. Smazání úkolu, události, ruční transakce a automatické platby jde také vrátit; co Grady smaže (i obchod a kontakt), jde do koše (Nastavení → Integrace → Koš, výchozí 7 dní). Všechno, co dělá, s modelem a cenou je v [kapitole 2](#2-grady). Majitel i pracovník mají každý vlastního Gradyho a vlastní konverzace.

### Nastavení
<!-- kód: route:/app/nastaveni route:/app/nastaveni/ucet route:/app/nastaveni/vzhled route:/app/nastaveni/prace route:/app/nastaveni/grady route:/app/nastaveni/soukromi route:/app/nastaveni/predplatne route:/app/tarif route:/app/nastaveni/kalendar route:/app/nastaveni/integrace -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Účet | Fotka, jméno, uživatelské jméno (unikátní, 3–20 znaků a–z 0–9 _ ., změna nejvýš 1× za 30 dní, staré jméno 30 dní rezervované), „Jak tě najdou“ s krátkým ID (kopírovat, QR) a @jménem (kopírovat), e-mail, jazyk, heslo; ve vlastní firmě její název a logo. Plánovač nabídne @jméno jako adresu stránky. | majitel, pracovník | úložiště (fotka, logo) |
| Vzhled | Šest barevných témat (v herním režimu se odemykají úrovní), zvuky, animace, země, pásmo, měna a formáty. Měna je jakákoli platná podle ISO 4217 (hledání podle kódu i názvu, měna země a nejčastější nahoře); mění jen zobrazení, uložené částky zůstávají v měně, ve které vznikly. | majitel, pracovník | žádný |
| Vzhled během dne | „Měnit vzhled během dne“: bloky s názvem, začátkem, vzhledem a nepovinným popiskem (výchozí Ráno, Odpoledne, Večer; 2–8 za den), každý den stejně, pracovní dny a víkend zvlášť nebo každý den v týdnu zvlášť (kopírovat den do jiných). Den jako pruh, hranice se posouvají tažením po 15 minutách. Čas podle pásma uživatele, i přes letní čas; v herním režimu jen odemčené vzhledy. Vzhled vybraný ručně platí do začátku dalšího bloku. Když blok začne a aplikace je otevřená, proběhne přechod přes celou obrazovku (název bloku, popisek, krátký tón podle denní doby, řídí se zvuky); počká, než člověk dopíše, zavře dialog, doběhne časovač hovoru, tutoriál nebo živé psaní v poznámce, nejdéle 5 minut, pak se vzhled změní tiše. Klik nebo Esc přechod přeskočí, náhled tlačítkem v nastavení. První vykreslení už má vzhled bloku. | majitel, pracovník | žádný |
| Vlastní vzhled | Editor na celou obrazovku (`/app/nastaveni/vzhled/vlastni`) s živým náhledem přehledu, pipeline, poznámky a dialogu: základ světlý / tmavý, pozadí, povrchy, text, dvě akcentové barvy, volitelně barvy stavů, zaoblení, hustota, pozadí (jednobarevné, přechod, jemná záře), písmo nadpisů ze 6, síla stínů; „Vygenerovat z jedné barvy“ a šest výchozích bodů. Kontrast se hlídá živě (WCAG AA), oprava jedním klikem, nečitelný vzhled nejde uložit. Nejvýš 12 na účet, upravit, duplikovat, smazat, použít v rozvrhu, sdílet kódem nebo odkazem s kolegou z firmy (import kopie). Veřejná stránka plánovače zůstává ve vzhledu Gradusu. <!-- kód: route:/app/nastaveni/vzhled/vlastni --> | majitel, pracovník | žádný |
| Práce | Herní nebo nástrojový režim, cesta oboru, kdy znovu oslovit ztracené obchody a údaje na faktury. | majitel (část i pracovník) | žádný |
| Grady | Zapnutí proaktivního Gradyho, jak často se ozývá, tichý režim, e-maily ze Zpráv, znovu spustit tutoriál, smazat ukázková data. | majitel, pracovník | žádný |
| Kalendář | Karty Google · Apple · Odběr přes odkaz. Google a Apple: stav, poslední synchronizace, výběr kalendářů ke čtení a jednoho k zápisu, Synchronizovat teď, Odpojit; mimo povolené účty „Propojení s Google kalendářem připravujeme“. Odběr přes odkaz: tajná adresa iCal (Google, Apple, Outlook) s návodem, název, barva; server ji stáhne (jen https, 5 MB, 10 s, veřejné adresy), uloží šifrovaně a drží jen obsazené časy na 60 dní, obnova denně, ručně a při otevření rezervační stránky. Odkaz pro odběr kalendáře Gradusu (ICS s tajným tokenem, ukáže se jednou, jde obnovit a vypnout). | majitel, pracovník | žádný |
| Integrace | Připojené aplikace: adresa serveru MCP ke zkopírování, postup „Jak připojit do Clauda“ po krocích s obrázky, seznam připojených klientů (název, úroveň, firmy, kdy připojeno, naposledy použito, počet akcí), historie posledních akcí, změna úrovně a Odpojit (tokeny přestanou platit hned). Koš: co smazal Grady nebo připojená aplikace, s Obnovit. | majitel, pracovník | žádný |
| Soukromí | „Ukazovat, kdy jsem online“ (výchozí zapnuto), export všech dat (ZIP s CSV), smazání účtu, podmínky a ochrana soukromí. | majitel, pracovník | žádný |
| Předplatné | Tarif, změna, zrušení a obnovení, historie plateb s doklady, fakturační údaje (propíšou se do Stripe), promo kód. Stará adresa /app/tarif sem přesměruje. | jen majitel | e-mail (nám o změně) |
| Platební metoda a doklady | „Spravovat platební metodu a doklady“ otevře Stripe Customer Portal: změna karty, fakturační adresa a seznam dokladů (tarif se mění a ruší jen v Gradusu). Historie plateb ukazuje datum, tarif, období, částku, stav (i vráceno) a doklad od Stripe. | jen majitel | Stripe |
| Neúspěšná platba | Když platba selže, majitel vidí nad aplikací „Platba se nepovedla, aktualizuj kartu“ s odkazem do portálu; aplikace běží dál, Stripe platbu opakuje a posílá vlastní e-maily. Když neprojde ani poslední pokus, předplatné skončí a účet je jen pro čtení jako po zkušebce, nic se nesmaže. Grady to v rozhovoru jednou připomene. Pracovník nic nevidí. | jen majitel | Stripe, e-mail (nám souhrnem 1× denně) |
| Doplňky | V Předplatném přepínač „Bez značky Gradus“ (0,99 € měsíčně, 29 Kč ručně, jinde podle kurzu). Ve Stripe se zapnutím přidá položka předplatného se zbytkem období hned, vypnutím odebere; během zkušebky se zaplatí spolu s tarifem, beta neplatí. Skrytí značky použije plánovač schůzek (24.3). | jen majitel | Stripe |
| Zaplatit a pokračovat | Placení přes Stripe Checkout: zkušebka je bez karty, kdo zaplatí během ní, platí až od jejího konce, po expiraci hned. Tlačítko je v Předplatném, v liště posledních 3 dnů zkušebky a na kartě po expiraci. Promo kód se uplatní jako kupon, jiné kódy ve Stripe zadat nejde. Vyšší tarif ve Stripe hned s doplatkem, nižší od konce období, zrušení ke konci období. Ceny jen ze zveřejněného katalogu, testovací a ostrý režim se nemíchají. | jen majitel | Stripe |

### Napříč aplikací
<!-- kód: route:/app/test-chyby -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Onboarding | Průvodce na začátku: režim, obor, cesta, země a měna, první kontakt. Pracovník z pozvánky ho dostane, až se poprvé přepne do vlastní firmy. | majitel | žádný |
| Přepínač firem | Každý účet má vlastní firmu a může pracovat v dalších. Vpravo nahoře (na telefonu ve Více) „Moje firma“ a firmy, kde je pracovníkem, s názvem a logem; v cizí firmě tyrkysový proužek a název v hlavičce. Data firem se nemíchají, odkaz /app/prostor/… do firmy, kde účet není, je 404. | majitel, pracovník | žádný |
| Tutoriál | Rychlá ukázka (≈ 2 min) nebo úplný tutoriál na ukázkových datech (≈ 15 min). Texty jsou pevné, bez AI. Pracovník je po prvním vstupu do každé firmy dostane podle svých práv: jen sekce, které vidí, kroky „udělej“ jen s povolenými akcemi a ukázková data jen v povolených sekcích (na konci se z firmy smažou); úvod řekne, pro koho pracuje a jakou má roli. Když mu majitel práva rozšíří, Grady jednou nabídne „Máš nově přístup k … — ukázat?“. | majitel, pracovník (podle práv) | žádný |
| Průvodce v každé sekci | Otazník „Průvodce“ v hlavičce každé sekce aplikace i administrace (klávesa ?): nahoře pole „Na co se chceš zeptat?“ se třemi příklady sekce, pod ním Rychlá ukázka (1–2 min, jen se dívá) a Všechno o této sekci (5–8 min, i funkce za „Další možnosti“, s kroky „zkus si to“). Kroky jsou data z katalogu prvků (`src/features/tutorial/ui-map.ts`), texty pevné v překladech, filtrované podle práv. Na otázku odpoví Grady krátce a ukáže kroky přímo na obrazovce (zavede do jiné sekce, zvýrazní, počká na akci, „Udělej to za mě“ u bezpečných kroků), viz Průvodce: otázka v tabulce Gradyho. Grady sám nabídne pomoc, když člověk v sekci tápe (třikrát zavřený dialog bez uložení, návraty na stejné místo, opakovaně odmítnuté pole), nejvýš jednou za sekci a den; při první návštěvě sekce nabídne rychlou ukázku. V ⌘K otázka začínající „jak“ nabídne „Zeptat se Gradyho a ukázat“, v chatu je u odpovědi o ovládání „Ukázat na obrazovce“. Administrace má widget „Na co se lidé ptají“ (otázky bez jmen, podle sekce). | majitel, pracovník (podle práv), administrátoři | žádný (otázka AI) |
| Ukázka (Beta) | Aplikace se předvede sama pro marketingová videa: kurzor jezdí, kliká a píše, dole titulky, šest scénářů po 30–60 s v češtině a angličtině. Běží v dočasném ukázkovém účtu, který se po skončení smaže; Grady i hledání firem mají připravené odpovědi (žádné volání modelu ani Googlu). Zapíná se v Administraci → Nastavení → Ukázkový režim, běžný uživatel ji nevidí. Video bez člověka nahraje `bun run demo:record`. <!-- kód: route:/app/ukazka --> | jen my (majitel a administrátoři aplikace) | žádný |
| Gradus v Claudovi (MCP) | Vlastní server MCP (`/api/mcp`, Streamable HTTP, OAuth 2.1 s PKCE, registrace klientů i dokumenty metadat CIMD, obnovovací tokeny s rotací, tokeny jen jako hash). V Claudovi se přidá jako vlastní konektor; souhlas `/oauth/authorize` („Claude chce přístup k tvému Gradusu“) volí úroveň Jen čtení · Čtení a zápis · Plný přístup a firmy. Nástroje jsou Gradyho katalog operací (`docs/grady-operace.md`, seznam v `docs/mcp.md`) plus whoami a switch_space, vždy pod uživatelem a s jeho právy v dané firmě (RLS, nikdy admin klient). Smazané jde do koše na 7 dní (nastavitelné v administraci), odeslání e-mailu a vystavení faktury jen v Plném přístupu. Limit 120 volání za minutu na připojení. Majitel firmy připojené aplikace pro firmu vypne a vidí, kdo je má; právo pracovníka „Integrace: MCP“. Gradus sám model nevolá, platí uživatel ve svém Claudovi. | majitel, pracovník | žádný |
| Hledání ⌘K | Najde kontakty, obchody, milníky, úkoly, poznámky, události, faktury, pracovníky i nastavení, bez diakritiky. | majitel, pracovník (co vidí) | žádný |
| Hra | XP, 30 úrovní, odznaky, série, oslavy, odemykání sekcí a témat. Nástrojový režim to vypne. | majitel, pracovník | žádný |
| Nahlásit problém | Hlášení chyby nebo nápadu i se snímkem obrazovky, majitel aplikace dostane e-mail. Grady hlášení sám nezakládá: na stížnost nabídne tlačítko Nahlásit problém. V administraci jsou vidět všechna hlášení včetně interních účtů (štítek interní), nová s tlačítkem Obnovit. | majitel, pracovník | e-mail, úložiště |
| Upozornění na chyby | Každá zachycená chyba svítí v administraci: widget Chyby na přehledu (nové dnes, otevřené, zasažení lidé, nejčastější tři s kódem, vrátily se; rozklik s rychlou změnou stavu), červený odznak s počtem nových u Provoz → Chyby, v titulku karty a ve zvonku (29.2). E-maily jsou ve výchozím stavu vypnuté; jdou zapnout jen pro kritické (stejná chyba u 5 a víc lidí za hodinu, pád přihlášení, registrace nebo plateb), denní souhrn nebo každou chybu (s ochranou proti záplavě). Stránka /app/test-chyby je jen pro naše testy. | jen my | e-mail jen když se zapne |
| Denní souhrn administrátorům | Jeden e-mail denně „Gradus včera“ místo jednotlivých upozornění: noví a aktivní uživatelé se změnou proti předchozímu dni a týdnu, tržby a nová / zrušená předplatná (testovací režim Stripe označený), náklady AI a cena na aktivního uživatele, nové chyby s nejčastějšími třemi kódy a vyřešené, nová hlášení a zpětná vazba, co čeká na rozhodnutí, zdraví systému jen když něco selhává a jedna věta „stojí za pozornost“ složená pravidly z čísel (žádný model). Přijde v 6:00 v pásmu administrátora (cron jednou denně, Resend `scheduled_at`), klidný den krátce „vše v pořádku“ s čísly. Administrace → Nastavení → Upozornění: vypnout, změnit čas a pásmo, „jen když je co hlásit“, ukázka hned; omezený administrátor dostane verzi bez peněz. | jen my (majitel a administrátoři aplikace) | e-mail (1 denně na administrátora) |
| Přehled e-mailů | Každý e-mail aplikace se zapíše do `email_log` (druh, příjemce jen jako otisk, čas, stav) v jediném místě odesílání. Widget E-maily na přehledu administrace: odesláno dnes a tento měsíc proti limitu tarifu Resendu, rozpad podle druhu a kdy limit tímhle tempem dojde. Seznam všech e-mailů a návrhy úspor v `docs/emaily.md`. | jen my | žádný |
| Přehled administrace z widgetů | Úvodní stránka administrace je plocha z widgetů jako Přehled v aplikaci (stejné jádro: přeskládání, velikosti, galerie, rozklik, víc záložek, ukládání samo s ⌘Z), s vlastní sadou: provoz, lidé, peníze, AI, produkt a správa. Čísla jdou z existujících sekcí administrace přes stejnou stráž, řídí se horní lištou období a filtrů nebo vlastním obdobím widgetu; chyby, zdraví, noví uživatelé a tržby se obnovují každou minutu. Připravené záložky Provoz, Peníze, AI, Lidé; majitel nastaví výchozí přehled pro nové administrátory. Omezený administrátor widgety Peníze nemá. Tržby v testovacím režimu Stripe jsou označené „testovací data“. | jen my (majitel a administrátoři aplikace) | žádný |
| Kurzy měn | Jednou denně kurzy proti EUR z ECB (frankfurter.app) a open.er-api.com, oba zdarma a bez klíče. Jen pro zobrazení cen tarifů a souhrnů napříč měnami („orientačně podle kurzu z …“); uložené částky se nikdy nepřepočítávají, kurz starší než 7 dní se pro cenu nepoužije. Stav zdrojů v Administraci → Zdraví. | všichni | žádný |

### Web
<!-- kód: route:/ route:/cenik route:/podminky route:/soukromi route:/cekaci-listina route:/en route:/en/pricing route:/en/terms route:/en/privacy route:/en/waitlist -->
<!-- kód: route:/podpora route:/en/support -->
<!-- kód: route:/prihlaseni route:/registrace route:/zapomenute-heslo route:/nove-heslo route:/zmena-emailu route:/en/login route:/en/register route:/en/forgot-password route:/en/reset-password route:/en/change-email -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Úvodní stránka a ceník | Česky na `/`, anglicky pod `/en`. Ceny se berou ze zveřejněného katalogu tarifů. Bez sledovacích cookies. Ceník ukazuje měnu podle země návštěvníka (hlavička Vercelu, cookie jen s kódem měny), přihlášenému jeho měnu, s přepínačem a odkazem `?mena=USD`; měna bez ruční ceny se přepočte z EUR denním kurzem s poznámkou „orientačně podle kurzu z …, platí se v EUR“. SEO nabídky v měně stránky. Při veřejné registraci vede tlačítko každého tarifu na registraci s předvybraným tarifem a obdobím (`?tarif=pro&obdobi=rok`) a čekací listina se schová. | návštěvník | žádný |
| Čekací listina | Dokud je registrace uzavřená, nechá návštěvník e-mail a potvrdí ho odkazem. | návštěvník | e-mail |
| Podmínky a soukromí | Právní stránky v obou jazycích, s oddíly pro placení (prodávající, cena a Stripe, obnovování, zrušení, odstoupení, reklamace). Údaje prodávajícího z proměnných prostředí; dokud některý chybí, build v produkci selže. | návštěvník | žádný |
| Přihlášení a registrace | Přihlášení, registrace s pozvánkou nebo kódem, a při veřejné registraci i bez kódu (14 dní zdarma). Povinný souhlas s podmínkami a zásadami (server uloží kdy a kterou verzi), nepovinný souhlas s novinkami. Tarif vybraný na webu se ukáže v Předplatném jako „Vybraný tarif, zaplatíš po zkušebce“ a zaplatí ho tlačítko Zaplatit. Špatné pozvánkové a promo kódy mají limit pokusů podle IP a e-mailu. Zapomenuté heslo, nové heslo, potvrzení změny e-mailu. | každý | e-mail (Supabase přes Resend) |
| Odkaz partnera | `/?kod=XYZ` si zapamatuje promo kód na 30 dní a registrace ho předvyplní. | návštěvník | žádný |
| Podpora | `/podpora` (`/en/support`), odkaz v patičce webu, v nabídce u avatara a ve Více: formulář (o co jde, co se stalo, co jsi čekal, e-mail pro odpověď) i bez přihlášení, zapisuje do stejných hlášení jako Nahlásit problém, majitel aplikace dostane e-mail. Bez přihlášení nejvýš 5 za hodinu z jedné adresy. | každý | e-mail |

---

## 2. Grady

Model každé funkce nastavuje majitel v Administraci → AI a Grady → Modely (`app_settings.grady_models`, katalog funkcí v `src/features/grady/model-settings.ts`, změna platí do minuty). Výchozí přiřazení, podle kterého jsou spočítané ceny níže:
- **Haiku** dělá rutinu, třídění a hlídání.
- **Sonnet** píše souhrny, hodnocení a návrhy.
- **Opus** píše velké rozbory.
- **Chat** běží **automaticky**: jednoduché zprávy (pozdrav, díky, jedna malá změna v aplikaci) odpoví Haiku, rady, plány, výpočty a soubory Sonnet. Rozhodují pravidla bez modelu, jen když nerozhodnou, jedno volání Haiku (Výběr modelu pro chat níže). Opus nebo Fable jen pro „velké rozbory“, když to majitel povolí. Ceny chatu níže jsou za Sonnet; zpráva na Haiku stojí asi dvacetinu.
- **Úsporný režim**: od prahu upozornění měsíčního stropu (výchozí 80 %), od stejného podílu stropu uživatele nebo firmy jen pro ně, nebo ručně jde každá funkce na svůj minimální model (většinou Haiku; rozbor schůzek a odměny nejméně Sonnet). Při 100 % se Grady pozastaví.

Ceny za milion tokenů jsou v `src/config/costs.ts` (`AI_MODELS`, ověřeno 21. 11. 2026 v ceníku Anthropic):

| Model | Vstup | Zápis do cache | Čtení z cache | Výstup |
|---|---|---|---|---|
| Haiku 5.5 | 0,10 USD | 0,125 USD | 0,01 USD | 0,50 USD |
| Sonnet 5.5 | 2 USD | 2,50 USD | 0,10 USD | 10 USD |
| Opus 5.5 | 4 USD | 5 USD | 0,20 USD | 20 USD |
| Fable 5.2 | 8 USD | 10 USD | 0,20 USD | 40 USD |

Haiku nad 100 000 tokenů promptu stojí pětkrát víc. Stejná funkce na jiném modelu stojí zhruba poměrem cen: Sonnet je asi 20× dražší než Haiku, Opus 2× dražší než Sonnet a Fable 2× dražší než Opus. Administrace → Modely ukazuje u každé funkce skutečnou útratu za 30 dní a odhad na každém modelu z tokenů v `ai_usage`.

Tokeny jsou odhad z délky promptů v kódu a běžných dat, ne měření; jeden token je asi 4 znaky. Stálá část chatu, tedy povaha Gradyho a pravidla (asi 2 500 tokenů), se ukládá do cache. Od druhé zprávy během 5 minut ji proto platíme za desetinu ceny. Každé úspěšné volání, i automatické (souhrn, hlídání, hodnocení milníku, třídění nápadů), se počítá do měsíčního limitu odpovědí Gradyho v tarifu.

### Co volá model, od nejdražšího
<!-- kód: ai:analysis ai:chat ai:milestone_review ai:reward_setup ai:briefing ai:period_summary ai:email_reply ai:ping ai:rules_test ai:note_map_suggest ai:meeting_notes ai:opportunity_scan ai:classify ai:chat_route ai:model_compare ai:compare_judge ai:guide_answer -->
<!-- kód: kind:salesAnalysis kind:milestoneReview kind:emailReply kind:ping kind:rulesTest kind:modelCompare kind:noteMapSuggest kind:meetingNotes kind:rewardSetup kind:guideAnswer -->

| Co Grady dělá | Kdy a pro koho | Model | Typické tokeny | Cena 1 použití | Běžný uživatel za měsíc |
|---|---|---|---|---|---|
| Rozbor obchodních schůzek | Na požádání, po 5 dotaznících ze schůzek. Čte až 150 posledních. | Opus | 2 200 do cache · 3 500 vstup · 1 200 výstup | 0,049 USD <!-- cena: ai=analysis in=3500 read=0 write=2200 out=1200 --> | 0–1× (se 150 dotazníky až 0,13 USD) |
| Zápis ze schůzky | „Vložit zápis ze schůzky“ u obchodu, kontaktu nebo schůzky: hodinový přepis (asi 40 000 znaků) jedním voláním. Dlouhý přepis jde po částech po 48 000 znacích (každá část jedno zhuštění, pak jeden návrh), takže tříhodinová schůzka stojí asi čtyřikrát tolik. Nic se nezapíše bez potvrzení; potvrzení samo model nevolá. | Sonnet (nejméně) | 11 200 vstup · 1 200 výstup | 0,034 USD <!-- cena: ai=meeting_notes in=11200 read=0 write=0 out=1200 --> | 2–8× |
| Grady pracuje v aplikaci | Zpráva, ve které Grady na pokyn uživatele něco najde a změní (jedno kolo nástrojů = dvě volání). Definice nástrojů (asi 8 000 tokenů, podle práv uživatele) jsou ve stálé části promptu a jdou z cache; nejvýš 8 kol a 25 změn na zprávu, každé kolo přes strop a do ai_usage. | Sonnet | 21 000 z cache · 9 400 vstup · 450 výstup | 0,025 USD <!-- cena: ai=chat in=9400 read=21000 write=0 out=450 --> | 10–20× |
| Chat se souborem | Zpráva s PDF, obrázkem, Wordem nebo Excelem (nejvýš 3 soubory po 10 MB). | Sonnet | 2 500 z cache · 9 000 vstup · 550 výstup | 0,024 USD <!-- cena: ai=chat in=9000 read=2500 write=0 out=550 --> | 3–5× |
| Chat: první zpráva konverzace | Otázka v panelu Gradyho. V kontextu je souhrn situace, tarify, poznámky (až 12 000 znaků) a odpovědi na otázky. | Sonnet | 2 500 do cache · 3 500 vstup · 450 výstup | 0,018 USD <!-- cena: ai=chat in=3500 read=0 write=2500 out=450 --> | 15× |
| Chat: další zpráva | Pokračování konverzace. S ní jde i historie, nejvýš 20 zpráv. | Sonnet | 2 500 z cache · 4 500 vstup · 450 výstup | 0,014 USD <!-- cena: ai=chat in=4500 read=2500 write=0 out=450 --> | 45× |
| Nastavit odměny větou | V plánu odměn „Popiš, jak chceš odměňovat“: katalog událostí, tabulky a fáze firmy a pravidla pracovníka jako kontext, návrh pravidel v JSON. Na požádání, nic se neuloží bez potvrzení. | Sonnet (nejméně) | 3 200 vstup · 700 výstup | 0,0134 USD <!-- cena: ai=reward_setup in=3200 read=0 write=0 out=700 --> | 0–2× |
| Hodnocení milníku („Gradyho pohled“) | Samo po založení milníku, jednou za milník. Bere i propojené poznámky. Když je milník dobrý, řekne to. | Sonnet | 2 200 do cache · 700 vstup · 350 výstup | 0,010 USD <!-- cena: ai=milestone_review in=700 read=0 write=2200 out=350 --> | 3–4× |
| Vyzkoušet pokyny | Administrace → AI a Grady → Pravidla → Vyzkoušet: odpověď na zkušební zprávu s pokyny z formuláře. Od 28.9 vlastní funkce s vlastním modelem. | Sonnet | 2 700 do cache · 150 vstup · 300 výstup | 0,0101 USD <!-- cena: ai=rules_test in=150 read=0 write=2700 out=300 --> | jen my |
| Souhrn týdne nebo měsíce | Při prvním příchodu v týdnu nebo měsíci u frekvence „týdně“ nebo „měsíčně“: co se povedlo, co stojí, 3 věci na období. Od 28.9 vlastní funkce s vlastním modelem; z noční úlohy dávkou za poloviční cenu. | Sonnet | 2 200 vstup · 450 výstup | 0,0089 USD <!-- cena: ai=period_summary in=2200 read=0 write=0 out=450 --> | 1–4× (místo denních) |
| Návrh odpovědi na e-mail | V okně e-mailu ke kontaktu nebo obchodu, na požádání. | Sonnet | 1 700 vstup · 400 výstup | 0,0074 USD <!-- cena: ai=email_reply in=1700 read=0 write=0 out=400 --> | 5× |
| Test spojení | Administrace → AI a Grady → Vyzkoušet připojení. Jen majitel a plný admin. | Sonnet | 2 200 do cache · 30 vstup · 30 výstup | 0,0059 USD <!-- cena: ai=ping in=30 read=0 write=2200 out=30 --> | jen my |
| Navrhnout větve mapy | U uzlu myšlenkové mapy v Poznámkách, na požádání. Navrhne 3–8 větví. | Sonnet | 1 400 vstup · 300 výstup | 0,0058 USD <!-- cena: ai=note_map_suggest in=1400 read=0 write=0 out=300 --> | 2–4× |
| Porovnat modely | Administrace → AI a Grady → Modely: vzorové vstupy funkce (`tests/fixtures/ai/`) na 1–4 vybraných modelech vedle sebe s cenou, dobou odezvy, kontrolami formátu a hodnocením. Před spuštěním odhad, platí se z rozpočtu aplikace, ne z odpovědí v tarifu. Cena za jednu odpověď podle modelu a funkce (zde Sonnet na souhrnu dne). | podle výběru | 1 300 vstup · 300 výstup | 0,0056 USD <!-- cena: ai=model_compare in=1300 read=0 write=0 out=300 --> | jen my (3 vzorky × 3 modely ≈ 0,05 USD) |
| Souhrn dne (ranní shrnutí) | Ráno ho napíše noční úloha (od 28.9 jednou dávkou přes Message Batches API za poloviční cenu), při prvním příchodu dne se ukáže. Když už fakta nesedí, přepíše se (přímé volání, plná cena). Prázdný den nic. | Sonnet | 1 300 vstup · 200 výstup | 0,0046 USD <!-- cena: ai=briefing in=1300 read=0 write=0 out=200 --> | 20–25× |
| Hlídání příležitostí | Jednou denně (10:00 UTC), jen u účtů, kde se od minula něco změnilo; od 28.9 jednou dávkou za poloviční cenu (návrhy přijdou do pár hodin). Návrh se ukáže v bublině nebo v panelu. | Haiku | 2 200 vstup · 300 výstup | 0,0004 USD <!-- cena: ai=opportunity_scan in=2200 read=0 write=0 out=300 --> | 15–20× |
| Průvodce: otázka „jak…“ | Na požádání v nabídce Průvodce, v ⌘K a z chatu („Ukázat na obrazovce“). Model dostane otázku, sekci, práva a jen relevantní část katalogu prvků (nejvýš 30 řádků) a vrátí 2–3 věty a kroky z klíčů katalogu; neplatné kroky se zahodí. Když si Haiku není jistý, zeptá se jednou Sonnetu (asi dvacetkrát dražšího). Stejná otázka ve stejné sekci, roli a s týmiž právy jde z cache zdarma a hned. | Haiku (Sonnet při nejasnosti) | 2 400 vstup · 200 výstup | 0,00034 USD <!-- cena: ai=guide_answer in=2400 read=0 write=0 out=200 --> | 0–5× |
| Hodnocení při porovnání | Ke každé porovnávané odpovědi známka 1–5 a jedna věta podle kritérií funkce. | Haiku | 1 500 vstup · 80 výstup | 0,00019 USD <!-- cena: ai=compare_judge in=1500 read=0 write=0 out=80 --> | jen my |
| Třídění nápadů z chatu | Když zpráva zní jako přání nové funkce, Haiku to ověří a majitel aplikace dostane e-mail. | Haiku | 300 vstup · 60 výstup | 0,00006 USD <!-- cena: ai=classify in=300 read=0 write=0 out=60 --> | 1–3× |
| Výběr modelu pro chat | Chat na „automaticky“: když pravidla nerozhodnou, Haiku jedním slovem řekne, jestli zpráva potřebuje Sonnet (nejvýš 20 výstupních tokenů). Nepočítá se do odpovědí v tarifu. | Haiku (pevně) | 180 vstup · 2 výstup | 0,00002 USD <!-- cena: ai=chat_route in=180 read=0 write=0 out=2 --> | 20–30× |

Pokyny majitele z administrace (až 2 000 znaků, asi 500 tokenů) jdou navíc do každého chatu a souhrnu. Definice nástrojů Gradyho přidají chatu asi 8 000 tokenů ve stálé části (z cache za 0,0008 USD na volání, zápis do cache jednou za 5 minut asi 0,02 USD); zpráva bez nástrojů stojí jako dřív plus tato cache. Celý blok poznámek přidá chatu nejvýš asi 4 000 tokenů, tedy nejvýš 0,008 USD na zprávu.

Druhy `check` a `summary` jsou v kódu připravené, ale dnes je nic nevolá. <!-- kód: ai:check ai:summary -->

### Co Grady dělá bez modelu (0 USD)
<!-- kód: kind:proactive kind:rateMessage kind:confirmAction kind:rejectAction kind:undoAction kind:meetingNotesApply -->

| Co | Jak to funguje | Pro koho |
|---|---|---|
| Pravidlové návrhy | Grady sám přiletí s věcí, kterou spočítá z dat: obchod vyhrán, komu se ozvat, obchod stojí, úkol po termínu, milník připravený k dokončení, faktura po splatnosti, obchodní úkol po termínu, další krok cesty, pozvánka do cizí firmy, docházející peníze podle plánu měsíce (kdy kapitál klesne pod nulu nebo rezervu a proč), rezervace ke schválení, nová rezervace z plánovače a žádost o sdílení kalendáře. Před ukázáním se vždy přepočítá. <!-- kód: proactive:dealWon proactive:followUps proactive:stalledDeal proactive:overdueTask proactive:milestoneReady proactive:overdueInvoice proactive:overdueCrmTask proactive:pathReady proactive:workerInvite proactive:cashLow proactive:bookingPending proactive:bookingNew proactive:calendarShareRequest proactive:insight --> | majitel |
| Návrh z hlídání | Postřeh z hlídání příležitostí, může nést úkoly k přidání. Model stojí jen to hlídání (viz výše), samotné ukázání nic. | majitel |
| Otázky | Nejvýš dvě týdně: cíl měsíce, kolik hodin chce volat, co ho brzdí, ideální zákazník. Odpovědi jdou do kontextu chatu. <!-- kód: question:monthlyGoal question:callingHours question:obstacle question:idealCustomer --> | majitel |
| Návrhy otázek v chatu | Tlačítka podle situace: naplánovat den, další krok, komu se ozvat, obchody, co stojí, úkoly a faktury po termínu, komu co dlužím na odměnách, první milník, první obchod, finance měsíce, začít volat. Po kliknutí je to obyčejná zpráva chatu. <!-- kód: chip:planDay chip:planNext chip:followUps chip:stalledDeals chip:overdueTasks chip:overdueCrmTasks chip:overdueInvoices chip:rewardsOwed chip:nextMilestoneStep chip:firstMilestone chip:firstDeal chip:monthFinance chip:startCalling --> | majitel, pracovník |
| Jak často se ozývá | Často (2 h), Občas (6 h, výchozí), Jednou denně, týdně, měsíčně. Řídí, kolik souhrnů a návrhů za měsíc vznikne. <!-- kód: frequency:every_2h frequency:every_6h frequency:daily frequency:weekly frequency:monthly --> | majitel |
| Odměny pracovníků | Souhrn situace v chatu nese odměny: majiteli (a pracovníkovi s právem „správa firmy: odměny“) komu co dluží a co čeká na schválení, pracovníkovi jeho vlastní měsíc (vyděláno, čeká, v plánu). Jen po měnách, nic se nepřepočítává. | majitel, pracovník |
| Časové okno | Volání a schůzky navrhuje jen v pracovní dny 8:00–17:30 v pásmu uživatele, mimo svátky ČR. | majitel, pracovník |
| Tutoriál a průvodce | Grady provází tutoriálem. Texty jsou z překladů, žádný model. | majitel, pracovník |
| Představení Poznámek | Jednou za život účtu, pevný text. | majitel |
| Uložit do poznámek | Odpověď Gradyho jde jedním tlačítkem do poznámky; do otevřené sdílené poznámky ji server vloží jako další účastník, nic nepřepíše. | majitel |
| Palec nahoru / dolů | Hodnocení odpovědi Gradyho, pro naši kontrolu kvality. | majitel, pracovník |
| Potvrdit, Zrušit, Vrátit | Karta změny pod odpovědí Gradyho: Potvrdit spustí čekající krok (server znovu ověří vlastníka, práva a vstup, návrh propadá po 30 min), Zrušit ho zahodí, Vrátit vezme zpět hotovou změnu do 24 h a nic nepřepíše, když se záznam mezitím změnil jinak. XP a oslavy jako při práci rukama. | majitel, pracovník |
| Reakce na návrh | Přidat, Později, Zavřít. Úkoly z návrhu vzniknou až po Přidat. | majitel |

---

## 3. Co stojí jeden uživatel za měsíc

Je to odhad podle kapitoly 2 a sazeb z `src/config/costs.ts` (1 USD = 21,50 Kč).

**Profily:**
- **Lehký** se párkrát týdně podívá, napíše pár zpráv Gradymu a negeneruje kontakty.
- **Běžný** pracuje skoro denně, Gradymu napíše asi 60 zpráv a vygeneruje 100 kontaktů.
- **Intenzivní** má Gradyho otevřeného pořád (asi 250 zpráv) a vyčerpá 300 vygenerovaných kontaktů jako na Pro.

| Náklad | Lehký | Běžný | Intenzivní | Z čeho |
|---|---|---|---|---|
| AI (Grady) | 0,30 USD | 1,20 USD | 4,80 USD | Lehký: 15 zpráv, 2 milníky, 8 souhrnů. Běžný: 60 zpráv (5 se souborem), 4 milníky, 25 souhrnů, 5 e-mailů, 1 rozbor. Intenzivní: 250 zpráv (30 se souborem), 10 milníků, 40 souhrnů, 30 e-mailů, 15 map, 4 rozbory. |
| Google Maps | 0 USD | 0,18–0,30 USD | 0,53–0,88 USD | 20 firem na požadavek po 0,035 USD. Duplicity stojí požadavek navíc. |
| E-maily | 0,003 USD | 0,02 USD | 0,09 USD | Upozornění ze Zpráv, faktury, e-maily kontaktům, asi 3 / 20 / 100 kusů |
| Úložiště | 0 USD | 0 USD | ~0,01 USD | Faktury v PDF, přílohy, dokumenty: asi 5 / 50 / 500 MB |
| **Celkem** | **≈ 0,30 USD (6 Kč)** | **≈ 1,50 USD (32 Kč)** | **≈ 5,70 USD (123 Kč)** | Pro srovnání: Solo stojí 490 Kč, Pro 890 Kč měsíčně |

**Pevné měsíční náklady, které nejsou na uživatele:**
- Supabase Pro: 25 USD, v ceně 100 GB souborů. Nad to asi 0,021 USD za GB podle ceníku Supabase; tuhle sazbu `costs.ts` nemá, je potřeba ji ověřit.
- Resend: paušál, z `costs.ts` počítáme jen cenu nad zahrnutý objem.
- Vercel.
- Google dává prvních 1 000 požadavků měsíčně zdarma; tady to nepočítáme, takže odhad je raději vyšší.

**Kde jsou skutečná čísla.** Každé volání modelu je v `ai_usage` s cenou. Administrace z nich počítá skutečné náklady:
- **/admin/naklady**: náklady celkem, na aktivního uživatele, podle funkce (chat, souhrn, hlídání…), 10 nejdražších účtů a marže podle tarifu.
- **/admin/ai**: útrata měsíce proti stropu; záložka Modely: útrata každé funkce za 30 dní, odhad na každém modelu a kolik ušetřil automatický výběr v chatu a úsporný režim (`ai_usage.routed_from`).
- **/admin/uzivatele/[id]**: útrata jednoho účtu.

Tyhle odhady je dobré jednou za měsíc porovnat s Náklady (období 30 dní) a tokeny v kapitole 2 upravit podle skutečnosti. Interní účty jsou z metrik vyloučené, ve stropu AI se počítají.

---

## 4. Čím jde omezovat tarif

### Co už dnes existuje
<!-- kód: limit:daily_contacts limit:monthly_contacts limit:ai_calls limit:ai_files limit:workers limit:storage_mb limit:scheduler_types -->

| Limit nebo přepínač | Co hlídá | Kde se nastavuje |
|---|---|---|
| Vygenerované kontakty za den | Počet uložených kontaktů z Google Maps za den. Solo 30, Pro a Team 100. | Administrace → Tarify (koncept → zveřejnit) |
| Vygenerované kontakty za měsíc | Totéž za kalendářní měsíc. Solo 100, Pro a Team 300. | Administrace → Tarify |
| Odpovědi Gradyho za měsíc | Každé úspěšné volání modelu včetně automatických. Solo 300, Pro 1 000, Team 1 500. | Administrace → Tarify |
| Soubory do Gradyho za měsíc | Přiložené soubory v chatu. Solo 0 (soubory vypnuté), Pro 100, Team 150. | Administrace → Tarify |
| Počet pracovníků | Kolik pracovníků účet má. Dnes všude bez limitu. Nad limitem režim jen pro čtení od další půlnoci. | Administrace → Tarify |
| Úložiště v MB | Dnes všude bez limitu. **Počítá jen soubory poslané Gradymu**, ne faktury, přílohy Zpráv ani dokumenty pracovníků. | Administrace → Tarify |
| Aktivní typy schůzek | Kolik typů schůzek v Plánovači může mít jeden člověk zapnutých. Solo 1, Pro a Team bez limitu (verze katalogu před 24.3 a beta podle tabulky `plans`). Nad limitem nový typ začne vypnutý, zapnutí odmítne DB s nabídkou vyššího tarifu. | Administrace → Tarify |
| Cena za pracovníka a pracovníci v ceně | `per_worker` = cena za každého pracovníka navíc, `included_workers` = kolik jich je v ceně (starší verze bez pole = 0). Platí jen za pracovníky bez vlastního platného tarifu. Koncept z 22.5: Solo 0 a bez ceny, Pro 0 + 290 Kč / 12 EUR, Team 10 v ceně + 290 Kč; beta (tabulka `plans`) 0 + 290 Kč. Jen se počítá; ukazuje a účtuje se až se zapnutým WORKER_BILLING_VISIBLE. | Administrace → Tarify |
| Placení za pracovníky viditelné | WORKER_BILLING_VISIBLE: štítky ceny u pracovníků, řádek Pracovníci v Předplatném, cena za pracovníka na kartách tarifů a webu, věta v e-mailu pozvánky a položka pracovníků ve Stripe. Výchozí vypnuto. | `app_settings.worker_billing` (`{ "visible": true }`, zápis `admin_set_app_setting`) |
| Celkový strop AI | Měsíční útrata za AI všech účtů (výchozí 90 USD). Od prahu upozornění úsporný režim, nad stropem Grady do konce měsíce nevolá model. | Administrace → AI a Grady → Strop využití AI |
| Strop AI na uživatele | Měsíční útrata jednoho účtu v USD. Výchozí bez limitu. Platí dvakrát: na všechno, co účet utratil kdekoli, a jako strop jeho prostoru na všechna volání v něm (i jeho pracovníků, platí majitel). | Administrace → AI a Grady → Strop využití AI |
| Výjimka pro uživatele | Vlastní strop nebo úplně vypnutá AI pro jeden účet. | Administrace → Uživatelé → detail |
| Práh upozornění a úsporného režimu | Od kolika procent stropu přijde e-mail a Grady přejde do úsporného režimu (výchozí 80 %). Stejný podíl stropu uživatele nebo firmy zapne úsporný režim jen pro ně. | Administrace → AI a Grady |
| Modely Gradyho | Model každé funkce (Haiku · Sonnet · Opus · Fable, chat i automaticky), přednastavení Úsporné · Vyvážené · Kvalitní, úsporný režim ručně a model pro velké rozbory v chatu. Dnes platí pro celou aplikaci, ne podle tarifu. | Administrace → AI a Grady → Modely |
| Pravidla Gradyho | Vypínač u každého druhu proaktivního návrhu a u otázek, rozestupy, otázek týdně, stáří návrhu, pokyny. | Administrace → AI a Grady → Pravidla |
| Zkušební období | 14 dní tarifu Pro bez karty. Po něm jen pro čtení. | V kódu (`TRIAL_DAYS`), změna = nasazení |
| Tarif beta | Testeři a **každý pozvaný pracovník** dostanou tarif beta bez konce: 500 / 5 000 kontaktů, 3 000 odpovědí Gradyho, 500 souborů. Beta pracovníka z pozvánky je „přes firmu“ (`via_worker_invite`), za vlastní tarif se nepočítá. Odpovědi Gradyho v cizí firmě se počítají podle tarifu té firmy. | Jen v databázi (tabulka `plans`), v administraci ne |
| Promo kódy | Dny zkoušky navíc, sleva z první platby, měsíce zdarma. | Administrace → Promo kódy |
| Ceny v měnách | Základ v EUR, ruční ceny v libovolných měnách (dnes CZK), ostatní z kurzu se „prodejním“ zaokrouhlením (`psychologicalPrice`, nejvýš 8 % od přesného přepočtu). Platí se jen v EUR a v měnách s ruční cenou. Náhled v libovolné měně, „Přepsat ručně“, varování nad 15 % od kurzu. | Administrace → Tarify |
| Doplňky | Položky katalogu navíc k tarifu (dnes `no_branding`), cena měsíčně v EUR a ručních měnách. | Administrace → Tarify |
| Registrace bez pozvánky | Zapíná veřejnou registraci se zkušebním obdobím a schová čekací listinu. Bez potvrzování e-mailu v Supabase ukáže administrace varování. Kontrolní seznam spuštění je v `docs/spusteni.md`. | Proměnná `PUBLIC_SIGNUP_ENABLED`, změna = restart |
| Připojené aplikace (MCP) | Přepínač `mcp` u každého tarifu v katalogu (chybí = zapnuto, dnes všude zapnuto). Vypnutý tarif nechá v Claudovi jen whoami a switch_space. Navíc firma (majitel ve Správě firmy) a právo pracovníka „Integrace: MCP“. | Administrace → Tarify (přepínač u tarifu) |
| Vlastní vzhledy | Přepínač `custom_themes` u každého tarifu v katalogu (chybí = zapnuto, dnes všude zapnuto). Vypnutý tarif nedovolí vytvořit ani importovat nový vlastní vzhled (hlídá DB), už vytvořené fungují dál. | Administrace → Tarify (přepínač u tarifu) |
| Koš Gradyho a připojených aplikací | Kolik dní jde obnovit, co smazal Grady nebo připojená aplikace (výchozí 7, 1–90). | Administrace → AI a Grady → Pravidla |
| Práva pracovníka | Co pracovník smí v každé sekci, včetně generování kontaktů. | Aplikace → Správa firmy (majitel) |

Pevné hranice v kódu, stejné pro všechny:
- Grady bere nejvýš 3 soubory po 10 MB na zprávu.
- Zprávy berou nejvýš 5 příloh po 10 MB.
- Dokument pracovníka může mít nejvýš 20 MB.
- Import mapy založí nejvýš 1 000 úkolů najednou a 2 000 úkolů v milníku.
- Jedno generování přinese nejvýš 60 firem (3 požadavky na Google).
- Nahlásit problém jde nejvýš 20× za hodinu; formulář Podpora bez přihlášení 5× za hodinu z jedné adresy.

### Co by šlo omezit snadno, ale dnes limit nemá

| Co | Dnes | Jak snadno |
|---|---|---|
| Pracovníci jen v Team | Pozvat pracovníky jde na kterémkoli tarifu, limit `workers` je všude prázdný. | Vyplnit limit v katalogu (např. Solo a Pro 0). Hlídání už existuje. |
| Rozbor schůzek jen v Pro | Karta tarifu ho slibuje v Pro, ale funguje na všech tarifech. | Kontrola tarifu před voláním, jedno místo v `/api/grady`. |
| Úložiště všech souborů | Limit počítá jen soubory pro Gradyho. | Přičíst faktury, přílohy Zpráv a dokumenty pracovníků (velikosti v úložišti známe). |
| E-maily kontaktům a faktury e-mailem | Bez počtu. | Měsíční počet podle `usage_events` jako u generování. |
| Proaktivní Grady podle tarifu | Souhrny a hlídání mají všechny tarify stejně. | Přepínač podle tarifu vedle pravidel Gradyho. |
| Počty záznamů | Kontakty, obchody, milníky, poznámky a faktury nemají strop. | Kontrola při zakládání. Spíš nedoporučujeme, nic nás nestojí. |
| Google požadavky místo kontaktů | Limit počítá uložené kontakty. Duplicity stojí požadavek, ale do limitu se nepočítají. | Počítat i požadavky z `usage_events`. |

**Pozor:** výchozí karta tarifu Pro slibuje „Synchronizaci kalendáře“, ta ale v aplikaci není. Karty Team slibují „Týmové statistiky“ a „Systém odměn“, ty fungují na každém tarifu.

---

## Jak dokument udržovat

- Nová funkce, sekce, stránka nebo schopnost Gradyho = nový řádek tady: co dělá, pro koho, náklad.
- U AI patří řádek do tabulky v kapitole 2 i s modelem, tokeny a cenou, seřazený od nejdražšího.
- `bun run docs:funkce` vypíše:
  - stránky, položky menu, Gradyho katalogy a limity tarifů, které tu chybí;
  - co tu zůstalo, i když to kód už nemá;
  - ceny, které nesedí na tokeny a `src/config/costs.ts`.
- Značky `<!-- kód: … -->` a `<!-- cena: … -->` jsou pro skript a čtenář je nevidí.
