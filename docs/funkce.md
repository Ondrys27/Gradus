# Co Gradus umí a co nás to stojí

Tenhle přehled je pro návrh tarifů. Popisuje, co aplikace a Jarvis umí, kdo co používá a kolik nás stojí provoz. Píše se z kódu a drží se aktuální: kdo přidá funkci, připíše ji sem. `bun run docs:funkce` porovná dokument s kódem a vypíše, co v něm chybí (v textu jsou na to skryté značky `<!-- kód: … -->`, při čtení nejsou vidět).

Stav k 9. 11. 2026.

**Jak číst štítky nákladu**

| Štítek | Co znamená |
|---|---|
| **žádný** | Jen naše databáze a server. Za jedno použití neplatíme nic navíc. |
| **AI** | Volá model Claude (Jarvis). Platíme za tokeny, každé volání je zapsané v `ai_usage` s cenou. |
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
| Šest čísel | Příjem za měsíc, splněné úkoly, úspěšnost obchodů, aktivní obchody, nové kontakty a čas volání. Každé číslo jde rozkliknout na graf. | majitel | žádný |
| Rozbor obchodních schůzek | V detailu úspěšnosti obchodů napíše Jarvis rozbor dotazníků ze schůzek: co funguje, co ne a co zkusit jinak. Odemkne se po 5 dotaznících. | majitel, pracovník | AI (Opus) |
| Dotazník spokojenosti | Po 14 dnech se zeptá na spokojenost 1–5 a co zlepšit, pak znovu po 30 dnech. | majitel, pracovník | žádný |
| Nástěnka pracovníka | Pracovník má vlastní nástěnku: odpracované hodiny, výdělek, otevřené úkoly a časovač práce. | pracovník | žádný |

### Milníky a mapa
<!-- kód: nav:milestones route:/app/milniky route:/app/milniky/[id] -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Milníky a úkoly | Velké cíle rozdělené na úkoly a podúkoly do libovolné hloubky. Milník jde dokončit, až je všechno hotové. | majitel, pracovník s právem milníky | žádný |
| Cesta podle oboru | Po výběru oboru se založí připravené milníky s úkoly. V herním režimu postupně odemykají další části aplikace. | majitel | žádný |
| Odměna za milník | Majitel si k milníku napíše vlastní odměnu, při dokončení ji uvidí v oslavě. | majitel | žádný |
| Jarvisův pohled | Hned po založení milníku k němu Jarvis napíše krátké hodnocení, a to u každého milníku jen jednou. | majitel, pracovník | AI (Sonnet) |
| Myšlenková mapa úkolů | Úkoly milníku jako mapa: přetahování, zoom, sbalování větví, celá obrazovka. | majitel, pracovník | žádný |
| Import mapy | Načte plán z Markdownu, OPML, FreeMindu, XMindu nebo textu s odsazením a udělá z něj úkoly. Soubor zpracuje server a nic z něj neukládá. | majitel, pracovník | žádný |
| Export mapy | Uloží úkoly jako Markdown, OPML, FreeMind nebo obrázek PNG. | majitel, pracovník | žádný |

### Poznámky
<!-- kód: nav:notes route:/app/poznamky -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Poznámky | Podklady k podnikání (ideální zákazník, ceník, konkurence, skript) na jednom místě, jako Apple Notes. Ukládá se samo. | jen majitel | žádný |
| Šablony | Připravené osnovy (ideální zákazník, nabídka, ceník, konkurence, prodejní skript), každá i jako mapa. | jen majitel | žádný |
| Myšlenková mapa místo textu | Poznámka jde psát jako mapa s barvami, poznámkami u uzlů a odkazy. Jde ji převést na text a zpátky. | jen majitel | žádný |
| Odkazy na záznamy | Přes `@` jde do textu vložit kontakt, obchod, událost nebo pracovníka. U záznamu je pak vidět „Zmíněno v poznámkách“. | jen majitel | žádný |
| Hledání a koš | Fulltext bez diakritiky. Smazané poznámky leží 30 dní v koši. | jen majitel | žádný |
| Navrhnout větve | U uzlu mapy Jarvis navrhne 3–8 nových větví, uživatel je ponechá nebo smaže. | jen majitel | AI (Sonnet) |
| Jarvis čte poznámky | V chatu Jarvis vychází z poznámek uživatele, ať se neptá na to, co už je zapsané. | jen majitel | AI (v ceně chatu) |

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
| Navrhnout odpověď | Uživatel vloží e-mail, který dostal, a Jarvis k němu napíše odpověď, kterou si upraví a pošle sám. | majitel, pracovník | AI (Sonnet) |

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
| Co hoří a filtry | Dlaždice se špatnými věcmi a filtry (termín, aktivita, úkoly, pracovník, kontakt, částka) uložené v adrese. | majitel, pracovník | žádný |
| Výhra a prohra | Výhra spustí oslavu a kontakt přejde do Klientů. U prohry se zapíše důvod a po čase se objeví štítek „znovu oslovit“. | majitel, pracovník | žádný |
| Dotazník po schůzce | Když obchod opustí fázi Schůzka, krátký dotazník zachytí, jak schůzka proběhla. Z dotazníků pak vzniká rozbor schůzek. | majitel, pracovník | žádný |
| Vystavit fakturu z obchodu | Založí koncept faktury s odběratelem a částkou z obchodu. | majitel, pracovník s fakturami | žádný |

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
| Bez obousměrného napojení | Zápis do Google nebo Apple kalendáře a opakované události v Gradusu dnes **nejsou**; ven jde jen odkaz k odběru (Nastavení → Kalendář). | — | — |

### Plánovač schůzek
<!-- kód: nav:scheduler route:/app/planovac -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Typy schůzek | Karty typů (název, délka, místo: videohovor / telefon / osobně / jinak, barva, počet rezervací za 30 dní, Kopírovat odkaz, přepínač aktivní). Při prvním otevření tři typy (Úvodní hovor 15 min, Konzultace 30 min, Schůzka 60 min) a pracovní doba po–pá 9–17. | majitel, pracovník s právem „plánovač: vlastní“ | žádný |
| Editor typu | Záložky Základ · Dostupnost (vlastní pracovní doba, volno před a po, nejdřív za, nejvýš dopředu do 60 dní, nejvýš za den, časy po 15 / 30 / 60 min) · Otázky (jméno a e-mail vždy, telefon, firma, vlastní; řazení, povinné) · Připomínky (výchozí 24 h a 1 h, nejvýš 5) · Potvrzení (schvalovat ručně, text po rezervaci, založit obchod ve fázi) · Náhled (skutečné volné termíny). | majitel, pracovník (své) | žádný |
| Dostupnost | Časové pásmo, pracovní doba po dnech s více úseky, výjimky kalendářem (volný den, dovolená, jiná doba). Volné termíny počítá jedna funkce (`slots.ts`) z pracovní doby mínus vlastní události a obchodní úkoly s časem, obsazené časy odebíraných kalendářů a aktivní rezervace. | majitel, pracovník (své) | žádný |
| Rezervační stránka | Odkaz `/s/<adresa>/<typ>` s vlastní adresou (handle) a trvalým odkazem na videohovor; průvodce „adresa, videohovor, pracovní doba“. | majitel, pracovník (své) | žádný |
| Veřejná rezervace | Bez přihlášení: `/s/<adresa>` (hostitel a jeho aktivní typy, jediná stránka k indexování) a `/s/<adresa>/<typ>` (měsíční kalendář s volnými dny, časy v pásmu hosta s přepínačem, otázky typu, shrnutí, Rezervovat). Jazyk cs / en podle prohlížeče, jinak hostitele, s přepínačem; cookies jen jazyk a pásmo. Kliknutý čas se 5 minut drží (odpočet), dva hosté nikdy nedostanou stejný ani překrývající se čas; nejvýš 10 rezervací za hodinu z jedné adresy, honeypot proti botům. Stránka je pozvánka (24.5): vlevo hostitel a schůzka, vpravo kalendář a časy, na telefonu kroky den → čas → údaje; pozadí se jemně hýbe jen přes CSS (s omezeným pohybem stojí). Potvrzení s krátkými konfetami, velkým datem a časem, Přidat do kalendáře (Google, Apple/ICS se stejným UID jako pozvánka v e-mailu, Outlook) a odkazem na videohovor; „čeká na potvrzení“ řečené lidsky. Logo a „Vytvořeno v Gradusu“ zmizí s doplňkem Bez značky, místo nich stojí v hlavičce jméno firmy hostitele. | host (klient uživatele) | e-mail |
| Co rezervace udělá | Kontakt (podle e-mailu v prostoru, jinak nový se zdrojem „plánovač“), schůzka v kalendáři hostitele s odpověďmi (kalendář ji jen otevře, přesouvá a ruší se přes rezervaci), po potvrzení kontakt do Domluvená schůzka (z Klientů nikdy; do sdíleného grafu času volání se nepočítá) a obchod ve fázi typu. | majitel, pracovník (své) | žádný |
| E-maily a připomínky | Hostovi potvrzení nebo „čeká na potvrzení“ s pozvánkou .ics, odkazem na videohovor (jen potvrzená) a tlačítky Přesunout / Zrušit (odkaz `/s/r/<token>` platí do konce schůzky), v jazyce a pásmu hosta; hostiteli nová rezervace / ke schválení s odkazem do aplikace. Připomínky typu hostovi i hostiteli jako naplánované e-maily Resend (nejvýš 30 dní dopředu, dál doplní denní cron); přesun a zrušení je zruší a naplánuje znovu. | host, majitel, pracovník (své) | e-mail |
| Schválení | Typ se schvalováním: Potvrdit / Odmítnout (důvod, volitelně jiný čas) na nástěnce v „Čeká na tebe“, v Plánovač → Rezervace a z e-mailu; potvrzení pošle hostovi odkaz na hovor a doběhne kontakt, Cold Calling, obchod a připomínky. | majitel, pracovník (své) | e-mail |
| Přesun a zrušení | Host na `/s/r/<token>` vybere nový volný termín nebo zruší s důvodem; hostitel totéž v Rezervacích a v detailu schůzky v kalendáři. Obě strany dostanou e-mail, kalendář a připomínky se srovnají, zrušená zůstane v historii kontaktu. | host, majitel, pracovník (své) | e-mail |
| Po schůzce | Proběhlá rezervace s obchodem nabídne v „Čeká na tebe“ dotazník o schůzce (stejný jako při posunu obchodu ze Schůzky), Nepřišel nebo Přeskočit; „Nepřišel“ jde označit i v Rezervacích. | majitel, pracovník (své) | žádný |
| Rezervace | Nadcházející a minulé se stavem a filtrem, detail s odpověďmi a akcemi (Potvrdit, Odmítnout, Přesunout, Zrušit, Nepřišel); majitel přepne na „Všichni“ (jen čtení). | majitel, pracovník (své) | žádný |
| Všichni | Majitel vidí rezervační stránky a typy pracovníků a jejich rezervace, typ může jen vypnout. | jen majitel | žádný |
| Jarvis a odkaz na schůzku | Jarvis zná nadcházející rezervace a čekající schválení; u kontaktu v Cold Callingu ve stavu Ozvat se a v e-mailu nabídne „pošli odkaz na schůzku“ s nejvhodnějším typem (úvodní hovor nejkratší, schůzka nejblíž 30 min). | majitel, pracovník (své) | žádný (v návrhu odpovědi e-mailem součást volání AI) |

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
| Pozvat pracovníka | Krátkým ID nebo e-mailem existujícího účtu: pozvánka čeká v jeho aplikaci (zvonek, e-mail, Jarvis). E-mailem novému člověku: odkaz na registraci jako dřív (i e-mailem). S nadřízeným, skupinami, právy a odměnami. | jen majitel | e-mail |
| Pozvánky | Pozvaný vidí „Novák s.r.o. · Václav Novák tě zve jako Obchodník“, co tam uvidí a odměny; přijme (firma je v přepínači) nebo odmítne. Majitel vidí stav a dostane oznámení. | kdokoli s pozvánkou | žádný |
| Odejít z firmy | Pracovník sám v Nastavení → Účet; majitel dostane oznámení a e-mail, práce zůstává ve firmě. | pracovník | e-mail |
| Kdo za koho platí | Kdo má vlastní platný tarif, je ve firmě zdarma; za ostatní platí majitel: pracovníci v ceně tarifu, pak cena za každého dalšího. Štítek u pracovníka a řádek v Předplatném; ve Stripe druhá položka předplatného, počet se srovná denně a platí od dalšího období. | jen majitel | Stripe |
| Lidé, strom a mapa | Hierarchie firmy jako seznam nebo organizační mapa, přesun tažením. | majitel; pracovník svou větev (s právem celou firmu) | žádný |
| Skupiny | Pracovníci ve skupinách, každá skupina má i svou konverzaci ve Zprávách. | jen majitel | žádný |
| Jemná práva | U každé sekce zvlášť zobrazit, zakládat, upravovat, mazat… Šablony Obchodník, Asistent, Účetní, Vše. | jen majitel | žádný |
| Dashboard pracovníka | Přehled, práva, obchody a úkoly s grafy plnění, dokumenty, tým, odměny. | majitel, pracovník (sám sebe) | žádný |
| Dokumenty pracovníka | Smlouvy a doklady k pracovníkovi (do 20 MB). | majitel | úložiště |
| Systém odměn | Majitel nakreslí, za co pracovníci dostanou zaplaceno (úkol, schůzka, vyhraný obchod, hodina), a schvaluje výdělky. | jen majitel | žádný |
| Nastavit odměny s AI | Jarvis převede poznámky ve stromu odměn na pravidla a vysvětlí je. Platí až po potvrzení. | jen majitel | AI (Sonnet) |
| Moje odměny | Pracovník vidí své výdělky: čeká na schválení, schváleno, vyplaceno. | pracovník | žádný |
| Odstranit z firmy | Ukončí přístup hned, data zůstanou, otevřenou práci předá někomu jinému. | jen majitel | žádný |

### Zprávy
<!-- kód: nav:messages route:/app/zpravy -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Chat ve firmě | Skupinové a osobní konverzace jako WhatsApp Web: zmínky, odpovědi, přečteno, připnutí, ztlumení. Jarvis zprávy nikdy nečte. | majitel, pracovník (vždy) | žádný |
| Přílohy | Až 5 souborů po 10 MB ke zprávě. Rok neotevřené jdou do koše. | majitel, pracovník | úložiště |
| Upozornění e-mailem | Kdo 10 minut není v aplikaci, dostane e-mail o osobní zprávě nebo zmínce, nejvýš jeden za hodinu. Jde vypnout. | majitel, pracovník | e-mail |
| Export konverzace | Stažení konverzace jako CSV. | jen majitel | žádný |

### Jarvis

AI pomocník v pravém dolním rohu: chat, souhrny dne, návrhy a hodnocení. Všechno, co dělá, s modelem a cenou je v [kapitole 2](#2-jarvis). Majitel i pracovník mají každý vlastního Jarvise a vlastní konverzace.

### Nastavení
<!-- kód: route:/app/nastaveni route:/app/nastaveni/ucet route:/app/nastaveni/vzhled route:/app/nastaveni/prace route:/app/nastaveni/jarvis route:/app/nastaveni/soukromi route:/app/nastaveni/predplatne route:/app/tarif route:/app/nastaveni/kalendar -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Účet | Fotka, jméno, uživatelské jméno, krátké ID účtu (kopírovat, QR), e-mail, jazyk, heslo; ve vlastní firmě její název a logo. | majitel, pracovník | úložiště (fotka, logo) |
| Vzhled | Šest barevných témat (v herním režimu se odemykají úrovní), zvuky, animace, země, pásmo, měna a formáty. Měna je jakákoli platná podle ISO 4217 (hledání podle kódu i názvu, měna země a nejčastější nahoře); mění jen zobrazení, uložené částky zůstávají v měně, ve které vznikly. | majitel, pracovník | žádný |
| Práce | Herní nebo nástrojový režim, cesta oboru, kdy znovu oslovit ztracené obchody a údaje na faktury. | majitel (část i pracovník) | žádný |
| Jarvis | Zapnutí proaktivního Jarvise, jak často se ozývá, tichý režim, e-maily ze Zpráv, znovu spustit tutoriál, smazat ukázková data. | majitel, pracovník | žádný |
| Kalendář | Odebírané kalendáře: tajná adresa iCal (Google, Apple, Outlook) s návodem, název, barva; server ji stáhne (jen https, 5 MB, 10 s, veřejné adresy), uloží šifrovaně a drží jen obsazené časy na 60 dní, obnova denně, ručně a při otevření rezervační stránky. Odkaz pro odběr kalendáře Gradusu (ICS s tajným tokenem, ukáže se jednou, jde obnovit a vypnout). | majitel, pracovník | žádný |
| Soukromí | Export všech dat (ZIP s CSV), smazání účtu, podmínky a ochrana soukromí. | majitel, pracovník | žádný |
| Předplatné | Tarif, změna, zrušení a obnovení, historie plateb s doklady, fakturační údaje (propíšou se do Stripe), promo kód. Stará adresa /app/tarif sem přesměruje. | jen majitel | e-mail (nám o změně) |
| Platební metoda a doklady | „Spravovat platební metodu a doklady“ otevře Stripe Customer Portal: změna karty, fakturační adresa a seznam dokladů (tarif se mění a ruší jen v Gradusu). Historie plateb ukazuje datum, tarif, období, částku, stav (i vráceno) a doklad od Stripe. | jen majitel | Stripe |
| Neúspěšná platba | Když platba selže, majitel vidí nad aplikací „Platba se nepovedla, aktualizuj kartu“ s odkazem do portálu; aplikace běží dál, Stripe platbu opakuje a posílá vlastní e-maily. Když neprojde ani poslední pokus, předplatné skončí a účet je jen pro čtení jako po zkušebce, nic se nesmaže. Jarvis to v rozhovoru jednou připomene. Pracovník nic nevidí. | jen majitel | Stripe, e-mail (nám souhrnem 1× denně) |
| Doplňky | V Předplatném přepínač „Bez značky Gradus“ (0,99 € měsíčně, 29 Kč ručně, jinde podle kurzu). Ve Stripe se zapnutím přidá položka předplatného se zbytkem období hned, vypnutím odebere; během zkušebky se zaplatí spolu s tarifem, beta neplatí. Skrytí značky použije plánovač schůzek (24.3). | jen majitel | Stripe |
| Zaplatit a pokračovat | Placení přes Stripe Checkout: zkušebka je bez karty, kdo zaplatí během ní, platí až od jejího konce, po expiraci hned. Tlačítko je v Předplatném, v liště posledních 3 dnů zkušebky a na kartě po expiraci. Promo kód se uplatní jako kupon, jiné kódy ve Stripe zadat nejde. Vyšší tarif ve Stripe hned s doplatkem, nižší od konce období, zrušení ke konci období. Ceny jen ze zveřejněného katalogu, testovací a ostrý režim se nemíchají. | jen majitel | Stripe |

### Napříč aplikací
<!-- kód: route:/app/test-chyby -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Onboarding | Průvodce na začátku: režim, obor, cesta, země a měna, první kontakt. Pracovník z pozvánky ho dostane, až se poprvé přepne do vlastní firmy. | majitel | žádný |
| Přepínač firem | Každý účet má vlastní firmu a může pracovat v dalších. Vpravo nahoře (na telefonu ve Více) „Moje firma“ a firmy, kde je pracovníkem, s názvem a logem; v cizí firmě tyrkysový proužek a název v hlavičce. Data firem se nemíchají, odkaz /app/prostor/… do firmy, kde účet není, je 404. | majitel, pracovník | žádný |
| Tutoriál | Rychlá ukázka (≈ 2 min) nebo úplný tutoriál na ukázkových datech (≈ 15 min). Texty jsou pevné, bez AI. | majitel; pracovník zkrácenou ukázku | žádný |
| Hledání ⌘K | Najde kontakty, obchody, milníky, úkoly, poznámky, události, faktury, pracovníky i nastavení, bez diakritiky. | majitel, pracovník (co vidí) | žádný |
| Hra | XP, 30 úrovní, odznaky, série, oslavy, odemykání sekcí a témat. Nástrojový režim to vypne. | majitel, pracovník | žádný |
| Nahlásit problém | Hlášení chyby nebo nápadu i se snímkem obrazovky, majitel aplikace dostane e-mail. | majitel, pracovník | e-mail, úložiště |
| Upozornění na chyby | Každá zachycená chyba přijde majiteli aplikace e-mailem (s ochranou proti záplavě). Stránka /app/test-chyby je jen pro naše testy. | jen my | e-mail |
| Kurzy měn | Jednou denně kurzy proti EUR z ECB (frankfurter.app) a open.er-api.com, oba zdarma a bez klíče. Jen pro zobrazení cen tarifů a souhrnů napříč měnami („orientačně podle kurzu z …“); uložené částky se nikdy nepřepočítávají, kurz starší než 7 dní se pro cenu nepoužije. Stav zdrojů v Administraci → Zdraví. | všichni | žádný |

### Web
<!-- kód: route:/ route:/cenik route:/podminky route:/soukromi route:/cekaci-listina route:/en route:/en/pricing route:/en/terms route:/en/privacy route:/en/waitlist -->
<!-- kód: route:/prihlaseni route:/registrace route:/zapomenute-heslo route:/nove-heslo route:/zmena-emailu route:/en/login route:/en/register route:/en/forgot-password route:/en/reset-password route:/en/change-email -->

| Funkce | Co dělá | Pro koho | Náklad |
|---|---|---|---|
| Úvodní stránka a ceník | Česky na `/`, anglicky pod `/en`. Ceny se berou ze zveřejněného katalogu tarifů. Bez sledovacích cookies. Ceník ukazuje měnu podle země návštěvníka (hlavička Vercelu, cookie jen s kódem měny), přihlášenému jeho měnu, s přepínačem a odkazem `?mena=USD`; měna bez ruční ceny se přepočte z EUR denním kurzem s poznámkou „orientačně podle kurzu z …, platí se v EUR“. SEO nabídky v měně stránky. Při veřejné registraci vede tlačítko každého tarifu na registraci s předvybraným tarifem a obdobím (`?tarif=pro&obdobi=rok`) a čekací listina se schová. | návštěvník | žádný |
| Čekací listina | Dokud je registrace uzavřená, nechá návštěvník e-mail a potvrdí ho odkazem. | návštěvník | e-mail |
| Podmínky a soukromí | Právní stránky v obou jazycích, s oddíly pro placení (prodávající, cena a Stripe, obnovování, zrušení, odstoupení, reklamace). Údaje prodávajícího z proměnných prostředí; dokud některý chybí, build v produkci selže. | návštěvník | žádný |
| Přihlášení a registrace | Přihlášení, registrace s pozvánkou nebo kódem, a při veřejné registraci i bez kódu (14 dní zdarma). Povinný souhlas s podmínkami a zásadami (server uloží kdy a kterou verzi), nepovinný souhlas s novinkami. Tarif vybraný na webu se ukáže v Předplatném jako „Vybraný tarif, zaplatíš po zkušebce“ a zaplatí ho tlačítko Zaplatit. Špatné pozvánkové a promo kódy mají limit pokusů podle IP a e-mailu. Zapomenuté heslo, nové heslo, potvrzení změny e-mailu. | každý | e-mail (Supabase přes Resend) |
| Odkaz partnera | `/?kod=XYZ` si zapamatuje promo kód na 30 dní a registrace ho předvyplní. | návštěvník | žádný |

---

## 2. Jarvis

Model vybírá kód podle druhu práce (`src/features/jarvis/models.ts`):
- **Haiku** dělá rutinu, třídění a hlídání.
- **Sonnet** píše chat, souhrny, hodnocení a návrhy.
- **Opus** píše velké rozbory.

Ceny za milion tokenů jsou v `src/config/costs.ts`:

| Model | Vstup | Zápis do cache | Čtení z cache | Výstup |
|---|---|---|---|---|
| Haiku | 0,10 USD | 0,125 USD | 0,01 USD | 0,50 USD |
| Sonnet | 2 USD | 2,50 USD | 0,10 USD | 10 USD |
| Opus | 4 USD | 5 USD | 0,20 USD | 20 USD |

Tokeny jsou odhad z délky promptů v kódu a běžných dat, ne měření; jeden token je asi 4 znaky. Stálá část chatu, tedy povaha Jarvise a pravidla (asi 2 500 tokenů), se ukládá do cache. Od druhé zprávy během 5 minut ji proto platíme za desetinu ceny. Každé úspěšné volání, i automatické (souhrn, hlídání, hodnocení milníku, třídění nápadů), se počítá do měsíčního limitu odpovědí Jarvise v tarifu.

### Co volá model, od nejdražšího
<!-- kód: ai:analysis ai:chat ai:milestone_review ai:reward_setup ai:briefing ai:email_reply ai:ping ai:note_map_suggest ai:opportunity_scan ai:classify -->
<!-- kód: kind:salesAnalysis kind:milestoneReview kind:rewardSetup kind:emailReply kind:ping kind:rulesTest kind:noteMapSuggest -->

| Co Jarvis dělá | Kdy a pro koho | Model | Typické tokeny | Cena 1 použití | Běžný uživatel za měsíc |
|---|---|---|---|---|---|
| Rozbor obchodních schůzek | Na požádání, po 5 dotaznících ze schůzek. Čte až 150 posledních. | Opus | 2 200 do cache · 3 500 vstup · 1 200 výstup | 0,049 USD <!-- cena: ai=analysis in=3500 read=0 write=2200 out=1200 --> | 0–1× (se 150 dotazníky až 0,13 USD) |
| Chat se souborem | Zpráva s PDF, obrázkem, Wordem nebo Excelem (nejvýš 3 soubory po 10 MB). | Sonnet | 2 500 z cache · 9 000 vstup · 550 výstup | 0,024 USD <!-- cena: ai=chat in=9000 read=2500 write=0 out=550 --> | 3–5× |
| Chat: první zpráva konverzace | Otázka v panelu Jarvise. V kontextu je souhrn situace, tarify, poznámky (až 12 000 znaků) a odpovědi na otázky. | Sonnet | 2 500 do cache · 3 500 vstup · 450 výstup | 0,018 USD <!-- cena: ai=chat in=3500 read=0 write=2500 out=450 --> | 15× |
| Chat: další zpráva | Pokračování konverzace. S ní jde i historie, nejvýš 20 zpráv. | Sonnet | 2 500 z cache · 4 500 vstup · 450 výstup | 0,014 USD <!-- cena: ai=chat in=4500 read=2500 write=0 out=450 --> | 45× |
| Hodnocení milníku („Jarvisův pohled“) | Samo po založení milníku, jednou za milník. Bere i propojené poznámky. Když je milník dobrý, řekne to. | Sonnet | 2 200 do cache · 700 vstup · 350 výstup | 0,010 USD <!-- cena: ai=milestone_review in=700 read=0 write=2200 out=350 --> | 3–4× |
| Nastavit odměny s AI | Ve Správě firmy → Systém odměn, na požádání. | Sonnet | 1 500 vstup · 700 výstup | 0,010 USD <!-- cena: ai=reward_setup in=1500 read=0 write=0 out=700 --> | 0–1× (jen firmy s pracovníky) |
| Souhrn týdne nebo měsíce | Při prvním příchodu v týdnu nebo měsíci u frekvence „týdně“ nebo „měsíčně“: co se povedlo, co stojí, 3 věci na období. | Sonnet | 2 200 vstup · 450 výstup | 0,0089 USD <!-- cena: ai=briefing in=2200 read=0 write=0 out=450 --> | 1–4× (místo denních) |
| Návrh odpovědi na e-mail | V okně e-mailu ke kontaktu nebo obchodu, na požádání. | Sonnet | 1 700 vstup · 400 výstup | 0,0074 USD <!-- cena: ai=email_reply in=1700 read=0 write=0 out=400 --> | 5× |
| Test spojení a pokynů | Administrace → AI a Jarvis (Otestovat, Vyzkoušet pokyny). Jen majitel aplikace. | Sonnet | 2 200 do cache · 30 vstup · 30 výstup | 0,0059 USD <!-- cena: ai=ping in=30 read=0 write=2200 out=30 --> | jen my |
| Navrhnout větve mapy | U uzlu myšlenkové mapy v Poznámkách, na požádání. Navrhne 3–8 větví. | Sonnet | 1 400 vstup · 300 výstup | 0,0058 USD <!-- cena: ai=note_map_suggest in=1400 read=0 write=0 out=300 --> | 2–4× |
| Souhrn dne (ranní shrnutí) | Ráno ho napíše noční úloha, při prvním příchodu dne se ukáže. Když už fakta nesedí, přepíše se. Prázdný den nic. | Sonnet | 1 300 vstup · 200 výstup | 0,0046 USD <!-- cena: ai=briefing in=1300 read=0 write=0 out=200 --> | 20–25× |
| Hlídání příležitostí | Jednou denně (10:00 UTC), jen u účtů, kde se od minula něco změnilo. Návrh se ukáže v bublině nebo v panelu. | Haiku | 2 200 vstup · 300 výstup | 0,0004 USD <!-- cena: ai=opportunity_scan in=2200 read=0 write=0 out=300 --> | 15–20× |
| Třídění nápadů z chatu | Když zpráva zní jako přání nové funkce, Haiku to ověří a majitel aplikace dostane e-mail. | Haiku | 300 vstup · 60 výstup | 0,00006 USD <!-- cena: ai=classify in=300 read=0 write=0 out=60 --> | 1–3× |

Pokyny majitele z administrace (až 2 000 znaků, asi 500 tokenů) jdou navíc do každého chatu a souhrnu. Celý blok poznámek přidá chatu nejvýš asi 4 000 tokenů, tedy nejvýš 0,008 USD na zprávu.

Druhy `check` a `summary` jsou v kódu připravené, ale dnes je nic nevolá. <!-- kód: ai:check ai:summary -->

### Co Jarvis dělá bez modelu (0 USD)
<!-- kód: kind:proactive kind:rateMessage -->

| Co | Jak to funguje | Pro koho |
|---|---|---|
| Pravidlové návrhy | Jarvis sám přiletí s věcí, kterou spočítá z dat: obchod vyhrán, komu se ozvat, obchod stojí, úkol po termínu, milník připravený k dokončení, faktura po splatnosti, obchodní úkol po termínu, další krok cesty, pozvánka do cizí firmy, docházející peníze podle plánu měsíce (kdy kapitál klesne pod nulu nebo rezervu a proč), rezervace ke schválení a nová rezervace z plánovače. Před ukázáním se vždy přepočítá. <!-- kód: proactive:dealWon proactive:followUps proactive:stalledDeal proactive:overdueTask proactive:milestoneReady proactive:overdueInvoice proactive:overdueCrmTask proactive:pathReady proactive:workerInvite proactive:cashLow proactive:bookingPending proactive:bookingNew proactive:insight --> | majitel |
| Návrh z hlídání | Postřeh z hlídání příležitostí, může nést úkoly k přidání. Model stojí jen to hlídání (viz výše), samotné ukázání nic. | majitel |
| Otázky | Nejvýš dvě týdně: cíl měsíce, kolik hodin chce volat, co ho brzdí, ideální zákazník. Odpovědi jdou do kontextu chatu. <!-- kód: question:monthlyGoal question:callingHours question:obstacle question:idealCustomer --> | majitel |
| Návrhy otázek v chatu | Tlačítka podle situace: naplánovat den, další krok, komu se ozvat, obchody, co stojí, úkoly a faktury po termínu, první milník, první obchod, finance měsíce, začít volat. Po kliknutí je to obyčejná zpráva chatu. <!-- kód: chip:planDay chip:planNext chip:followUps chip:stalledDeals chip:overdueTasks chip:overdueCrmTasks chip:overdueInvoices chip:nextMilestoneStep chip:firstMilestone chip:firstDeal chip:monthFinance chip:startCalling --> | majitel, pracovník |
| Jak často se ozývá | Často (2 h), Občas (6 h, výchozí), Jednou denně, týdně, měsíčně. Řídí, kolik souhrnů a návrhů za měsíc vznikne. <!-- kód: frequency:every_2h frequency:every_6h frequency:daily frequency:weekly frequency:monthly --> | majitel |
| Časové okno | Volání a schůzky navrhuje jen v pracovní dny 8:00–17:30 v pásmu uživatele, mimo svátky ČR. | majitel, pracovník |
| Tutoriál a průvodce | Jarvis provází tutoriálem. Texty jsou z překladů, žádný model. | majitel, pracovník |
| Představení Poznámek | Jednou za život účtu, pevný text. | majitel |
| Uložit do poznámek | Odpověď Jarvise jde jedním tlačítkem do poznámky. | majitel |
| Palec nahoru / dolů | Hodnocení odpovědi Jarvise, pro naši kontrolu kvality. | majitel, pracovník |
| Reakce na návrh | Přidat, Později, Zavřít. Úkoly z návrhu vzniknou až po Přidat. | majitel |

---

## 3. Co stojí jeden uživatel za měsíc

Je to odhad podle kapitoly 2 a sazeb z `src/config/costs.ts` (1 USD = 21,50 Kč).

**Profily:**
- **Lehký** se párkrát týdně podívá, napíše pár zpráv Jarvisovi a negeneruje kontakty.
- **Běžný** pracuje skoro denně, Jarvisovi napíše asi 60 zpráv a vygeneruje 100 kontaktů.
- **Intenzivní** má Jarvise otevřeného pořád (asi 250 zpráv) a vyčerpá 300 vygenerovaných kontaktů jako na Pro.

| Náklad | Lehký | Běžný | Intenzivní | Z čeho |
|---|---|---|---|---|
| AI (Jarvis) | 0,30 USD | 1,20 USD | 4,80 USD | Lehký: 15 zpráv, 2 milníky, 8 souhrnů. Běžný: 60 zpráv (5 se souborem), 4 milníky, 25 souhrnů, 5 e-mailů, 1 rozbor. Intenzivní: 250 zpráv (30 se souborem), 10 milníků, 40 souhrnů, 30 e-mailů, 15 map, 4 rozbory. |
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
- **/admin/ai**: útrata měsíce proti stropu.
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
| Odpovědi Jarvise za měsíc | Každé úspěšné volání modelu včetně automatických. Solo 300, Pro 1 000, Team 1 500. | Administrace → Tarify |
| Soubory do Jarvise za měsíc | Přiložené soubory v chatu. Solo 0 (soubory vypnuté), Pro 100, Team 150. | Administrace → Tarify |
| Počet pracovníků | Kolik pracovníků účet má. Dnes všude bez limitu. Nad limitem režim jen pro čtení od další půlnoci. | Administrace → Tarify |
| Úložiště v MB | Dnes všude bez limitu. **Počítá jen soubory poslané Jarvisovi**, ne faktury, přílohy Zpráv ani dokumenty pracovníků. | Administrace → Tarify |
| Aktivní typy schůzek | Kolik typů schůzek v Plánovači může mít jeden člověk zapnutých. Solo 1, Pro a Team bez limitu (verze katalogu před 24.3 a beta podle tabulky `plans`). Nad limitem nový typ začne vypnutý, zapnutí odmítne DB s nabídkou vyššího tarifu. | Administrace → Tarify |
| Cena za pracovníka a pracovníci v ceně | `per_worker` = cena za každého pracovníka navíc, `included_workers` = kolik jich je v ceně (starší verze bez pole = 0). Platí jen za pracovníky bez vlastního platného tarifu. Koncept z 22.5: Solo 0 a bez ceny, Pro 0 + 290 Kč / 12 EUR, Team 10 v ceně + 290 Kč; beta (tabulka `plans`) 0 + 290 Kč. Jen se počítá a ukazuje, platby zatím neběží. | Administrace → Tarify |
| Celkový strop AI | Měsíční útrata za AI všech účtů (výchozí 90 USD). Nad ním Jarvis do konce měsíce nevolá model. | Administrace → AI a Jarvis → Strop využití AI |
| Strop AI na uživatele | Měsíční útrata jednoho účtu v USD. Výchozí bez limitu. Platí dvakrát: na všechno, co účet utratil kdekoli, a jako strop jeho prostoru na všechna volání v něm (i jeho pracovníků, platí majitel). | Administrace → AI a Jarvis → Strop využití AI |
| Výjimka pro uživatele | Vlastní strop nebo úplně vypnutá AI pro jeden účet. | Administrace → Uživatelé → detail |
| Práh upozornění | Od kolika procent stropu přijde e-mail (výchozí 80 %). | Administrace → AI a Jarvis |
| Pravidla Jarvise | Vypínač u každého druhu proaktivního návrhu a u otázek, rozestupy, otázek týdně, stáří návrhu, pokyny. | Administrace → AI a Jarvis → Pravidla |
| Zkušební období | 14 dní tarifu Pro bez karty. Po něm jen pro čtení. | V kódu (`TRIAL_DAYS`), změna = nasazení |
| Tarif beta | Testeři a **každý pozvaný pracovník** dostanou tarif beta bez konce: 500 / 5 000 kontaktů, 3 000 odpovědí Jarvise, 500 souborů. Beta pracovníka z pozvánky je „přes firmu“ (`via_worker_invite`), za vlastní tarif se nepočítá. Odpovědi Jarvise v cizí firmě se počítají podle tarifu té firmy. | Jen v databázi (tabulka `plans`), v administraci ne |
| Promo kódy | Dny zkoušky navíc, sleva z první platby, měsíce zdarma. | Administrace → Promo kódy |
| Ceny v měnách | Základ v EUR, ruční ceny v libovolných měnách (dnes CZK), ostatní z kurzu se „prodejním“ zaokrouhlením (`psychologicalPrice`, nejvýš 8 % od přesného přepočtu). Platí se jen v EUR a v měnách s ruční cenou. Náhled v libovolné měně, „Přepsat ručně“, varování nad 15 % od kurzu. | Administrace → Tarify |
| Doplňky | Položky katalogu navíc k tarifu (dnes `no_branding`), cena měsíčně v EUR a ručních měnách. | Administrace → Tarify |
| Registrace bez pozvánky | Zapíná veřejnou registraci se zkušebním obdobím a schová čekací listinu. Bez potvrzování e-mailu v Supabase ukáže administrace varování. Kontrolní seznam spuštění je v `docs/spusteni.md`. | Proměnná `PUBLIC_SIGNUP_ENABLED`, změna = restart |
| Práva pracovníka | Co pracovník smí v každé sekci, včetně generování kontaktů. | Aplikace → Správa firmy (majitel) |

Pevné hranice v kódu, stejné pro všechny:
- Jarvis bere nejvýš 3 soubory po 10 MB na zprávu.
- Zprávy berou nejvýš 5 příloh po 10 MB.
- Dokument pracovníka může mít nejvýš 20 MB.
- Import mapy založí nejvýš 1 000 úkolů najednou a 2 000 úkolů v milníku.
- Jedno generování přinese nejvýš 60 firem (3 požadavky na Google).
- Nahlásit problém jde nejvýš 20× za hodinu.

### Co by šlo omezit snadno, ale dnes limit nemá

| Co | Dnes | Jak snadno |
|---|---|---|
| Pracovníci jen v Team | Pozvat pracovníky jde na kterémkoli tarifu, limit `workers` je všude prázdný. | Vyplnit limit v katalogu (např. Solo a Pro 0). Hlídání už existuje. |
| Rozbor schůzek jen v Pro | Karta tarifu ho slibuje v Pro, ale funguje na všech tarifech. | Kontrola tarifu před voláním, jedno místo v `/api/jarvis`. |
| Úložiště všech souborů | Limit počítá jen soubory pro Jarvise. | Přičíst faktury, přílohy Zpráv a dokumenty pracovníků (velikosti v úložišti známe). |
| E-maily kontaktům a faktury e-mailem | Bez počtu. | Měsíční počet podle `usage_events` jako u generování. |
| Proaktivní Jarvis podle tarifu | Souhrny a hlídání mají všechny tarify stejně. | Přepínač podle tarifu vedle pravidel Jarvise. |
| Počty záznamů | Kontakty, obchody, milníky, poznámky a faktury nemají strop. | Kontrola při zakládání. Spíš nedoporučujeme, nic nás nestojí. |
| Google požadavky místo kontaktů | Limit počítá uložené kontakty. Duplicity stojí požadavek, ale do limitu se nepočítají. | Počítat i požadavky z `usage_events`. |

**Pozor:** výchozí karta tarifu Pro slibuje „Synchronizaci kalendáře“, ta ale v aplikaci není. Karty Team slibují „Týmové statistiky“ a „Systém odměn“, ty fungují na každém tarifu.

---

## Jak dokument udržovat

- Nová funkce, sekce, stránka nebo schopnost Jarvise = nový řádek tady: co dělá, pro koho, náklad.
- U AI patří řádek do tabulky v kapitole 2 i s modelem, tokeny a cenou, seřazený od nejdražšího.
- `bun run docs:funkce` vypíše:
  - stránky, položky menu, Jarvisovy katalogy a limity tarifů, které tu chybí;
  - co tu zůstalo, i když to kód už nemá;
  - ceny, které nesedí na tokeny a `src/config/costs.ts`.
- Značky `<!-- kód: … -->` a `<!-- cena: … -->` jsou pro skript a čtenář je nevidí.
